/**
 * video-discover — executor (Phase 3, #358 / #361)
 *
 * Pipeline:
 *   1. Validate mandalaId and load the user's sub_goal embeddings (8 cells)
 *   2. Verify the user has a fresh YouTube OAuth token (skip if not connected)
 *   3. Load top-N keyword_scores rows with embeddings (Phase 2b cache)
 *   4. For each cell:
 *      a. Compute per_mandala_relevance (cosine sim) for every keyword
 *      b. Pick top KEYWORDS_PER_CELL keyword(s) by per_mandala_relevance × iks_total
 *      c. Call YouTube search.list with the user's OAuth token
 *      d. Compute Rec Score per video (IKS + freshness + diversity + per_mandala_relevance)
 *      e. Pick top RECS_PER_CELL by Rec Score
 *   5. Batch fetch video statistics via videos.list (1 quota unit, all video IDs)
 *   6. Upsert all recommendations to recommendation_cache
 *
 * Quota cost (per execute()):
 *   8 cells × 1 search.list (100 units) + 1 videos.list (1 unit) = 801 units
 *   against the USER's quota (OAuth Bearer), NOT Insighta's API key.
 */

import type {
  SkillExecutor,
  PreflightContext,
  PreflightResult,
  ExecuteContext,
  ExecuteResult,
} from '@/skills/_shared/types';
import { getPrismaClient } from '@/modules/database';
import { Prisma } from '@prisma/client';
import { logger } from '@/utils/logger';
import {
  manifest,
  VIDEO_DISCOVER_RECS_PER_CELL,
  VIDEO_DISCOVER_KEYWORDS_PER_CELL,
  VIDEO_DISCOVER_SEARCH_RESULTS_PER_CELL,
  VIDEO_DISCOVER_TTL_DAYS,
  VIDEO_DISCOVER_KEYWORD_POOL_SIZE,
  VIDEO_DISCOVER_QUERIES_PER_CELL,
} from './manifest';
import { generateSearchQueriesRace, LlmQueryGenError } from './sources/llm-query-generator';
import { rerankBatch, type RerankCandidate } from './sources/llm-reranker';

const log = logger.child({ module: 'video-discover' });
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

/**
 * Map mandala language → YouTube `regionCode` (ISO 3166-1 alpha-2).
 * Used by Fix 1 (CP358) to bias YouTube search results to the user's locale
 * instead of hardcoding KR. Languages not in this map fall back to no
 * `regionCode` (relevanceLanguage alone).
 */
const LANG_TO_REGION: Record<string, string> = {
  ko: 'KR',
  en: 'US',
  ja: 'JP',
  zh: 'TW',
  es: 'ES',
  fr: 'FR',
  de: 'DE',
};

// Rec Score weights (CP353 P1 — tuned after view_count fix surfaced
// freshness over-weighting + LLM noise keyword infiltration).
//
// Diff vs design doc §5 baseline:
//   - video_quality 0.25 → 0.35 (+0.10) — taken from freshness
//   - freshness     0.20 → 0.10 (-0.10) — fresh-but-irrelevant English videos
//                                          were outranking popular Korean ones
//   - diversity     0.10 → 0.00 (-0.10) — enforced by per-channel dedup loop
//                                          instead of Rec Score; the score
//                                          weight wasn't doing anything
//   - per_mandala_relevance 0.10 (NEW)  — pulled diversity's 0.10 in;
//                                          penalizes keywords with low cosine
//                                          similarity to the user's mandala
//                                          sub_goals (Q1 architecture: keep
//                                          keyword_scores.goal_relevance global,
//                                          compute per-mandala separately).
//   - IKS / historical unchanged
const REC_WEIGHT_IKS = 0.35;
const REC_WEIGHT_VIDEO_QUALITY = 0.35;
const REC_WEIGHT_FRESHNESS = 0.1;
const REC_WEIGHT_PER_MANDALA = 0.1;
const REC_WEIGHT_HISTORICAL = 0.1; // 0.5 placeholder until Layer 4 ships
// Sum = 0.35 + 0.35 + 0.10 + 0.10 + 0.10 = 1.0
// (diversity is no longer a Rec Score term — see per-channel dedup in execute())

/**
 * Days after which freshness drops to 0. CP360 (experiment #3 Phase 1-C):
 * bumped 180 → 365 to reflect that educational content is often evergreen;
 * cutting off at 6 months drops perfectly usable long-form tutorials. This
 * remains a SOFT signal (weight 10%) — oldness still disfavors, just less
 * aggressively.
 */
const FRESHNESS_HORIZON_DAYS = 365;
/** Max IDs per videos.list call (YouTube Data API hard limit). */
const VIDEOS_LIST_MAX_IDS_PER_CALL = 50;
/** Reference view count that maps to videoQuality 1.0 on the log scale. */
const VIDEO_QUALITY_REFERENCE_VIEWS = 10_000_000;
/**
 * CP360 experiment #3 Phase 1-A — hard view_count gate. Any candidate with
 * fewer than this many views is dropped during Step 3.6 filter. The gate
 * relaxes to {@link MIN_VIEW_COUNT_RELAX} on a per-cell basis if the hard
 * cutoff would leave the cell with zero candidates, so we never starve a
 * cell entirely. Rationale: in experiment #2 66% of "조카 교육" candidates
 * had <10K views and were almost always low-quality / amateur uploads that
 * beat high-view Korean videos because of iksTotal ties + freshness bumps.
 */
const MIN_VIEW_COUNT = 10_000;
const MIN_VIEW_COUNT_RELAX = 1_000;
/**
 * CP360 Phase 1 — Cross-run recommendation_cache reuse.
 *
 * Before calling YouTube search for a cell, look up `recommendation_cache`
 * rows with the SAME `keyword` (cell's top keyword) that were created
 * within the last {@link CACHE_LOOKBACK_DAYS} days by ANY user. If we find
 * at least {@link MIN_CACHE_HITS_PER_CELL} unique video ids, the cell is
 * served entirely from the cache — zero YouTube quota spent.
 *
 * Rationale: the 4 experiment #3 validation runs showed that
 * recommendation_cache is already a de-facto video pool keyed by keyword.
 * First mandala to use a given keyword pays the full 100-unit cost; all
 * subsequent mandalas (across users) get the videos for free, with the
 * exact same quality filters (view gate, blocklist, rerank) applied.
 *
 * Cold-start: first few mandalas still pay full quota, but as the corpus
 * builds up (1 day of normal usage ~= 50+ unique keywords populated),
 * quota usage amortizes toward ~100-200 units/mandala (80-90% reduction
 * from the 800-unit Phase 2 baseline).
 *
 * Freshness: rows older than CACHE_LOOKBACK_DAYS are ignored, so stale
 * videos get refetched automatically on the next pass.
 *
 * Kill switch: VIDEO_DISCOVER_DISABLE_CACHE_REUSE=1
 */
const CACHE_LOOKBACK_DAYS = 7;
const CACHE_LOOKBACK_MS = CACHE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
const MIN_CACHE_HITS_PER_CELL = 3;
/** How many rows to read per cell-cache lookup (avoids loading everything). */
const CACHE_LOOKUP_LIMIT = 20;
/** Min cell↔keyword cosine for cache reuse. Strict: 0.80. */
const CACHE_REUSE_MIN_RELEVANCE = 0.8;

interface SubGoalCell {
  cellIndex: number;
  text: string;
  embedding: number[];
}

interface KeywordRow {
  keyword: string;
  iksTotal: number; // 0-100
  embedding: number[];
  domain: string | null;
}

interface HydratedState {
  mandalaId: string;
  userId: string;
  oauthToken: string;
  subGoals: SubGoalCell[];
  keywords: KeywordRow[];
  /**
   * Mandala language (ISO 639-1, e.g. 'ko', 'en'). Sourced from
   * `mandala_embeddings.language` (level=1) — same value across all 8
   * sub_goals so we read it once. Defaults to 'ko' if missing. (Fix 1, CP358)
   */
  mandalaLanguage: string;
  /**
   * Mandala center goal (root level center text). Used by Fix 2 LLM query
   * generator to ground the prompt. Sourced from `mandala_embeddings.center_goal`
   * (level=1, same value across rows). Empty string if missing. (Fix 1+2, CP358)
   */
  centerGoal: string;
  /**
   * Ollama base URL for the LLM query generator. Sourced from
   * `ctx.env.OLLAMA_URL` with the Mac Mini Tailscale IP as the default.
   * Same convention as trend-collector. (Fix 2, CP358)
   */
  llmUrl: string;
  /**
   * Kill switch for Fix 2 (LLM query gen). When `true`, the executor skips
   * BOTH the Ollama and OpenRouter calls and goes straight to the legacy
   * `${cell.text} ${keyword}` concat fallback. Set via
   * `VIDEO_DISCOVER_DISABLE_LLM=1` in the runtime env. Race orchestrator
   * superseded the original Mac-Mini-only path but the kill switch stays
   * as a defense-in-depth safety net.
   */
  llmDisabled: boolean;
  /**
   * OpenRouter API key for the race fallback. Empty string when unset —
   * the race orchestrator gracefully degrades to Ollama-only in that
   * case (no error). Sourced from `ctx.env.OPENROUTER_API_KEY`.
   */
  openRouterApiKey: string;
  /**
   * OpenRouter model identifier (e.g. `qwen/qwen3-30b-a3b`). Sourced
   * from `ctx.env.OPENROUTER_MODEL` with the same default as the
   * existing `OpenRouterGenerationProvider`.
   */
  openRouterModel: string;
  /**
   * CP360 Phase 1-F kill switch. When `true`, the LLM reranking step is
   * skipped entirely and all post-filter candidates flow into the upsert.
   * Set via `VIDEO_DISCOVER_DISABLE_RERANK=1`. Use during incidents when
   * OpenRouter is flapping or the parser is producing garbage.
   */
  rerankDisabled: boolean;
  /**
   * CP360 quota relief — dedicated server API key for search.list/videos.list.
   * When non-empty, the executor uses `?key=<this>` instead of OAuth Bearer,
   * routing traffic through a separate Google Cloud project whose quota
   * bucket is independent of the one backing `YOUTUBE_CLIENT_ID`. Leaves
   * the OAuth token fallback in place for environments that still rely on
   * per-user quotas (dev accounts without a server key).
   *
   * Sourced from `ctx.env.YOUTUBE_API_KEY_SEARCH`. Empty string disables
   * this path entirely — the executor falls back to the legacy OAuth
   * Bearer behavior. See credentials.md for the reset schedule and
   * fallback chain.
   */
  youtubeApiKey: string;
  /**
   * CP360 Phase 1 kill switch for cross-run recommendation_cache reuse.
   * When `true`, the executor skips the cache lookup and goes straight
   * to the YouTube search path for every cell (legacy behavior). Set via
   * `VIDEO_DISCOVER_DISABLE_CACHE_REUSE=1`. Use during incidents if the
   * cache-reuse path is producing stale/bad results.
   */
  cacheReuseDisabled: boolean;
  fetchImpl?: typeof fetch;
}

interface YouTubeSearchItem {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    channelTitle?: string;
    channelId?: string;
    publishedAt?: string;
    thumbnails?: { high?: { url?: string } };
  };
}

interface YouTubeSearchResponse {
  items?: YouTubeSearchItem[];
  error?: { code: number; message: string };
}

interface YouTubeVideoStatsItem {
  id?: string;
  statistics?: {
    viewCount?: string;
    likeCount?: string;
  };
  contentDetails?: { duration?: string };
}

interface YouTubeVideosResponse {
  items?: YouTubeVideoStatsItem[];
  error?: { code: number; message: string };
}

interface RecommendationCandidate {
  cellIndex: number;
  keyword: string;
  iksTotal: number;
  perMandalaRelevance: number;
  videoId: string;
  title: string;
  channel: string;
  channelId: string;
  publishedAt: string;
  thumbnail: string;
  // Filled in after batch videos.list
  viewCount: number | null;
  likeCount: number | null;
  /**
   * Video duration in seconds, parsed from `contentDetails.duration` (ISO 8601).
   * Fix 3 (CP358) — used to drop Shorts (<60s) post-hoc; the YouTube Search
   * `videoDuration=medium` filter (Fix 1) is not 100% accurate.
   */
  durationSec: number | null;
  // Computed Rec Score components
  recScore?: number;
  videoQuality?: number;
  freshness?: number;
}

/**
 * Fix 3 (CP358) — Title blocklist. Drops candidates whose titles contain
 * drama / webnovel / vlog / reaction noise that pollutes education-intent
 * queries. Tokens are matched case-insensitively as substrings; expand
 * cautiously since false positives hurt diverse content.
 */
const TITLE_BLOCKLIST: readonly string[] = [
  // Korean drama / webnovel / anime
  '드라마',
  '웹소설',
  '웹툰',
  '애니',
  '만화',
  // English
  'drama',
  'webtoon',
  'anime',
  'manga',
  // Reaction / vlog / mukbang noise
  '리액션',
  '브이로그',
  '먹방',
  'vlog',
  'mukbang',
  'reaction',
  // CP360 experiment #3 Phase 1-D — advertising / PPL / sponsored content.
  // These substrings are commonly disclosed in Korean YouTube titles for
  // regulatory compliance, so matching on the title alone catches the vast
  // majority of ad-heavy videos. False-positive risk on legit "광고 전략 강의"
  // style educational content is accepted; LLM reranking (Phase 1-F) is the
  // secondary line of defense.
  '유료광고',
  '협찬',
  'ppl',
  'sponsored',
  '[ad]',
  '[광고]',
  '#ad',
  '#광고',
];

/** Minimum duration in seconds (Fix 3, CP358) — anything shorter is a Short. */
const MIN_DURATION_SEC = 60;
/**
 * Channel diversity cap (Fix 3, CP358). If a single channel contributes
 * `>= GLOBAL_CHANNEL_CAP_THRESHOLD` videos to the final 24, collapse it to
 * the highest-scored one only.
 */
const GLOBAL_CHANNEL_CAP_THRESHOLD = 3;

export const executor: SkillExecutor = {
  manifest,

  async preflight(ctx: PreflightContext): Promise<PreflightResult> {
    const mandalaId = ctx.mandalaId;
    if (!mandalaId) {
      return { ok: false, reason: 'mandala_id is required' };
    }
    if (!ctx.userId) {
      return { ok: false, reason: 'userId is required' };
    }

    const db = getPrismaClient();

    // 1. Verify mandala exists and belongs to the user
    const mandala = await db.user_mandalas.findFirst({
      where: { id: mandalaId, user_id: ctx.userId },
      select: { id: true },
    });
    if (!mandala) {
      return { ok: false, reason: `Mandala ${mandalaId} not found or not owned by user` };
    }

    // 2. Verify YouTube OAuth token (skip if not connected — preflight FAIL)
    const oauth = await db.youtube_sync_settings.findUnique({
      where: { user_id: ctx.userId },
      select: {
        youtube_access_token: true,
        youtube_token_expires_at: true,
      },
    });
    if (!oauth?.youtube_access_token) {
      return {
        ok: false,
        reason:
          'YouTube account not connected. Please connect YouTube to enable video recommendations.',
      };
    }
    if (oauth.youtube_token_expires_at && new Date(oauth.youtube_token_expires_at) < new Date()) {
      return {
        ok: false,
        reason: 'YouTube OAuth token expired. Please reconnect YouTube.',
      };
    }

    // 3. Load 8 sub_goal embeddings for this mandala (level=1, 4096d).
    // Fix 1 (CP358): also pull `language` + `center_goal` so the executor can
    // pass relevanceLanguage/regionCode to YouTube Search and so the LLM
    // query generator (Fix 2) has the center context.
    const subGoalRows = await db.$queryRaw<
      {
        sub_goal_index: number;
        sub_goal: string | null;
        text: string | null;
        language: string | null;
        center_goal: string | null;
        embedding: string;
      }[]
    >(
      Prisma.sql`SELECT sub_goal_index, sub_goal, text, language, center_goal,
                        embedding::text AS embedding
                 FROM mandala_embeddings
                 WHERE mandala_id = ${mandalaId} AND level = 1 AND embedding IS NOT NULL
                 ORDER BY sub_goal_index NULLS LAST`
    );
    if (subGoalRows.length === 0) {
      return {
        ok: false,
        reason: `Mandala ${mandalaId} has no level=1 sub_goal embeddings yet. Generate the mandala first.`,
      };
    }

    const subGoals: SubGoalCell[] = subGoalRows
      .map((row, idx) => {
        const text = row.sub_goal ?? row.text ?? '';
        const embedding = parseVectorLiteral(row.embedding);
        if (embedding.length === 0) return null;
        return {
          cellIndex: row.sub_goal_index ?? idx,
          text,
          embedding,
        };
      })
      .filter((s): s is SubGoalCell => s !== null);

    if (subGoals.length === 0) {
      return { ok: false, reason: 'All mandala sub_goal embeddings parsed as empty' };
    }

    // 4. Load top-N keyword_scores with embeddings
    const keywordRows = await db.$queryRaw<
      { keyword: string; iks_total: number; domain: string | null; embedding: string }[]
    >(
      Prisma.sql`SELECT keyword, iks_total, domain, embedding::text AS embedding
                 FROM keyword_scores
                 WHERE embedding IS NOT NULL
                 ORDER BY iks_total DESC
                 LIMIT ${VIDEO_DISCOVER_KEYWORD_POOL_SIZE}`
    );
    if (keywordRows.length === 0) {
      return {
        ok: false,
        reason: 'No keyword_scores rows with embeddings. Run trend-collector + iks-scorer first.',
      };
    }

    const keywords: KeywordRow[] = keywordRows
      .map((row) => {
        const embedding = parseVectorLiteral(row.embedding);
        if (embedding.length === 0) return null;
        return {
          keyword: row.keyword,
          iksTotal: row.iks_total,
          embedding,
          domain: row.domain,
        };
      })
      .filter((k): k is KeywordRow => k !== null);

    // Fix 1 (CP358): mandalaLanguage + centerGoal are stored per row but are
    // identical across the 8 sub_goals (set once in ensure-mandala-embeddings).
    // Read from the first row, default to safe values when missing.
    const firstRow = subGoalRows[0];
    const mandalaLanguage = (firstRow?.language ?? 'ko').toLowerCase();
    const centerGoal = firstRow?.center_goal ?? '';

    // Fix 2 (CP358): pull Ollama URL from env, default to Mac Mini Tailscale.
    // Same convention as trend-collector executor.
    const llmUrl = ctx.env?.['OLLAMA_URL'] ?? 'http://100.91.173.17:11434';
    // Kill switch — set VIDEO_DISCOVER_DISABLE_LLM=1 to skip Fix 2 entirely
    // and run on Fix 1+3 only. Useful when both LLM providers are flapping.
    const llmDisabled = ctx.env?.['VIDEO_DISCOVER_DISABLE_LLM'] === '1';
    // Race orchestrator config (CP358 hotfix 2). When the OpenRouter key is
    // missing the race degenerates to Ollama-only — the executor stays
    // working in either configuration.
    const openRouterApiKey = ctx.env?.['OPENROUTER_API_KEY'] ?? '';
    const openRouterModel = ctx.env?.['OPENROUTER_MODEL'] ?? 'qwen/qwen3-30b-a3b';
    // CP360 Phase 1-F — rerank kill switch. Separate from llmDisabled so
    // we can keep LLM query generation (Fix 2) on while turning reranking
    // off, or vice versa. Both default enabled.
    const rerankDisabled = ctx.env?.['VIDEO_DISCOVER_DISABLE_RERANK'] === '1';
    // CP360 quota relief — dedicated server API key for search.list.
    // Optional: empty string falls back to OAuth Bearer (legacy path).
    const youtubeApiKey = ctx.env?.['YOUTUBE_API_KEY_SEARCH'] ?? '';
    // CP360 Phase 1 — cache reuse kill switch. Default enabled.
    const cacheReuseDisabled = ctx.env?.['VIDEO_DISCOVER_DISABLE_CACHE_REUSE'] === '1';

    const hydrated: HydratedState = {
      mandalaId,
      userId: ctx.userId,
      oauthToken: oauth.youtube_access_token,
      subGoals,
      keywords,
      mandalaLanguage,
      centerGoal,
      llmUrl,
      llmDisabled,
      openRouterApiKey,
      openRouterModel,
      rerankDisabled,
      youtubeApiKey,
      cacheReuseDisabled,
    };
    return { ok: true, hydrated: hydrated as unknown as Record<string, unknown> };
  },

  async execute(ctx: ExecuteContext): Promise<ExecuteResult> {
    const t0 = Date.now();
    const state = ctx.state as unknown as HydratedState;
    const fetchFn = state.fetchImpl ?? fetch;
    const db = getPrismaClient();

    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + VIDEO_DISCOVER_TTL_DAYS * MS_PER_DAY);

    // ── Step 1: For each cell, pick top keyword(s) by per_mandala_relevance ─
    const cellSelections: {
      cell: SubGoalCell;
      keyword: KeywordRow;
      perMandalaRelevance: number;
    }[] = [];
    for (const cell of state.subGoals) {
      const scored = state.keywords
        .map((kw) => {
          const cos = dot(cell.embedding, kw.embedding);
          // Combine cosine sim (per_mandala) with global IKS to break ties
          const combined = cos * 0.7 + (kw.iksTotal / 100) * 0.3;
          return { kw, cos, combined };
        })
        .sort((a, b) => b.combined - a.combined);
      const top = scored.slice(0, VIDEO_DISCOVER_KEYWORDS_PER_CELL);
      for (const t of top) {
        cellSelections.push({ cell, keyword: t.kw, perMandalaRelevance: t.cos });
      }
    }

    log.info(`Selected ${cellSelections.length} (cell × keyword) pairs to search`);

    // ── Step 2: LLM-driven multi-query YouTube search per cell ─────────
    // Fix 2 (CP358): replace the previous `${sub_goal} ${top_keyword}` single-
    // query call with VIDEO_DISCOVER_QUERIES_PER_CELL natural-language queries
    // generated by Mac Mini Ollama (llama3.1). On any LLM failure for a cell,
    // fall back to the legacy concat path so the skill never blocks on a
    // hiccup. Quota: 8 cells × 1 query × 100 = 800 units (8% of daily 10k)
    // — CP360 reduced from 3→1 queries per cell after empirical validation
    // showed the extra 2 queries produced mostly near-duplicates that the
    // per-cell dedup collapsed anyway.
    const allCandidates: RecommendationCandidate[] = [];
    let searchCalls = 0;
    let searchFailures = 0;
    let llmQueryGenSuccess = 0;
    let llmQueryGenFailures = 0;
    const regionCode = LANG_TO_REGION[state.mandalaLanguage];
    // Per-cell dedup so the same video doesn't enter the candidate pool twice
    // when two LLM queries surface it.
    const seenPerCell = new Set<string>();

    function pushCandidate(
      sel: { cell: SubGoalCell; keyword: KeywordRow; perMandalaRelevance: number },
      item: YouTubeSearchItem
    ): void {
      const videoId = item.id?.videoId;
      if (!videoId) return;
      const key = `${sel.cell.cellIndex}:${videoId}`;
      if (seenPerCell.has(key)) return;
      seenPerCell.add(key);
      allCandidates.push({
        cellIndex: sel.cell.cellIndex,
        keyword: sel.keyword.keyword,
        iksTotal: sel.keyword.iksTotal,
        perMandalaRelevance: sel.perMandalaRelevance,
        videoId,
        title: item.snippet?.title ?? '(untitled)',
        channel: item.snippet?.channelTitle ?? '',
        channelId: item.snippet?.channelId ?? '',
        publishedAt: item.snippet?.publishedAt ?? new Date().toISOString(),
        thumbnail: item.snippet?.thumbnails?.high?.url ?? '',
        viewCount: null,
        likeCount: null,
        durationSec: null,
      });
    }

    // CP360 observability: collect unique failure reasons so skill_runs.error
    // carries something actionable instead of the generic "0 candidates".
    // Keyed by classification; value = {count, sample_message}. Classification
    // is done via `classifySearchError` which recognizes the common cases
    // (quota, auth, network).
    const searchFailureReasons = new Map<string, { count: number; sample: string }>();

    async function runSearch(
      sel: { cell: SubGoalCell; keyword: KeywordRow; perMandalaRelevance: number },
      query: string
    ): Promise<void> {
      try {
        const items = await youtubeSearch({
          query,
          oauthToken: state.oauthToken,
          apiKey: state.youtubeApiKey,
          maxResults: VIDEO_DISCOVER_SEARCH_RESULTS_PER_CELL,
          fetchFn,
          relevanceLanguage: state.mandalaLanguage,
          regionCode,
        });
        searchCalls += 1;
        for (const item of items) pushCandidate(sel, item);
      } catch (err) {
        searchFailures += 1;
        const msg = err instanceof Error ? err.message : String(err);
        const classification = classifySearchError(msg);
        const existing = searchFailureReasons.get(classification);
        if (existing) {
          existing.count += 1;
        } else {
          searchFailureReasons.set(classification, { count: 1, sample: msg.slice(0, 200) });
        }
        log.warn(
          `YouTube search failed for cell ${sel.cell.cellIndex} q="${query}" [${classification}]: ${msg}`
        );
      }
    }

    if (state.llmDisabled) {
      log.info(
        'VIDEO_DISCOVER_DISABLE_LLM=1 — skipping Fix 2 LLM query gen, using legacy concat for all cells'
      );
    }

    // Race telemetry per cell — winner provider (ollama/openrouter), durations,
    // and the number of cells where one provider beat the other. Logged at
    // the end of the cell loop and surfaced in the final result data.
    let raceWinsOllama = 0;
    let raceWinsOpenRouter = 0;
    let raceBothFailed = 0;

    // CP360 Phase 1 — cross-run cache reuse telemetry.
    // cachedVideoIds: videos pushed from recommendation_cache (skip videos.list
    // enrichment at Step 3 — they already have view_count/duration_sec).
    // cellsServedFromCache: cells that hit the MIN_CACHE_HITS_PER_CELL threshold
    // and were served entirely from the cache (0 YouTube API calls).
    // cacheHitsTotal: total cached rows used across all cells.
    // quotaSavedUnits: estimated YouTube quota saved vs the naive all-search
    // path (VIDEO_DISCOVER_QUERIES_PER_CELL × 100 per cache-served cell).
    const cachedVideoIds = new Set<string>();
    let cellsServedFromCache = 0;
    let cacheHitsTotal = 0;
    let quotaSavedUnits = 0;

    /**
     * Try to serve a cell entirely from recommendation_cache. Returns `true`
     * if the cell got ≥ MIN_CACHE_HITS_PER_CELL fresh rows for the current
     * top keyword. On true, the caller skips LLM + YouTube search for this
     * cell. On false, the caller falls through to the existing search path.
     *
     * Cached candidates are pushed into `allCandidates` with:
     *   - cellIndex / keyword / iksTotal / perMandalaRelevance from current sel
     *     (recomputed for this mandala, so rec_score stays user-specific)
     *   - videoId / title / channel / viewCount / durationSec / publishedAt
     *     from the cached row (stable video metadata)
     *   - likeCount = null (recommendation_cache only stores like_ratio which
     *     isn't reversible to raw count without viewCount, and we don't need
     *     raw likeCount downstream — computeVideoQuality falls back to view
     *     signal when likeCount is null)
     *
     * Channel dedup: recommendation_cache stores `channel` (title) but NOT
     * `channel_id`. We use the channel title as a substitute identifier,
     * which is good-enough for the cap logic (creators rename rarely).
     */
    async function tryCellCache(sel: {
      cell: SubGoalCell;
      keyword: KeywordRow;
      perMandalaRelevance: number;
    }): Promise<boolean> {
      if (state.cacheReuseDisabled) return false;

      // Semantic gate — weak keyword cosine means cached videos are off-topic.
      if (sel.perMandalaRelevance < CACHE_REUSE_MIN_RELEVANCE) {
        log.info(
          `cache skip: cell=${sel.cell.cellIndex} keyword="${sel.keyword.keyword}" relevance=${sel.perMandalaRelevance.toFixed(3)} < threshold ${CACHE_REUSE_MIN_RELEVANCE} — fallback to search`
        );
        return false;
      }

      try {
        const cached = await db.recommendation_cache.findMany({
          where: {
            keyword: sel.keyword.keyword,
            created_at: { gt: new Date(Date.now() - CACHE_LOOKBACK_MS) },
          },
          orderBy: { rec_score: 'desc' },
          take: CACHE_LOOKUP_LIMIT,
        });

        // Dedup by video_id — same video may appear in multiple user rows
        const unique = new Map<string, (typeof cached)[0]>();
        for (const r of cached) {
          if (!unique.has(r.video_id)) unique.set(r.video_id, r);
        }

        if (unique.size < MIN_CACHE_HITS_PER_CELL) return false;

        // Secondary title-overlap filter. The cosine gate above catches most
        // topical mismatches, but keyword_scores can still map a weak cell
        // onto a keyword whose cached videos are off-topic (e.g. "근력운동"
        // keyword holds marathon content for a basketball cell). Drop any
        // cached video whose title shares zero tokens with the sub_goal
        // and the center_goal combined. Lightweight string match — no
        // extra API calls, no embeddings.
        const contextTokens = extractTopicTokens(`${state.centerGoal} ${sel.cell.text}`);
        const titleFiltered: (typeof cached)[0][] = [];
        for (const r of unique.values()) {
          if (titleMatchesAnyToken(r.title, contextTokens)) {
            titleFiltered.push(r);
          }
        }
        if (titleFiltered.length < MIN_CACHE_HITS_PER_CELL) {
          log.info(
            `cache skip: cell=${sel.cell.cellIndex} keyword="${sel.keyword.keyword}" ${titleFiltered.length}/${unique.size} passed title filter < ${MIN_CACHE_HITS_PER_CELL} — fallback to search`
          );
          return false;
        }

        for (const r of titleFiltered) {
          if (seenPerCell.has(`${sel.cell.cellIndex}:${r.video_id}`)) continue;
          seenPerCell.add(`${sel.cell.cellIndex}:${r.video_id}`);
          cachedVideoIds.add(r.video_id);
          allCandidates.push({
            cellIndex: sel.cell.cellIndex,
            keyword: sel.keyword.keyword,
            iksTotal: sel.keyword.iksTotal,
            perMandalaRelevance: sel.perMandalaRelevance,
            videoId: r.video_id,
            title: r.title,
            channel: r.channel ?? '',
            // Fallback to video_id so null-channel rows don't collide in dedup.
            channelId: r.channel ?? r.video_id,
            publishedAt: r.published_at?.toISOString() ?? new Date().toISOString(),
            thumbnail: r.thumbnail ?? '',
            viewCount: r.view_count,
            likeCount: null,
            durationSec: r.duration_sec,
          });
          cacheHitsTotal += 1;
        }
        cellsServedFromCache += 1;
        quotaSavedUnits += VIDEO_DISCOVER_QUERIES_PER_CELL * 100;
        log.info(
          `cache hit: cell=${sel.cell.cellIndex} keyword="${sel.keyword.keyword}" relevance=${sel.perMandalaRelevance.toFixed(3)} ${titleFiltered.length}/${unique.size} passed title filter — skipping YouTube search`
        );
        return true;
      } catch (err) {
        log.warn(
          `recommendation_cache lookup failed for cell ${sel.cell.cellIndex}: ${err instanceof Error ? err.message : String(err)} — falling through to search`
        );
        return false;
      }
    }

    for (const sel of cellSelections) {
      // Phase 1 — try cache first. If it hits, skip LLM + search entirely.
      if (await tryCellCache(sel)) continue;
      let queries: string[] | null = null;
      if (!state.llmDisabled) {
        try {
          const raceResult = await generateSearchQueriesRace({
            subGoal: sel.cell.text,
            centerGoal: state.centerGoal,
            language: state.mandalaLanguage,
            baseUrl: state.llmUrl,
            fetchImpl: fetchFn,
            openRouterApiKey: state.openRouterApiKey,
            openRouterModel: state.openRouterModel,
          });
          queries = raceResult.winner.queries;
          // Hard cap defensively even though the parser already limits.
          if (queries && queries.length > VIDEO_DISCOVER_QUERIES_PER_CELL) {
            queries = queries.slice(0, VIDEO_DISCOVER_QUERIES_PER_CELL);
          }
          if (raceResult.winner.provider === 'ollama') raceWinsOllama += 1;
          else raceWinsOpenRouter += 1;
          llmQueryGenSuccess += 1;
        } catch (err) {
          llmQueryGenFailures += 1;
          raceBothFailed += 1;
          if (err instanceof LlmQueryGenError) {
            log.warn(
              `LLM race failed for cell ${sel.cell.cellIndex} (falling back to concat): ${err.message}`
            );
          } else {
            log.warn(
              `LLM race unexpected error for cell ${sel.cell.cellIndex}: ${err instanceof Error ? err.message : String(err)}`
            );
          }
          queries = null;
        }
      }

      if (queries && queries.length > 0) {
        for (const q of queries) {
          await runSearch(sel, q);
        }
      } else {
        // Fallback: legacy single concat query (also taken when llmDisabled).
        await runSearch(sel, `${sel.cell.text} ${sel.keyword.keyword}`);
      }
    }
    if (!state.llmDisabled) {
      log.info(
        `LLM race: success=${llmQueryGenSuccess}, both_failed=${raceBothFailed}, wins_ollama=${raceWinsOllama}, wins_openrouter=${raceWinsOpenRouter}, search_calls=${searchCalls}`
      );
    }
    if (cellsServedFromCache > 0 || state.cacheReuseDisabled) {
      log.info(
        `cache reuse: ${state.cacheReuseDisabled ? 'DISABLED' : `cells_served=${cellsServedFromCache}/${cellSelections.length}, hits=${cacheHitsTotal}, quota_saved=${quotaSavedUnits} units`}`
      );
    }

    if (allCandidates.length === 0) {
      // CP360: surface the classified cause instead of a generic message.
      // Pick the dominant classification (most frequent), fall back to
      // 'all_searches_returned_empty' when calls succeeded but no items.
      const reasonSamples = [...searchFailureReasons.entries()]
        .sort(([, a], [, b]) => b.count - a.count)
        .map(([classification, v]) => ({
          classification,
          count: v.count,
          sample: v.sample,
        }));
      const dominant = reasonSamples[0]?.classification ?? 'all_searches_returned_empty';
      const errorMsg = reasonSamples[0]
        ? `video-discover failed: ${dominant} (${reasonSamples[0].count}/${searchFailures} calls) — ${reasonSamples[0].sample}`
        : 'YouTube search returned 0 candidate videos (all calls completed empty)';
      return {
        status: 'failed',
        data: {
          search_calls: searchCalls,
          search_failures: searchFailures,
          candidates: 0,
          failure_classification: dominant,
          failure_reasons: reasonSamples,
        },
        error: errorMsg,
        metrics: { duration_ms: Date.now() - t0 },
      };
    }

    // ── Step 3: Batch videos.list to fetch view + like counts ──────────
    // YouTube Data API caps `id` parameter at 50 — chunk accordingly.
    // 1 quota unit per chunk, regardless of id count.
    //
    // CP360 Phase 1: skip cached candidates here — they already have
    // view_count / duration_sec / published_at from the recommendation_cache
    // row, and re-fetching would waste 1 videos.list quota unit (small but
    // grows with cache hits).
    const uniqueVideoIds = Array.from(
      new Set(allCandidates.filter((c) => !cachedVideoIds.has(c.videoId)).map((c) => c.videoId))
    );
    let statsRequested = 0;
    let statsReceived = 0;
    let statsCallsMade = 0;
    let statsCallFailures = 0;
    try {
      const allStats: YouTubeVideoStatsItem[] = [];
      for (let i = 0; i < uniqueVideoIds.length; i += VIDEOS_LIST_MAX_IDS_PER_CALL) {
        const chunk = uniqueVideoIds.slice(i, i + VIDEOS_LIST_MAX_IDS_PER_CALL);
        statsRequested += chunk.length;
        statsCallsMade += 1;
        try {
          const chunkStats = await youtubeVideosBatch({
            videoIds: chunk,
            oauthToken: state.oauthToken,
            apiKey: state.youtubeApiKey,
            fetchFn,
          });
          allStats.push(...chunkStats);
          statsReceived += chunkStats.length;
        } catch (chunkErr) {
          statsCallFailures += 1;
          log.warn(
            `videos.list chunk ${i / VIDEOS_LIST_MAX_IDS_PER_CALL + 1} failed: ${chunkErr instanceof Error ? chunkErr.message : String(chunkErr)}`
          );
        }
      }
      log.info(
        `videos.list: requested=${statsRequested}, received=${statsReceived}, calls=${statsCallsMade}, failed=${statsCallFailures}`
      );

      const statsById = new Map(allStats.map((s) => [s.id ?? '', s]));
      let mappedCount = 0;
      let viewCountPopulated = 0;
      for (const cand of allCandidates) {
        const stat = statsById.get(cand.videoId);
        if (stat?.statistics) {
          mappedCount += 1;
          // viewCount is almost always present
          const vcStr = stat.statistics.viewCount;
          if (vcStr !== undefined) {
            const vc = parseInt(vcStr, 10);
            if (!Number.isNaN(vc)) {
              cand.viewCount = vc;
              viewCountPopulated += 1;
            }
          }
          // likeCount is OFTEN missing — YouTube hides like counts for many
          // creators by default. null fallback is the contracted signal.
          const lcStr = stat.statistics.likeCount;
          if (lcStr !== undefined) {
            const lc = parseInt(lcStr, 10);
            cand.likeCount = Number.isNaN(lc) ? null : lc;
          }
        }
        // Fix 3 (CP358): parse contentDetails.duration into seconds for the
        // Shorts filter applied after Step 3.5. videos.list already requests
        // contentDetails (line ~613) so this is free quota-wise.
        cand.durationSec = parseIsoDuration(stat?.contentDetails?.duration);
      }
      log.info(
        `videos.list mapping: candidates=${allCandidates.length}, mapped=${mappedCount}, view_count populated=${viewCountPopulated}`
      );
    } catch (err) {
      log.warn(
        `videos.list batch failed (continuing without stats): ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // ── Step 3.5: Fix 3 (CP358) — Shorts + title blocklist filters ────
    // Drop videos shorter than MIN_DURATION_SEC (Shorts) or whose titles
    // contain entries from TITLE_BLOCKLIST (drama / vlog / reaction + CP360
    // ads/PPL additions). YouTube Search `videoDuration=medium` (Fix 1)
    // already filters most Shorts at the API boundary but isn't 100%
    // accurate so this is defense-in-depth. Candidates with
    // `durationSec === null` are kept (no signal == benefit of doubt).
    const beforeFilter = allCandidates.length;
    let droppedShorts = 0;
    let droppedBlocklist = 0;
    const survivedFix3 = allCandidates.filter((c) => {
      if (c.durationSec !== null && c.durationSec < MIN_DURATION_SEC) {
        droppedShorts += 1;
        return false;
      }
      if (titleContainsBlocked(c.title)) {
        droppedBlocklist += 1;
        return false;
      }
      return true;
    });
    if (beforeFilter - survivedFix3.length > 0) {
      log.info(
        `Fix 3 filter: dropped shorts=${droppedShorts} blocklist=${droppedBlocklist}, ${survivedFix3.length} remain`
      );
    }

    // ── Step 3.6: CP360 Phase 1-A — Per-cell hard view_count gate ─────
    // Rationale: experiment #2 showed 66% of "조카 교육" candidates had
    // fewer than 10K views and those low-quality uploads routinely beat
    // high-view Korean videos because iksTotal is identical within a
    // cell, leaving videoQuality + freshness to decide — and the
    // log-scale videoQuality alone isn't decisive enough for hard
    // quality guarantees.
    //
    // Strategy: per cell, apply the hard floor (MIN_VIEW_COUNT). If that
    // would leave the cell with zero candidates, relax to
    // MIN_VIEW_COUNT_RELAX so users still get SOMETHING rather than a
    // blank cell. This preserves the "top-3 per cell" contract while
    // eliminating the long tail of <10K junk.
    //
    // `viewCount === null` → keep (no signal; videos.list enrichment may
    // have failed for that video specifically, don't penalize twice).
    let droppedByViewGate = 0;
    let relaxedCells = 0;
    const byCellPre = new Map<number, RecommendationCandidate[]>();
    for (const c of survivedFix3) {
      const arr = byCellPre.get(c.cellIndex);
      if (arr) arr.push(c);
      else byCellPre.set(c.cellIndex, [c]);
    }
    const filteredAllCandidates: RecommendationCandidate[] = [];
    for (const [cellIdx, cands] of byCellPre) {
      const passesHard = cands.filter((c) => c.viewCount === null || c.viewCount >= MIN_VIEW_COUNT);
      if (passesHard.length > 0) {
        filteredAllCandidates.push(...passesHard);
        droppedByViewGate += cands.length - passesHard.length;
      } else {
        // Relax: cell would be empty. Apply the softer floor.
        const passesRelax = cands.filter(
          (c) => c.viewCount === null || c.viewCount >= MIN_VIEW_COUNT_RELAX
        );
        if (passesRelax.length > 0) {
          filteredAllCandidates.push(...passesRelax);
          droppedByViewGate += cands.length - passesRelax.length;
          relaxedCells += 1;
          log.info(
            `view-gate relaxed cell=${cellIdx}: 0 candidates ≥${MIN_VIEW_COUNT}, accepted ${passesRelax.length} ≥${MIN_VIEW_COUNT_RELAX}`
          );
        } else {
          // Even relaxed produced nothing. The cell was either empty or
          // all candidates had viewCount=0 (rare but possible). Drop all.
          droppedByViewGate += cands.length;
        }
      }
    }
    if (droppedByViewGate > 0) {
      log.info(
        `view-gate filter: dropped ${droppedByViewGate} candidates <${MIN_VIEW_COUNT} views (relaxed cells: ${relaxedCells}), ${filteredAllCandidates.length} remain`
      );
    }

    // ── Step 4: Compute Rec Score + pick top RECS_PER_CELL per cell ────
    const now = Date.now();
    for (const cand of filteredAllCandidates) {
      cand.videoQuality = computeVideoQuality(cand);
      cand.freshness = computeFreshness(cand.publishedAt, now);
      cand.recScore = computeRecScore(cand);
    }

    const byCell = new Map<number, RecommendationCandidate[]>();
    for (const cand of filteredAllCandidates) {
      const arr = byCell.get(cand.cellIndex);
      if (arr) arr.push(cand);
      else byCell.set(cand.cellIndex, [cand]);
    }

    let finalRecommendations: RecommendationCandidate[] = [];
    for (const [, cands] of byCell) {
      cands.sort((a, b) => (b.recScore ?? 0) - (a.recScore ?? 0));
      // Apply diversity: drop duplicate channels within the same cell
      const seenChannels = new Set<string>();
      const cellTop: RecommendationCandidate[] = [];
      for (const c of cands) {
        if (cellTop.length >= VIDEO_DISCOVER_RECS_PER_CELL) break;
        if (seenChannels.has(c.channelId)) continue;
        seenChannels.add(c.channelId);
        cellTop.push(c);
      }
      finalRecommendations.push(...cellTop);
    }

    // ── Step 4.5: Fix 3 (CP358) — Global channel diversity cap ────────
    // Per-cell dedup runs above, but a noisy channel can still surface in
    // 3+ different cells. If any channel contributes >= GLOBAL_CHANNEL_CAP_THRESHOLD
    // recommendations, collapse it to its highest-scored video only. We
    // accept the resulting drop in total recommendation count (quality > quantity).
    const channelCounts = new Map<string, number>();
    for (const r of finalRecommendations) {
      if (!r.channelId) continue;
      channelCounts.set(r.channelId, (channelCounts.get(r.channelId) ?? 0) + 1);
    }
    const overusedChannels = new Set<string>();
    for (const [ch, count] of channelCounts) {
      if (count >= GLOBAL_CHANNEL_CAP_THRESHOLD) overusedChannels.add(ch);
    }
    let droppedByChannelCap = 0;
    if (overusedChannels.size > 0) {
      // Sort globally so the highest-scored video for each overused channel wins
      const sorted = [...finalRecommendations].sort(
        (a, b) => (b.recScore ?? 0) - (a.recScore ?? 0)
      );
      const keptChannels = new Set<string>();
      const kept: RecommendationCandidate[] = [];
      for (const r of sorted) {
        if (overusedChannels.has(r.channelId)) {
          if (keptChannels.has(r.channelId)) {
            droppedByChannelCap += 1;
            continue;
          }
          keptChannels.add(r.channelId);
        }
        kept.push(r);
      }
      finalRecommendations = kept;
      log.info(
        `Fix 3 channel cap: ${overusedChannels.size} overused channel(s), dropped ${droppedByChannelCap} duplicates`
      );
    }

    // ── Step 4.6: CP360 Phase 1-F — LLM Reranking (final quality gate) ─
    //
    // A single OpenRouter call judges the remaining candidates Y/N for
    // genuine learning value. Handles two failure modes gracefully:
    //
    //   1. Complete failure (HTTP error, empty content, both parse layers
    //      fail) → verdicts empty → ALL candidates pass through unchanged.
    //      Reranking is a soft signal — we never block the pipeline on it.
    //
    //   2. Partial parse — strict JSON finds some verdicts, loose regex
    //      finds others, some indices missing entirely. Only the explicit
    //      'N' verdicts drop; missing ones default to KEEP. This protects
    //      against the false-negative case where the model glitches on
    //      half the batch and we'd otherwise drop legitimate content.
    //
    // Kill switch: VIDEO_DISCOVER_DISABLE_RERANK=1.
    // Missing OpenRouter key: silently skipped (graceful degradation).
    let rerankDropped = 0;
    let rerankParsedCount = 0;
    let rerankParseMode: 'json' | 'regex' | 'failed' | 'skipped' = 'skipped';
    let rerankDurationMs = 0;
    let rerankError: string | null = null;
    if (
      state.rerankDisabled ||
      !state.openRouterApiKey ||
      !state.openRouterModel ||
      finalRecommendations.length === 0
    ) {
      if (state.rerankDisabled) {
        log.info('VIDEO_DISCOVER_DISABLE_RERANK=1 — skipping LLM reranking');
      } else if (!state.openRouterApiKey || !state.openRouterModel) {
        log.info('LLM reranking skipped — OpenRouter not configured');
      }
    } else {
      // Batch all finalRecommendations into a single rerank call. With 8
      // cells × 3 recs/cell = 24 max candidates this comfortably fits in
      // the default DEFAULT_BATCH_SIZE=20 when some cells contributed <3
      // (which is the common case after the view gate). If it ever grows
      // past 20 the reranker slices internally — the rest pass through
      // as KEEP, matching the soft-signal policy.
      const rerankInputs: RerankCandidate[] = finalRecommendations.map((r, idx) => ({
        index: idx,
        title: r.title,
        channel: r.channel,
      }));
      try {
        const rerankResult = await rerankBatch({
          candidates: rerankInputs,
          centerGoal: state.centerGoal,
          language: state.mandalaLanguage,
          apiKey: state.openRouterApiKey,
          model: state.openRouterModel,
          fetchImpl: fetchFn,
        });
        rerankParsedCount = rerankResult.parsedCount;
        rerankParseMode = rerankResult.parseMode;
        rerankDurationMs = rerankResult.durationMs;
        rerankError = rerankResult.error;

        if (rerankResult.verdicts.size > 0) {
          const keptAfterRerank = finalRecommendations.filter((_, idx) => {
            const verdict = rerankResult.verdicts.get(idx);
            // Undefined = missing verdict = default KEEP (protects against
            // partial parse wiping legitimate content). Only explicit N drops.
            return verdict !== 'N';
          });
          rerankDropped = finalRecommendations.length - keptAfterRerank.length;
          finalRecommendations = keptAfterRerank;
          log.info(
            `rerank: parsed=${rerankResult.parsedCount}/${rerankInputs.length} mode=${rerankResult.parseMode} dropped=${rerankDropped} remain=${finalRecommendations.length} ${rerankResult.durationMs}ms`
          );
        } else {
          log.warn(
            `rerank produced zero verdicts (mode=${rerankResult.parseMode}, error=${rerankResult.error ?? 'none'}) — passing all ${finalRecommendations.length} candidates through`
          );
        }
      } catch (err) {
        // rerankBatch never throws per contract, but defensive belt.
        rerankError = err instanceof Error ? err.message : String(err);
        log.warn(`rerank threw unexpectedly (bug in rerankBatch?): ${rerankError}`);
      }
    }

    // ── Step 5: Upsert to recommendation_cache ─────────────────────────
    let upserted = 0;
    let upsertErrors = 0;
    for (const rec of finalRecommendations) {
      try {
        await db.recommendation_cache.upsert({
          where: {
            user_id_mandala_id_video_id: {
              user_id: state.userId,
              mandala_id: state.mandalaId,
              video_id: rec.videoId,
            },
          },
          create: {
            user_id: state.userId,
            mandala_id: state.mandalaId,
            cell_index: rec.cellIndex,
            keyword: rec.keyword,
            domain: null,
            video_id: rec.videoId,
            title: rec.title,
            thumbnail: rec.thumbnail || null,
            channel: rec.channel || null,
            channel_subs: null,
            view_count: rec.viewCount,
            like_ratio:
              rec.viewCount && rec.viewCount > 0 && rec.likeCount !== null
                ? rec.likeCount / rec.viewCount
                : null,
            // CP360 H-2 — was hardcoded `null`, discarding the parsed
            // contentDetails.duration from videos.list. Persisted for
            // downstream freshness / shorts auditing.
            duration_sec: rec.durationSec,
            // CP360 H-2 — new column, persists YouTube publishedAt so we
            // can retroactively ask "how old was this recommendation at
            // the time we served it?" and tune FRESHNESS_HORIZON_DAYS.
            published_at: safeParseDate(rec.publishedAt),
            rec_score: rec.recScore ?? 0,
            iks_score: rec.iksTotal,
            trend_keywords: [
              {
                keyword: rec.keyword,
                iks_total: rec.iksTotal,
                per_mandala_relevance: rec.perMandalaRelevance,
              },
            ] as Prisma.InputJsonValue,
            rec_reason: buildRecReason(rec),
            status: 'pending',
            weight_version: 1,
            expires_at: expiresAt,
          },
          update: {
            cell_index: rec.cellIndex,
            keyword: rec.keyword,
            title: rec.title,
            thumbnail: rec.thumbnail || null,
            channel: rec.channel || null,
            view_count: rec.viewCount,
            like_ratio:
              rec.viewCount && rec.viewCount > 0 && rec.likeCount !== null
                ? rec.likeCount / rec.viewCount
                : null,
            // CP360 H-2 — propagate to existing rows on re-run so old
            // rows pick up the columns after the first rerun. Idempotent.
            duration_sec: rec.durationSec,
            published_at: safeParseDate(rec.publishedAt),
            rec_score: rec.recScore ?? 0,
            iks_score: rec.iksTotal,
            trend_keywords: [
              {
                keyword: rec.keyword,
                iks_total: rec.iksTotal,
                per_mandala_relevance: rec.perMandalaRelevance,
              },
            ] as Prisma.InputJsonValue,
            rec_reason: buildRecReason(rec),
            expires_at: expiresAt,
          },
        });
        upserted += 1;
      } catch (err) {
        upsertErrors += 1;
        log.warn(
          `recommendation_cache upsert failed for video ${rec.videoId}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    const status: ExecuteResult['status'] =
      upsertErrors === 0 && upserted > 0 ? 'success' : upserted > 0 ? 'partial' : 'failed';

    return {
      status,
      data: {
        cells: state.subGoals.length,
        keyword_pool_size: state.keywords.length,
        cell_keyword_pairs: cellSelections.length,
        llm_query_gen_success: llmQueryGenSuccess,
        llm_query_gen_failures: llmQueryGenFailures,
        race_wins_ollama: raceWinsOllama,
        race_wins_openrouter: raceWinsOpenRouter,
        race_both_failed: raceBothFailed,
        cells_served_from_cache: cellsServedFromCache,
        cache_hits_total: cacheHitsTotal,
        quota_saved_units: quotaSavedUnits,
        rerank_parsed_count: rerankParsedCount,
        rerank_parse_mode: rerankParseMode,
        rerank_duration_ms: rerankDurationMs,
        rerank_dropped: rerankDropped,
        rerank_error: rerankError,
        search_calls: searchCalls,
        search_failures: searchFailures,
        candidates_total: allCandidates.length,
        candidates_unique_videos: uniqueVideoIds.length,
        recommendations_upserted: upserted,
        upsert_errors: upsertErrors,
        sample_recs: finalRecommendations.slice(0, 5).map((r) => ({
          cell: r.cellIndex,
          keyword: r.keyword,
          title: r.title,
          rec_score: Math.round((r.recScore ?? 0) * 1000) / 1000,
          per_mandala_relevance: Math.round(r.perMandalaRelevance * 1000) / 1000,
        })),
      },
      metrics: {
        duration_ms: Date.now() - t0,
        rows_written: { recommendation_cache: upserted },
      },
    };
  },
};

// ============================================================================
// YouTube API helpers
//
// Dual-auth mode (CP360 quota relief):
//   - If `apiKey` is non-empty, request is signed with `?key=<apiKey>` and
//     hits the key's owning GCP project quota bucket. This is the preferred
//     path for server-side search.list — the data is public, so no OAuth
//     scope is required, and a dedicated project gives us an independent
//     10K/day bucket.
//   - If `apiKey` is empty, fall back to the legacy OAuth Bearer path.
//     Quota then counts against the OAuth client's project (currently the
//     same one as YOUTUBE_CLIENT_ID).
//
// Same helper is used by both search.list and videos.list because the
// code path is identical: both endpoints accept either auth mode and
// return public data.
// ============================================================================

interface YouTubeSearchOpts {
  query: string;
  oauthToken: string;
  /**
   * CP360 — dedicated API key for search.list. Non-empty value switches
   * from OAuth Bearer to `?key=` auth (routes traffic to a different GCP
   * project quota). Empty string preserves legacy OAuth behavior.
   */
  apiKey: string;
  maxResults: number;
  fetchFn: typeof fetch;
  /**
   * ISO 639-1 language code (e.g. 'ko', 'en'). Passed to YouTube as
   * `relevanceLanguage`. Fix 1 (CP358) — was hardcoded 'ko' before.
   */
  relevanceLanguage: string;
  /**
   * Optional ISO 3166-1 alpha-2 region code (e.g. 'KR', 'US'). Passed to
   * YouTube as `regionCode`. Skipped when caller cannot map the language
   * to a region. Fix 1 (CP358) — was hardcoded 'KR' before.
   */
  regionCode?: string;
}

async function youtubeSearch(opts: YouTubeSearchOpts): Promise<YouTubeSearchItem[]> {
  const url = new URL(`${YOUTUBE_API_BASE}/search`);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('type', 'video');
  url.searchParams.set('q', opts.query);
  url.searchParams.set('maxResults', String(opts.maxResults));
  url.searchParams.set('relevanceLanguage', opts.relevanceLanguage);
  if (opts.regionCode) {
    url.searchParams.set('regionCode', opts.regionCode);
  }
  // Fix 1 (CP358): drop Shorts (<60s) and the long-form bucket (>20min) at
  // the search-API level. The API filter is not 100% accurate, so Fix 3 also
  // post-filters by parsed duration after videos.list returns.
  url.searchParams.set('videoDuration', 'medium');
  url.searchParams.set('safeSearch', 'moderate');

  // Dual-auth: API key preferred, OAuth Bearer fallback (CP360 quota relief)
  const headers: Record<string, string> = {};
  if (opts.apiKey) {
    url.searchParams.set('key', opts.apiKey);
  } else {
    headers['Authorization'] = `Bearer ${opts.oauthToken}`;
  }

  const res = await opts.fetchFn(url.toString(), { headers });
  if (!res.ok) {
    let msg = '';
    try {
      const body = (await res.json()) as YouTubeSearchResponse;
      msg = body.error?.message ?? '';
    } catch {
      // ignore
    }
    throw new Error(`search.list HTTP ${res.status}${msg ? ` — ${msg}` : ''}`);
  }
  const body = (await res.json()) as YouTubeSearchResponse;
  if (body.error) throw new Error(`search.list error: ${body.error.message}`);
  return body.items ?? [];
}

interface YouTubeVideosBatchOpts {
  videoIds: string[];
  oauthToken: string;
  /** CP360 — dedicated API key (see youtubeSearch docs). */
  apiKey: string;
  fetchFn: typeof fetch;
}

async function youtubeVideosBatch(opts: YouTubeVideosBatchOpts): Promise<YouTubeVideoStatsItem[]> {
  if (opts.videoIds.length === 0) return [];
  if (opts.videoIds.length > VIDEOS_LIST_MAX_IDS_PER_CALL) {
    throw new Error(
      `youtubeVideosBatch called with ${opts.videoIds.length} ids — caller must chunk to ${VIDEOS_LIST_MAX_IDS_PER_CALL}`
    );
  }
  const url = new URL(`${YOUTUBE_API_BASE}/videos`);
  url.searchParams.set('part', 'statistics,contentDetails');
  url.searchParams.set('id', opts.videoIds.join(','));
  // NOTE: maxResults is NOT applicable when querying by id (YouTube Data API
  // returns one item per id specified, up to the 50-id limit). Setting it
  // would be a no-op at best and a source of confusion at worst.

  // Dual-auth: API key preferred, OAuth Bearer fallback (CP360 quota relief)
  const headers: Record<string, string> = {};
  if (opts.apiKey) {
    url.searchParams.set('key', opts.apiKey);
  } else {
    headers['Authorization'] = `Bearer ${opts.oauthToken}`;
  }

  const res = await opts.fetchFn(url.toString(), { headers });
  if (!res.ok) {
    let msg = '';
    try {
      const body = (await res.json()) as YouTubeVideosResponse;
      msg = body.error?.message ?? '';
    } catch {
      // ignore
    }
    throw new Error(`videos.list HTTP ${res.status}${msg ? ` — ${msg}` : ''}`);
  }
  const body = (await res.json()) as YouTubeVideosResponse;
  if (body.error) throw new Error(`videos.list error: ${body.error.message}`);
  return body.items ?? [];
}

// ============================================================================
// Rec Score components
// ============================================================================

function computeVideoQuality(cand: RecommendationCandidate): number {
  // Two signals are available with different reliability:
  //   - viewCount       : almost always present in videos.list response
  //   - likeCount       : often missing — YouTube hides counts for many videos
  //
  // Strategy:
  //   - If viewCount missing entirely → 0.5 neutral (no signal)
  //   - If only viewCount → log-scale quality, [0..1]
  //   - If both present → 70% like_ratio + 30% view_log
  if (cand.viewCount === null || cand.viewCount <= 0) return 0.5;

  // View-count signal: log10 scale capped at 10M views = 1.0
  // 100 views → 0.29, 10K → 0.57, 100K → 0.71, 1M → 0.86, 10M+ → 1.00
  const viewLog = Math.log10(cand.viewCount + 1) / Math.log10(VIDEO_QUALITY_REFERENCE_VIEWS);
  const viewSignal = viewLog < 0 ? 0 : viewLog > 1 ? 1 : viewLog;

  if (cand.likeCount === null || cand.likeCount < 0) {
    // No like data — view_count is the only signal
    return viewSignal;
  }

  // Like ratio signal: YouTube avg ~4%, 8%+ → top
  const likeRatio = cand.likeCount / cand.viewCount;
  const LIKE_RATIO_TOP = 0.08;
  const likeSignalRaw = likeRatio / LIKE_RATIO_TOP;
  const likeSignal = likeSignalRaw < 0 ? 0 : likeSignalRaw > 1 ? 1 : likeSignalRaw;

  // Blended (70/30) — likes is the stronger signal but views are more reliable
  return likeSignal * 0.7 + viewSignal * 0.3;
}

function computeFreshness(publishedAt: string, nowMs: number): number {
  const publishedMs = Date.parse(publishedAt);
  if (Number.isNaN(publishedMs)) return 0.5;
  const ageDays = (nowMs - publishedMs) / MS_PER_DAY;
  if (ageDays < 0) return 1.0;
  if (ageDays > FRESHNESS_HORIZON_DAYS) return 0.0;
  return 1 - ageDays / FRESHNESS_HORIZON_DAYS;
}

function computeRecScore(cand: RecommendationCandidate): number {
  const iksNorm = cand.iksTotal / 100;
  // per_mandala_relevance is in [0, 1] (cosineToRelevance mapping in
  // iks-scorer/embedding.ts converts cosine [-1, 1] → [0, 1]).
  const perMandala =
    cand.perMandalaRelevance < 0 ? 0 : cand.perMandalaRelevance > 1 ? 1 : cand.perMandalaRelevance;
  return (
    iksNorm * REC_WEIGHT_IKS +
    (cand.videoQuality ?? 0.5) * REC_WEIGHT_VIDEO_QUALITY +
    (cand.freshness ?? 0.5) * REC_WEIGHT_FRESHNESS +
    perMandala * REC_WEIGHT_PER_MANDALA +
    0.5 * REC_WEIGHT_HISTORICAL // Layer 4 placeholder until feedback loop ships
  );
}

function buildRecReason(cand: RecommendationCandidate): string {
  const rel = Math.round(cand.perMandalaRelevance * 100);
  return `Matches your goal "${cand.keyword}" (relevance ${rel}%, IKS ${Math.round(cand.iksTotal)})`;
}

// ============================================================================
// Math helpers (duplicated from iks-scorer per plugin §6 cross-import rule)
// ============================================================================

function dot(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return sum;
}

function parseVectorLiteral(literal: string): number[] {
  if (!literal || literal.length < 2) return [];
  const inner = literal.startsWith('[') && literal.endsWith(']') ? literal.slice(1, -1) : literal;
  const parts = inner.split(',');
  const out = new Array<number>(parts.length);
  for (let i = 0; i < parts.length; i++) {
    out[i] = parseFloat(parts[i] ?? '0');
  }
  return out;
}

// ============================================================================
// Fix 3 (CP358) — Filter helpers
// ============================================================================

/**
 * Parse an ISO 8601 duration string (`PT1H2M3S`) into total seconds.
 * Returns `null` for missing/unparseable input. Implementation duplicated
 * from YouTubeAdapter.parseDuration to comply with the plugin cross-import
 * rule (CLAUDE.md §plugin cross-import). Exported for unit tests.
 */
export function parseIsoDuration(iso?: string | null): number | null {
  if (!iso) return null;
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  const h = parseInt(m[1] ?? '0', 10);
  const mi = parseInt(m[2] ?? '0', 10);
  const s = parseInt(m[3] ?? '0', 10);
  if (Number.isNaN(h) || Number.isNaN(mi) || Number.isNaN(s)) return null;
  // Reject the empty `PT` case (no hours/minutes/seconds groups matched)
  if (h === 0 && mi === 0 && s === 0 && iso === 'PT') return null;
  return h * 3600 + mi * 60 + s;
}

/**
 * CP360 — classify a YouTube search error message into a short code so
 * skill_runs.error / failure_classification carries something actionable.
 * The search call throws with shapes like:
 *   "search.list HTTP 403 — The request cannot be completed because you have exceeded your quota."
 *   "search.list HTTP 401 — Invalid Credentials"
 *   "search.list HTTP 400 — Invalid search parameter"
 *   "fetch failed"
 * Unknown messages fall through to 'unknown_search_error'.
 *
 * Kept case-insensitive on the message body since YouTube occasionally
 * changes wording. Exported for unit tests.
 */
/**
 * CP360 H-2 — parse a YouTube ISO-8601 publishedAt string into a Date,
 * returning `null` on any parse error rather than throwing. YouTube
 * publishedAt is always ISO-8601 in practice, but `pushCandidate` falls
 * back to `new Date().toISOString()` on missing values — those are valid
 * but we still want to defensively handle any future edge case.
 */
function safeParseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Extract 2+ char topic tokens from a goal/sub_goal text. Used by the
 * cache reuse title-overlap filter. Korean substrings, English words,
 * digits — anything 2+ chars wide. Lowercased for case-insensitive match.
 *
 * Stopwords are intentionally minimal: short connectives like "및" / "의"
 * are already < 2 chars after splitting, so the token length filter does
 * most of the work.
 */
export function extractTopicTokens(text: string): string[] {
  if (!text) return [];
  const cleaned = text.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  const tokens = cleaned
    .split(/\s+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 2);
  return Array.from(new Set(tokens));
}

/**
 * Return true if the title contains at least one of the given tokens as
 * a case-insensitive substring. Empty title or empty tokens → true (give
 * benefit of doubt, downstream rerank catches outliers).
 */
export function titleMatchesAnyToken(title: string, tokens: string[]): boolean {
  if (!title || tokens.length === 0) return true;
  const lower = title.toLowerCase();
  for (const t of tokens) {
    if (lower.includes(t)) return true;
  }
  return false;
}

export function classifySearchError(msg: string): string {
  if (!msg) return 'unknown_search_error';
  const lower = msg.toLowerCase();
  if (lower.includes('quota') || lower.includes('quotaexceeded')) {
    return 'youtube_quota_exhausted';
  }
  if (lower.includes('403')) {
    // 403 without "quota" often means OAuth scope or daily limit hit
    return 'youtube_forbidden';
  }
  if (
    lower.includes('401') ||
    lower.includes('invalid credentials') ||
    lower.includes('unauthorized')
  ) {
    return 'oauth_token_invalid';
  }
  if (lower.includes('400')) {
    return 'youtube_bad_request';
  }
  if (lower.includes('429')) {
    return 'youtube_rate_limited';
  }
  if (lower.includes('5') && /\b5\d\d\b/.test(lower)) {
    return 'youtube_server_error';
  }
  if (lower.includes('fetch failed') || lower.includes('network') || lower.includes('timeout')) {
    return 'network_error';
  }
  return 'unknown_search_error';
}

/**
 * Returns `true` if the title contains any TITLE_BLOCKLIST entry as a
 * case-insensitive substring. Empty/null titles return `false`.
 * Exported for unit tests.
 */
export function titleContainsBlocked(title: string): boolean {
  if (!title) return false;
  const lower = title.toLowerCase();
  for (const t of TITLE_BLOCKLIST) {
    if (lower.includes(t.toLowerCase())) return true;
  }
  return false;
}
