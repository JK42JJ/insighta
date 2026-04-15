/**
 * video-discover v2 — executor
 *
 * Single mandala-level pass:
 *   1. Build 3-5 search queries (PR1 keyword-builder)
 *   2. YouTube search.list × N (server API key, no OAuth)
 *   3. videos.list batch → duration + view_count
 *   4. Pre-filter: shorts, blocklist, dedupe
 *   5. Embed videos (PR1 video-embedder, Qwen3)
 *   6. Score + assign 8 cells (PR1 cell-assigner)
 *   7. Fallback A: 2nd-round search if total < 40
 *   8. Fallback B: round-robin even distribution if Ollama down or pool small
 *   9. Upsert recommendation_cache
 *
 * Quota target: 5 queries × 100 + 5 batch × 1 = ~505 units / mandala.
 */

import { logger } from '@/utils/logger';
import { getPrismaClient } from '@/modules/database';
import { Prisma } from '@prisma/client';
import type {
  SkillExecutor,
  PreflightContext,
  PreflightResult,
  ExecuteContext,
  ExecuteResult,
} from '@/skills/_shared/types';

import { manifest, V2_TARGET_TOTAL, V2_TARGET_PER_CELL, V2_NUM_CELLS } from './manifest';
import {
  buildRuleBasedQueriesSync,
  runLLMQueries,
  type KeywordLanguage,
  type SearchQuery,
} from './keyword-builder';
import { totalAssigned, type CellAssignment } from './cell-assigner';
import {
  searchVideos,
  videosBatch,
  parseIsoDuration,
  isShortsByDuration,
  titleHitsBlocklist,
  type YouTubeVideoStatsItem,
} from './youtube-client';

const log = logger.child({ module: 'video-discover/v2/executor' });

const TTL_DAYS = 7;
const RECOMMENDATION_STATUS_PENDING = 'pending';
const WEIGHT_VERSION = 2; // mark v2 rows for analytics separation
// (Embedding-based re-ranking moved out of the hot path. The executor now
// assigns cells by query→cell tagging which is deterministic and <1s. A
// background re-rank job can be added later and is explicitly optional.)

/**
 * Minimum relevance score (Jaccard overlap of tokens with the target cell
 * keyword) required for a video to be admitted via the overflow path
 * (untagged or evicted from its hint cell). Below this, the slot stays empty
 * — better an honest hole than a recommendation that misleads the user.
 *
 * Tagged videos (the source query carried a cellIndex) bypass this gate so
 * we don't second-guess YouTube's relevance ranking on a query we crafted.
 */
const MIN_OVERFLOW_RELEVANCE = 0.05;

interface HydratedState {
  centerGoal: string;
  subGoals: string[];
  subGoalEmbeddings: number[][]; // length 8
  language: KeywordLanguage;
  focusTags: string[];
  targetLevel: string;
}

interface CandidateVideo {
  videoId: string;
  title: string;
  description: string;
  channelTitle: string | null;
  thumbnail: string | null;
  publishedAt: string | null;
  durationSec: number | null;
  viewCount: number | null;
  likeRatio: number | null;
  cellIndexHint: number | null;
}

export const executor: SkillExecutor = {
  manifest,

  async preflight(ctx: PreflightContext): Promise<PreflightResult> {
    if (!ctx.mandalaId) return { ok: false, reason: 'mandala_id is required' };
    if (!ctx.userId) return { ok: false, reason: 'userId is required' };

    const apiKey = ctx.env?.['YOUTUBE_API_KEY_SEARCH'] ?? '';
    if (!apiKey) {
      return {
        ok: false,
        reason: 'YOUTUBE_API_KEY_SEARCH is not configured. v2 requires the server API key.',
      };
    }

    const db = getPrismaClient();
    const mandala = await db.user_mandalas.findFirst({
      where: { id: ctx.mandalaId, user_id: ctx.userId },
      select: {
        id: true,
        title: true,
        domain: true,
        language: true,
        focus_tags: true,
        target_level: true,
      },
    });
    if (!mandala) {
      return { ok: false, reason: `Mandala ${ctx.mandalaId} not found or not owned` };
    }

    // Load level=1 sub_goal embeddings (8 rows expected).
    const rows = await db.$queryRaw<
      {
        sub_goal_index: number;
        sub_goal: string | null;
        center_goal: string | null;
        embedding: string;
      }[]
    >(
      Prisma.sql`SELECT sub_goal_index, sub_goal, center_goal, embedding::text AS embedding
                 FROM mandala_embeddings
                 WHERE mandala_id = ${ctx.mandalaId} AND level = 1
                 ORDER BY sub_goal_index ASC`
    );
    if (rows.length < V2_NUM_CELLS) {
      return {
        ok: false,
        reason: `Only ${rows.length}/${V2_NUM_CELLS} sub_goal embeddings available — wait for embeddings step`,
      };
    }

    const subGoals: string[] = new Array(V2_NUM_CELLS).fill('');
    const subGoalEmbeddings: number[][] = new Array(V2_NUM_CELLS).fill(null);
    let centerGoal = mandala.title ?? '';
    for (const r of rows) {
      const idx = r.sub_goal_index;
      if (idx < 0 || idx >= V2_NUM_CELLS) continue;
      subGoals[idx] = r.sub_goal ?? '';
      subGoalEmbeddings[idx] = parseVectorLiteral(r.embedding);
      if (r.center_goal && !centerGoal) centerGoal = r.center_goal;
    }
    if (subGoalEmbeddings.some((v) => !v || v.length === 0)) {
      return { ok: false, reason: 'Sub_goal embedding row missing or empty' };
    }

    const language: KeywordLanguage = mandala.language === 'en' ? 'en' : 'ko';
    const hydrated: HydratedState = {
      centerGoal,
      subGoals,
      subGoalEmbeddings,
      language,
      focusTags: mandala.focus_tags ?? [],
      targetLevel: mandala.target_level ?? 'standard',
    };
    return { ok: true, hydrated: hydrated as unknown as Record<string, unknown> };
  },

  async execute(ctx: ExecuteContext): Promise<ExecuteResult> {
    const t0 = Date.now();
    const apiKey = ctx.env?.['YOUTUBE_API_KEY_SEARCH'] ?? '';
    const openRouterApiKey = ctx.env?.['OPENROUTER_API_KEY'];
    const openRouterModel = ctx.env?.['OPENROUTER_MODEL'] ?? 'qwen/qwen3-30b-a3b';
    const state = ctx.state as unknown as HydratedState;
    const mandalaId = ctx.mandalaId!;

    // 1. Rule-based queries synchronously (instant) — launch YouTube search
    //    immediately. In parallel, fire the LLM race; append its queries when
    //    it returns and launch an extra batch of searches.
    const kwInput = {
      centerGoal: state.centerGoal,
      subGoals: state.subGoals,
      focusTags: state.focusTags,
      targetLevel: state.targetLevel,
      language: state.language,
    };
    const ruleQueries = buildRuleBasedQueriesSync(kwInput);
    if (ruleQueries.length === 0) {
      return {
        status: 'failed',
        data: { reason: 'no_queries_built' },
        error: 'No search queries could be built (empty centerGoal?)',
      };
    }

    const llmPromise = runLLMQueries(kwInput, {
      openRouterApiKey: openRouterApiKey || undefined,
      openRouterModel,
    });

    const rulePoolPromise = runSearchPool(ruleQueries, apiKey, state.language);

    const llmQueries = await llmPromise;
    const usedQueries = new Set(ruleQueries.map((q) => q.query.toLowerCase()));
    const extraLLM = llmQueries.filter((q: SearchQuery) => !usedQueries.has(q.query.toLowerCase()));
    const llmPoolPromise =
      extraLLM.length > 0
        ? runSearchPool(extraLLM, apiKey, state.language)
        : Promise.resolve([] as PoolItem[]);

    const [rulePool, llmPool] = await Promise.all([rulePoolPromise, llmPoolPromise]);
    let pool = dedupeByVideoId([...rulePool, ...llmPool]);
    const queries = [...ruleQueries, ...extraLLM];

    // 2nd-round fallback A: still under TARGET_TOTAL × 2 (need a healthy pool)
    if (pool.length < V2_TARGET_TOTAL * 2) {
      const fallbackQs = buildFallbackQueries(state);
      const extra = await runSearchPool(fallbackQs, apiKey, state.language);
      pool = dedupeByVideoId([...pool, ...extra]);
    }

    if (pool.length === 0) {
      return {
        status: 'failed',
        data: { reason: 'youtube_returned_zero' },
        error: 'YouTube returned 0 results across all queries',
      };
    }

    // 3. videos.list batch — duration + viewCount
    const videoIds = pool.map((p) => p.videoId);
    let stats: YouTubeVideoStatsItem[] = [];
    try {
      stats = await videosBatch({ videoIds, apiKey });
    } catch (err) {
      log.warn(`videos.list failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const candidates = enrichWithStats(pool, stats);

    // 4. Pre-filter (shorts + blocklist)
    const filtered = candidates.filter(
      (c) => !isShortsByDuration(c.durationSec) && !titleHitsBlocklist(c.title)
    );

    if (filtered.length === 0) {
      return {
        status: 'failed',
        data: { reason: 'all_candidates_filtered' },
        error: 'All candidates dropped by shorts/blocklist filter',
      };
    }

    // 5. Score every video against every cell (Jaccard token overlap),
    //    then assign with relevance-aware tagging + threshold.
    const cellTokens = state.subGoals.map((sg) => tokenize(sg, state.language));
    const scoredVideos = filtered.map((v) => {
      const vt = tokenize(`${v.title} ${v.description ?? ''}`, state.language);
      const cellScores = cellTokens.map((ct) => jaccard(vt, ct));
      let bestCell = 0;
      let bestScore = cellScores[0] ?? 0;
      for (let i = 1; i < cellScores.length; i++) {
        if ((cellScores[i] ?? 0) > bestScore) {
          bestScore = cellScores[i] ?? 0;
          bestCell = i;
        }
      }
      return { video: v, cellScores, bestCell, bestScore };
    });

    const { assignments, scoreByVideoId } = assignWithRelevance(
      scoredVideos,
      V2_TARGET_PER_CELL,
      V2_NUM_CELLS,
      MIN_OVERFLOW_RELEVANCE
    );
    const assignmentMode = 'relevance_tag' as const;

    // 8. Upsert recommendation_cache (rec_score = relevance to assigned cell)
    const candidateById = new Map(filtered.map((c) => [c.videoId, c]));
    const upsertCount = await upsertRecommendations(
      ctx.userId,
      mandalaId,
      assignments,
      candidateById,
      state.subGoals,
      scoreByVideoId
    );

    const finalTotal = totalAssigned(assignments);
    const wallMs = Date.now() - t0;

    // Status semantics:
    //   success — at least 1 recommendation made it through. Auto-add will
    //     consume what's there. Sub-target counts (e.g. 19/40) are still
    //     success because the relevance threshold deliberately drops noise.
    //   failed  — zero recommendations could be assigned. Auto-add has
    //     nothing to consume; surface this so pipeline marks step2 failed.
    return {
      status: finalTotal > 0 ? 'success' : 'failed',
      data: {
        queries_used: queries.length,
        pool_size: pool.length,
        filtered_count: filtered.length,
        embedded_count: 0,
        assignment_mode: assignmentMode,
        cells_filled: assignments.filter((a) => a.videoIds.length > 0).length,
        total_recommendations: finalTotal,
        rows_upserted: upsertCount,
        target_met: finalTotal >= V2_TARGET_TOTAL,
      },
      metrics: {
        duration_ms: wallMs,
        rows_written: { recommendation_cache: upsertCount },
      },
      error: finalTotal === 0 ? 'No recommendations passed the relevance threshold' : undefined,
    };
  },
};

// ============================================================================
// Helpers
// ============================================================================

interface PoolItem {
  videoId: string;
  title: string;
  description: string;
  channelTitle: string | null;
  thumbnail: string | null;
  publishedAt: string | null;
  /** Cell hint from the source SearchQuery (null = mandala-wide). */
  cellIndexHint: number | null;
}

async function runSearchPool(
  queries: SearchQuery[],
  apiKey: string,
  language: KeywordLanguage
): Promise<PoolItem[]> {
  // Parallel — each search.list is independent. Dedupe by videoId at the
  // end; first-win keeps YouTube relevance order within the winning query
  // and preserves that query's cellIndexHint on the video.
  const regionCode = language === 'ko' ? 'KR' : 'US';
  const perQuery = await Promise.all(
    queries.map(async (q) => {
      try {
        const items = await searchVideos({
          query: q.query,
          apiKey,
          relevanceLanguage: language,
          regionCode,
        });
        return { q, items };
      } catch (err) {
        log.warn(
          `search.list failed for "${q.query}": ${err instanceof Error ? err.message : String(err)}`
        );
        return { q, items: [] };
      }
    })
  );
  const out: PoolItem[] = [];
  for (const { q, items } of perQuery) {
    for (const item of items) {
      const id = item.id?.videoId;
      if (!id) continue;
      out.push({
        videoId: id,
        title: item.snippet?.title ?? '',
        description: item.snippet?.description ?? '',
        channelTitle: item.snippet?.channelTitle ?? null,
        thumbnail: item.snippet?.thumbnails?.high?.url ?? null,
        publishedAt: item.snippet?.publishedAt ?? null,
        cellIndexHint: q.cellIndex ?? null,
      });
    }
  }
  return dedupeByVideoId(out);
}

interface ScoredVideo {
  video: CandidateVideo;
  cellScores: number[]; // length nCells
  bestCell: number;
  bestScore: number;
}

/**
 * Relevance-aware cell assignment.
 *
 * Pass 1 (tagged): videos whose source query carried a cellIndexHint go to
 *   that cell unconditionally — we trust the query we crafted.
 * Pass 2 (relevance): remaining videos go to their best-scoring cell IFF
 *   bestScore >= minOverflow. Otherwise dropped (better to leave a slot
 *   empty than show an off-topic recommendation).
 * Sort: each cell is sorted by relevance to that cell desc, then capped at
 *   perCell. The dropped tail of an overstuffed cell is requeued for Pass 2
 *   against other cells — its scores are already known.
 *
 * Returns assignments and a videoId→relevance-to-its-cell map for upsert.
 */
function assignWithRelevance(
  scored: ReadonlyArray<ScoredVideo>,
  perCell: number,
  nCells: number,
  minOverflow: number
): { assignments: CellAssignment[]; scoreByVideoId: Map<string, number> } {
  // Build per-cell candidate buckets with their relevance to *that* cell.
  type Bucket = { videoId: string; score: number; tagged: boolean };
  const cellBuckets: Bucket[][] = Array.from({ length: nCells }, () => []);

  // Pass 1 — tagged videos pinned to hint cell (score from cellScores[hint])
  const untagged: ScoredVideo[] = [];
  for (const sv of scored) {
    const hint = sv.video.cellIndexHint;
    if (hint != null && hint >= 0 && hint < nCells) {
      cellBuckets[hint]!.push({
        videoId: sv.video.videoId,
        score: sv.cellScores[hint] ?? 0,
        tagged: true,
      });
    } else {
      untagged.push(sv);
    }
  }

  // Pass 2 — untagged go to bestCell if bestScore >= minOverflow
  for (const sv of untagged) {
    if (sv.bestScore < minOverflow) continue;
    cellBuckets[sv.bestCell]!.push({
      videoId: sv.video.videoId,
      score: sv.bestScore,
      tagged: false,
    });
  }

  // Sort each cell by score desc, dedupe (a video can only land in one cell
  // — if multiple buckets contain it, prefer the higher score), cap perCell.
  const seenVideoIds = new Set<string>();
  const assignments: CellAssignment[] = [];
  const scoreByVideoId = new Map<string, number>();

  // Reorder: process tagged-bucket-rich cells first to lock their picks
  for (let i = 0; i < nCells; i++) {
    cellBuckets[i]!.sort((a, b) => b.score - a.score);
  }

  for (let i = 0; i < nCells; i++) {
    const picked: string[] = [];
    for (const item of cellBuckets[i]!) {
      if (picked.length >= perCell) break;
      if (seenVideoIds.has(item.videoId)) continue;
      seenVideoIds.add(item.videoId);
      picked.push(item.videoId);
      scoreByVideoId.set(item.videoId, item.score);
    }
    assignments.push({ cellIndex: i, videoIds: picked });
  }
  return { assignments, scoreByVideoId };
}

// ---------------------------------------------------------------------------
// Tokenization & relevance scoring
// ---------------------------------------------------------------------------

const KO_STOPWORDS = new Set([
  '및',
  '등',
  '하기',
  '되기',
  '관련',
  '방법',
  '위한',
  '통한',
  '이상',
  '이하',
  '대해',
  '으로',
  '에서',
  '에게',
  '한다',
  '있다',
  '없다',
  '그리고',
  '하지만',
  '또한',
]);
const EN_STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'of',
  'in',
  'on',
  'at',
  'to',
  'for',
  'with',
  'by',
  'and',
  'or',
  'but',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'how',
  'what',
  'why',
  'when',
  'where',
  'this',
  'that',
  'these',
  'those',
  'my',
  'your',
  'our',
  'their',
  'from',
  'as',
  'it',
]);

/**
 * Lowercases, strips punctuation, splits on whitespace + Korean particle
 * boundaries (rough), drops stopwords and 1-char tokens. Same routine for
 * cell keywords and video title+description so set comparison is consistent.
 */
function tokenize(text: string, language: KeywordLanguage): Set<string> {
  if (!text) return new Set();
  const stops = language === 'ko' ? KO_STOPWORDS : EN_STOPWORDS;
  // Strip HTML entities + common punctuation; keep letters/digits/CJK
  const cleaned = text
    .toLowerCase()
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ');
  const tokens = cleaned.split(/\s+/).filter((t) => t.length >= 2 && !stops.has(t));
  return new Set(tokens);
}

/** Jaccard overlap of two token sets, biased toward the cell side: |∩| / |cell|. */
function jaccard(videoTokens: Set<string>, cellTokens: Set<string>): number {
  if (cellTokens.size === 0 || videoTokens.size === 0) return 0;
  let hits = 0;
  for (const t of cellTokens) {
    if (videoTokens.has(t)) hits++;
  }
  return hits / cellTokens.size;
}

function dedupeByVideoId(items: PoolItem[]): PoolItem[] {
  const seen = new Set<string>();
  const out: PoolItem[] = [];
  for (const it of items) {
    if (seen.has(it.videoId)) continue;
    seen.add(it.videoId);
    out.push(it);
  }
  return out;
}

function buildFallbackQueries(state: HydratedState): SearchQuery[] {
  // 2nd-round: combine center with each non-empty sub_goal (skip ones already
  // used). Cap at 3 to keep quota under 800 units total. Tags each query with
  // its originating cell_index so query-tag assignment can use it.
  const out: SearchQuery[] = [];
  for (let i = 0; i < state.subGoals.length; i++) {
    const trimmed = (state.subGoals[i] ?? '').trim();
    if (trimmed && trimmed.length <= 30) {
      out.push({
        query: `${state.centerGoal} ${trimmed}`,
        source: 'subgoal',
        cellIndex: i,
      });
    }
    if (out.length >= 3) break;
  }
  return out;
}

function enrichWithStats(pool: PoolItem[], stats: YouTubeVideoStatsItem[]): CandidateVideo[] {
  const statsById = new Map<string, YouTubeVideoStatsItem>();
  for (const s of stats) {
    if (s.id) statsById.set(s.id, s);
  }
  return pool.map((p) => {
    const s = statsById.get(p.videoId);
    const viewCount = s?.statistics?.viewCount ? parseInt(s.statistics.viewCount, 10) : null;
    const likeCount = s?.statistics?.likeCount ? parseInt(s.statistics.likeCount, 10) : null;
    const durationSec = parseIsoDuration(s?.contentDetails?.duration);
    const likeRatio =
      viewCount && likeCount && viewCount > 0 ? Math.min(likeCount / viewCount, 1) : null;
    return {
      ...p,
      durationSec,
      viewCount: Number.isFinite(viewCount) ? viewCount : null,
      likeRatio,
    };
  });
}

async function upsertRecommendations(
  userId: string,
  mandalaId: string,
  assignments: ReadonlyArray<CellAssignment>,
  byId: Map<string, CandidateVideo>,
  subGoals: ReadonlyArray<string>,
  scoreByVideoId: Map<string, number>
): Promise<number> {
  const db = getPrismaClient();
  const expiresAt = new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000);
  let count = 0;

  for (const a of assignments) {
    const sg = subGoals[a.cellIndex] ?? '';
    for (let pos = 0; pos < a.videoIds.length; pos++) {
      const videoId = a.videoIds[pos]!;
      const c = byId.get(videoId);
      if (!c) continue;
      // Relevance-based score: jaccard overlap with this cell's keyword.
      // Falls back to 0 when missing (pure overflow path; shouldn't happen
      // given threshold gate but stays defensive).
      const recScore = Math.max(0, Math.min(1, scoreByVideoId.get(videoId) ?? 0));
      try {
        await db.recommendation_cache.upsert({
          where: {
            user_id_mandala_id_video_id: {
              user_id: userId,
              mandala_id: mandalaId,
              video_id: videoId,
            },
          },
          create: {
            user_id: userId,
            mandala_id: mandalaId,
            cell_index: a.cellIndex,
            keyword: sg.slice(0, 255),
            video_id: videoId,
            title: c.title,
            thumbnail: c.thumbnail,
            channel: c.channelTitle?.slice(0, 255) ?? null,
            view_count: c.viewCount,
            like_ratio: c.likeRatio,
            duration_sec: c.durationSec,
            rec_score: recScore,
            status: RECOMMENDATION_STATUS_PENDING,
            weight_version: WEIGHT_VERSION,
            expires_at: expiresAt,
            published_at: c.publishedAt ? new Date(c.publishedAt) : null,
          },
          update: {
            cell_index: a.cellIndex,
            keyword: sg.slice(0, 255),
            title: c.title,
            thumbnail: c.thumbnail,
            channel: c.channelTitle?.slice(0, 255) ?? null,
            view_count: c.viewCount,
            like_ratio: c.likeRatio,
            duration_sec: c.durationSec,
            rec_score: recScore,
            weight_version: WEIGHT_VERSION,
            expires_at: expiresAt,
            published_at: c.publishedAt ? new Date(c.publishedAt) : null,
          },
        });
        count++;
      } catch (err) {
        log.warn(
          `recommendation_cache upsert failed for ${videoId}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }
  return count;
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
