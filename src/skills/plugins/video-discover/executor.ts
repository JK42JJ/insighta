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
import { generateSearchQueries, LlmQueryGenError } from './sources/llm-query-generator';

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
 * Days after which freshness drops to 0. Educational content has a longer
 * useful shelf life than entertainment, so 180 days (6 months) is more
 * realistic than the original 90.
 */
const FRESHNESS_HORIZON_DAYS = 180;
/** Max IDs per videos.list call (YouTube Data API hard limit). */
const VIDEOS_LIST_MAX_IDS_PER_CALL = 50;
/** Reference view count that maps to videoQuality 1.0 on the log scale. */
const VIDEO_QUALITY_REFERENCE_VIEWS = 10_000_000;

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

    const hydrated: HydratedState = {
      mandalaId,
      userId: ctx.userId,
      oauthToken: oauth.youtube_access_token,
      subGoals,
      keywords,
      mandalaLanguage,
      centerGoal,
      llmUrl,
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
    // hiccup. Quota: 8 cells × 3 queries × 100 = 2,400 units (24% of daily 10k).
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

    async function runSearch(
      sel: { cell: SubGoalCell; keyword: KeywordRow; perMandalaRelevance: number },
      query: string
    ): Promise<void> {
      try {
        const items = await youtubeSearch({
          query,
          oauthToken: state.oauthToken,
          maxResults: VIDEO_DISCOVER_SEARCH_RESULTS_PER_CELL,
          fetchFn,
          relevanceLanguage: state.mandalaLanguage,
          regionCode,
        });
        searchCalls += 1;
        for (const item of items) pushCandidate(sel, item);
      } catch (err) {
        searchFailures += 1;
        log.warn(
          `YouTube search failed for cell ${sel.cell.cellIndex} q="${query}": ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    for (const sel of cellSelections) {
      let queries: string[] | null = null;
      try {
        queries = await generateSearchQueries({
          subGoal: sel.cell.text,
          centerGoal: state.centerGoal,
          language: state.mandalaLanguage,
          baseUrl: state.llmUrl,
          fetchImpl: fetchFn,
        });
        // Hard cap defensively even though the parser already limits.
        if (queries.length > VIDEO_DISCOVER_QUERIES_PER_CELL) {
          queries = queries.slice(0, VIDEO_DISCOVER_QUERIES_PER_CELL);
        }
        llmQueryGenSuccess += 1;
      } catch (err) {
        llmQueryGenFailures += 1;
        if (err instanceof LlmQueryGenError) {
          log.warn(
            `LLM query gen failed for cell ${sel.cell.cellIndex} (falling back to concat): ${err.message}`
          );
        } else {
          log.warn(
            `LLM query gen unexpected error for cell ${sel.cell.cellIndex}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
        queries = null;
      }

      if (queries && queries.length > 0) {
        for (const q of queries) {
          await runSearch(sel, q);
        }
      } else {
        // Fallback: legacy single concat query
        await runSearch(sel, `${sel.cell.text} ${sel.keyword.keyword}`);
      }
    }
    log.info(
      `LLM query gen: success=${llmQueryGenSuccess}, failures=${llmQueryGenFailures}, search_calls=${searchCalls}`
    );

    if (allCandidates.length === 0) {
      return {
        status: 'failed',
        data: {
          search_calls: searchCalls,
          search_failures: searchFailures,
          candidates: 0,
        },
        error: 'YouTube search returned 0 candidate videos',
        metrics: { duration_ms: Date.now() - t0 },
      };
    }

    // ── Step 3: Batch videos.list to fetch view + like counts ──────────
    // YouTube Data API caps `id` parameter at 50 — chunk accordingly.
    // 1 quota unit per chunk, regardless of id count.
    const uniqueVideoIds = Array.from(new Set(allCandidates.map((c) => c.videoId)));
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
    // contain entries from TITLE_BLOCKLIST (drama / vlog / reaction noise).
    // The YouTube Search `videoDuration=medium` param (Fix 1) already filters
    // most Shorts at the API boundary, but it's not 100% accurate so this is
    // a defense-in-depth pass. Candidates with `durationSec === null` are
    // kept (no signal == benefit of doubt).
    const beforeFilter = allCandidates.length;
    const filteredAllCandidates = allCandidates.filter((c) => {
      if (c.durationSec !== null && c.durationSec < MIN_DURATION_SEC) return false;
      if (titleContainsBlocked(c.title)) return false;
      return true;
    });
    const droppedShortsBlocklist = beforeFilter - filteredAllCandidates.length;
    if (droppedShortsBlocklist > 0) {
      log.info(
        `Fix 3 filter: dropped ${droppedShortsBlocklist} candidates (Shorts + blocklist), ${filteredAllCandidates.length} remain`
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
            duration_sec: null,
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
// YouTube API helpers (user OAuth Bearer)
// ============================================================================

interface YouTubeSearchOpts {
  query: string;
  oauthToken: string;
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

  const res = await opts.fetchFn(url.toString(), {
    headers: { Authorization: `Bearer ${opts.oauthToken}` },
  });
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

  const res = await opts.fetchFn(url.toString(), {
    headers: { Authorization: `Bearer ${opts.oauthToken}` },
  });
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
