/**
 * video-discover v3 — executor (Tier 1 cache + Tier 2 realtime fallback)
 *
 * Flow:
 *   preflight — validate mandala + level=1 embeddings present
 *   execute   — 1. matchFromVideoPool → Tier 1 cached results
 *               2. Compute per-cell deficit
 *               3. If any deficit, run Tier 2:
 *                    - build queries for deficit cells only
 *                    - YouTube search (server key, parallel)
 *                    - videos.list batch → quality gate
 *                    - Jaccard relevance per deficit cell
 *                    - Fill deficit slots (sorted by score)
 *               4. Upsert recommendation_cache (source='cache'|'realtime',
 *                  weight_version=3)
 *
 * Coexists with v1/v2. Routing via VIDEO_DISCOVER_V3=1 in pipeline-runner.
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

import { manifest, V3_TARGET_PER_CELL, V3_NUM_CELLS, V3_TARGET_TOTAL } from './manifest';
import { matchFromVideoPool, groupByCell } from './cache-matcher';

import {
  buildRuleBasedQueriesSync,
  runLLMQueries,
  type KeywordLanguage,
  type SearchQuery,
} from '../v2/keyword-builder';
import {
  searchVideos,
  videosBatch,
  parseIsoDuration,
  isShortsByDuration,
  titleHitsBlocklist,
  type YouTubeVideoStatsItem,
} from '../v2/youtube-client';

const log = logger.child({ module: 'video-discover/v3/executor' });

const TTL_DAYS = 7;
const RECOMMENDATION_STATUS_PENDING = 'pending';
const WEIGHT_VERSION = 3;
const MIN_TIER2_RELEVANCE = 0.05;
// How many search queries to attempt per deficit cell (rule-based + LLM
// together; the LLM pass yields at most a handful for the whole mandala).
const TIER2_MAX_QUERIES_PER_CELL = 2;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HydratedState {
  centerGoal: string;
  subGoals: string[]; // length 8
  language: KeywordLanguage;
  focusTags: string[];
  targetLevel: string;
}

interface AssembledSlot {
  videoId: string;
  title: string;
  description: string | null;
  channelName: string | null;
  thumbnail: string | null;
  viewCount: number | null;
  likeCount: number | null;
  durationSec: number | null;
  publishedAt: Date | null;
  cellIndex: number;
  score: number;
  /** 'cache' = Tier 1 (video_pool), 'realtime' = Tier 2 (YouTube fresh). */
  tier: 'cache' | 'realtime';
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export const executor: SkillExecutor = {
  manifest,

  async preflight(ctx: PreflightContext): Promise<PreflightResult> {
    if (!ctx.mandalaId) return { ok: false, reason: 'mandala_id is required' };
    if (!ctx.userId) return { ok: false, reason: 'userId is required' };

    const apiKey = ctx.env?.['YOUTUBE_API_KEY_SEARCH'] ?? '';
    if (!apiKey) {
      return {
        ok: false,
        reason: 'YOUTUBE_API_KEY_SEARCH is not configured. v3 requires the server API key.',
      };
    }

    const db = getPrismaClient();
    const mandala = await db.user_mandalas.findFirst({
      where: { id: ctx.mandalaId, user_id: ctx.userId },
      select: {
        id: true,
        title: true,
        language: true,
        focus_tags: true,
        target_level: true,
      },
    });
    if (!mandala) {
      return { ok: false, reason: `Mandala ${ctx.mandalaId} not found or not owned` };
    }

    // Level=1 embeddings must exist for Tier 1 matching.
    const embedCountRows = await db.$queryRaw<{ cnt: bigint }[]>(
      Prisma.sql`SELECT COUNT(*)::bigint AS cnt FROM public.mandala_embeddings
                 WHERE mandala_id = ${ctx.mandalaId} AND level = 1 AND embedding IS NOT NULL`
    );
    const cnt = Number(embedCountRows[0]?.cnt ?? 0n);
    if (cnt < V3_NUM_CELLS) {
      return {
        ok: false,
        reason: `Only ${cnt}/${V3_NUM_CELLS} sub_goal embeddings available — wait for embeddings step`,
      };
    }

    // Also load sub_goal text so Tier 2 can build per-cell queries. The
    // embedding comparison itself runs in SQL so we don't load vectors here.
    const subGoalRows = await db.$queryRaw<
      { sub_goal_index: number; sub_goal: string | null; center_goal: string | null }[]
    >(
      Prisma.sql`SELECT sub_goal_index, sub_goal, center_goal FROM public.mandala_embeddings
                 WHERE mandala_id = ${ctx.mandalaId} AND level = 1
                 ORDER BY sub_goal_index ASC`
    );
    const subGoals: string[] = new Array(V3_NUM_CELLS).fill('');
    let centerGoal = mandala.title ?? '';
    for (const r of subGoalRows) {
      const idx = r.sub_goal_index;
      if (idx < 0 || idx >= V3_NUM_CELLS) continue;
      subGoals[idx] = r.sub_goal ?? '';
      if (r.center_goal && !centerGoal) centerGoal = r.center_goal;
    }

    const language: KeywordLanguage = mandala.language === 'en' ? 'en' : 'ko';
    const hydrated: HydratedState = {
      centerGoal,
      subGoals,
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

    // ── Tier 1: video_pool cache ────────────────────────────────────────
    const tier1Matches = await matchFromVideoPool({
      mandalaId,
      language: state.language,
      perCell: V3_TARGET_PER_CELL,
    });
    const tier1ByCell = groupByCell(tier1Matches, V3_NUM_CELLS);
    const tier1Total = tier1Matches.length;

    // Assemble Tier 1 slots with known metadata.
    const slots: AssembledSlot[] = [];
    for (const [cellIndex, cached] of tier1ByCell) {
      for (const m of cached) {
        slots.push({
          videoId: m.videoId,
          title: m.title,
          description: m.description,
          channelName: m.channelName,
          thumbnail: m.thumbnail,
          viewCount: m.viewCount,
          likeCount: m.likeCount,
          durationSec: m.durationSec,
          publishedAt: m.publishedAt,
          cellIndex,
          score: m.score,
          tier: 'cache',
        });
      }
    }

    // ── Tier 2: realtime fallback for deficit cells ────────────────────
    let tier2Count = 0;
    let tier2QueriesUsed = 0;
    if (tier1Total < V3_TARGET_TOTAL) {
      const deficitCells: Array<{ cellIndex: number; need: number }> = [];
      for (let i = 0; i < V3_NUM_CELLS; i++) {
        const have = tier1ByCell.get(i)?.length ?? 0;
        const need = Math.max(0, V3_TARGET_PER_CELL - have);
        if (need > 0) deficitCells.push({ cellIndex: i, need });
      }

      const tier2Fill = await runTier2({
        deficitCells,
        state,
        apiKey,
        openRouterApiKey: openRouterApiKey || undefined,
        openRouterModel,
        existingVideoIds: new Set(slots.map((s) => s.videoId)),
      });
      slots.push(...tier2Fill.slots);
      tier2Count = tier2Fill.slots.length;
      tier2QueriesUsed = tier2Fill.queriesUsed;
    }

    if (slots.length === 0) {
      return {
        status: 'failed',
        data: { tier1_matches: 0, tier2_matches: 0 },
        error: 'No recommendations from cache or realtime fallback',
        metrics: { duration_ms: Date.now() - t0 },
      };
    }

    // ── Upsert recommendation_cache ────────────────────────────────────
    const upserts = await upsertSlots(ctx.userId, mandalaId, slots, state.subGoals);

    const finalTotal = slots.length;
    const wallMs = Date.now() - t0;

    return {
      status: 'success',
      data: {
        tier1_matches: tier1Total,
        tier2_matches: tier2Count,
        tier2_queries: tier2QueriesUsed,
        total_recommendations: finalTotal,
        cells_filled: new Set(slots.map((s) => s.cellIndex)).size,
        rows_upserted: upserts,
        target_met: finalTotal >= V3_TARGET_TOTAL,
      },
      metrics: {
        duration_ms: wallMs,
        rows_written: { recommendation_cache: upserts },
      },
    };
  },
};

// ============================================================================
// Tier 2: deficit-cell realtime fill
// ============================================================================

interface Tier2Input {
  deficitCells: Array<{ cellIndex: number; need: number }>;
  state: HydratedState;
  apiKey: string;
  openRouterApiKey?: string;
  openRouterModel: string;
  existingVideoIds: ReadonlySet<string>;
}

interface Tier2Output {
  slots: AssembledSlot[];
  queriesUsed: number;
}

async function runTier2(input: Tier2Input): Promise<Tier2Output> {
  if (input.deficitCells.length === 0) return { slots: [], queriesUsed: 0 };

  // Build queries targeting the deficit cells specifically. keyword-builder
  // already supports tagging by sub_goal index; here we narrow the
  // sub_goals array to only deficit ones so LLM+rule paths focus there.
  const deficitSubGoals: string[] = new Array(V3_NUM_CELLS).fill('');
  for (const { cellIndex } of input.deficitCells) {
    deficitSubGoals[cellIndex] = input.state.subGoals[cellIndex] ?? '';
  }

  const ruleQueries = buildRuleBasedQueriesSync({
    centerGoal: input.state.centerGoal,
    subGoals: deficitSubGoals,
    focusTags: input.state.focusTags,
    targetLevel: input.state.targetLevel,
    language: input.state.language,
  });

  const llmPromise = runLLMQueries(
    {
      centerGoal: input.state.centerGoal,
      subGoals: deficitSubGoals,
      focusTags: input.state.focusTags,
      targetLevel: input.state.targetLevel,
      language: input.state.language,
    },
    {
      openRouterApiKey: input.openRouterApiKey,
      openRouterModel: input.openRouterModel,
    }
  );

  const rulePool = await runSearch(ruleQueries, input.apiKey, input.state.language);

  const llmQueries = await llmPromise;
  const usedQueryTexts = new Set(ruleQueries.map((q) => q.query.toLowerCase()));
  const extraLLM = llmQueries.filter((q) => !usedQueryTexts.has(q.query.toLowerCase()));
  const llmPool =
    extraLLM.length > 0 ? await runSearch(extraLLM, input.apiKey, input.state.language) : [];

  const queriesUsed = ruleQueries.length + extraLLM.length;
  const combined = dedupePool([...rulePool, ...llmPool]);
  if (combined.length === 0) return { slots: [], queriesUsed };

  // videos.list batch for duration + viewCount
  let stats: YouTubeVideoStatsItem[] = [];
  try {
    stats = await videosBatch({
      videoIds: combined.map((p) => p.videoId),
      apiKey: input.apiKey,
    });
  } catch (err) {
    log.warn(
      `videos.list failed (continuing w/o stats): ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
  const statsById = new Map<string, YouTubeVideoStatsItem>();
  for (const s of stats) if (s.id) statsById.set(s.id, s);

  // Enrich + filter shorts/blocklist. Note: Tier 2 does NOT apply the
  // bronze-floor filter (view_count >= 1000) because it's acceptable to
  // surface slightly-less-viewed videos when the cache had nothing — those
  // are better than empty slots.
  type Enriched = PoolItem & {
    viewCount: number | null;
    likeCount: number | null;
    durationSec: number | null;
    publishedDate: Date | null;
  };
  const enriched: Enriched[] = [];
  for (const p of combined) {
    const s = statsById.get(p.videoId);
    const viewCount = s?.statistics?.viewCount ? parseInt(s.statistics.viewCount, 10) : null;
    const likeCount = s?.statistics?.likeCount ? parseInt(s.statistics.likeCount, 10) : null;
    const durationSec = parseIsoDuration(s?.contentDetails?.duration);
    if (isShortsByDuration(durationSec)) continue;
    if (titleHitsBlocklist(p.title)) continue;
    enriched.push({
      ...p,
      viewCount: Number.isFinite(viewCount) ? viewCount : null,
      likeCount: Number.isFinite(likeCount) ? likeCount : null,
      durationSec,
      publishedDate: p.publishedAt ? new Date(p.publishedAt) : null,
    });
  }
  if (enriched.length === 0) return { slots: [], queriesUsed };

  // Score enriched videos against deficit cell sub_goals only (other cells
  // already full from Tier 1). Uses local tokenize/jaccard so v3 has no
  // runtime dependency on v2's private helpers.
  const cellTokenSets = new Map<number, Set<string>>();
  for (const { cellIndex } of input.deficitCells) {
    cellTokenSets.set(
      cellIndex,
      tokenize(input.state.subGoals[cellIndex] ?? '', input.state.language)
    );
  }

  interface ScoredCandidate {
    video: Enriched;
    cellIndex: number;
    score: number;
  }
  const scored: ScoredCandidate[] = [];
  for (const v of enriched) {
    if (input.existingVideoIds.has(v.videoId)) continue;
    const vTokens = tokenize(`${v.title} ${v.description ?? ''}`, input.state.language);
    let bestCell = -1;
    let bestScore = 0;
    for (const [cellIndex, tokens] of cellTokenSets) {
      const s = jaccard(vTokens, tokens);
      if (s > bestScore) {
        bestScore = s;
        bestCell = cellIndex;
      }
    }
    // Respect query tag if present — deficit-cell relevance can use it.
    if (bestCell === -1 || bestScore < MIN_TIER2_RELEVANCE) continue;
    scored.push({ video: v, cellIndex: bestCell, score: bestScore });
  }

  // Cap per cell using the deficit need + overall target remaining.
  const cellFilled = new Map<number, number>();
  const pickedVideoIds = new Set<string>();
  scored.sort((a, b) => b.score - a.score);
  const slots: AssembledSlot[] = [];
  for (const sc of scored) {
    const need = input.deficitCells.find((c) => c.cellIndex === sc.cellIndex)?.need ?? 0;
    if (need === 0) continue;
    const already = cellFilled.get(sc.cellIndex) ?? 0;
    if (already >= need) continue;
    if (pickedVideoIds.has(sc.video.videoId)) continue;
    pickedVideoIds.add(sc.video.videoId);
    cellFilled.set(sc.cellIndex, already + 1);
    slots.push({
      videoId: sc.video.videoId,
      title: sc.video.title,
      description: sc.video.description,
      channelName: sc.video.channelTitle,
      thumbnail: sc.video.thumbnail,
      viewCount: sc.video.viewCount,
      likeCount: sc.video.likeCount,
      durationSec: sc.video.durationSec,
      publishedAt: sc.video.publishedDate,
      cellIndex: sc.cellIndex,
      score: sc.score,
      tier: 'realtime',
    });
  }
  void TIER2_MAX_QUERIES_PER_CELL; // referenced in docs; retained for future tuning

  return { slots, queriesUsed };
}

// ============================================================================
// YouTube search helper (parallel) — shared between Tier 2 paths
// ============================================================================

interface PoolItem {
  videoId: string;
  title: string;
  description: string;
  channelTitle: string | null;
  thumbnail: string | null;
  publishedAt: string | null;
  cellIndexHint: number | null;
}

async function runSearch(
  queries: ReadonlyArray<SearchQuery>,
  apiKey: string,
  language: KeywordLanguage
): Promise<PoolItem[]> {
  if (queries.length === 0) return [];
  const regionCode = language === 'ko' ? 'KR' : 'US';
  const results = await Promise.all(
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
  for (const { q, items } of results) {
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
  return out;
}

function dedupePool(items: ReadonlyArray<PoolItem>): PoolItem[] {
  const seen = new Set<string>();
  const out: PoolItem[] = [];
  for (const p of items) {
    if (seen.has(p.videoId)) continue;
    seen.add(p.videoId);
    out.push(p);
  }
  return out;
}

// ============================================================================
// Upsert — single pass for Tier 1 + Tier 2 slots
// ============================================================================

async function upsertSlots(
  userId: string,
  mandalaId: string,
  slots: ReadonlyArray<AssembledSlot>,
  subGoals: ReadonlyArray<string>
): Promise<number> {
  const db = getPrismaClient();
  const expiresAt = new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000);
  let count = 0;

  for (const slot of slots) {
    const keyword = (subGoals[slot.cellIndex] ?? '').slice(0, 255);
    try {
      await db.recommendation_cache.upsert({
        where: {
          user_id_mandala_id_video_id: {
            user_id: userId,
            mandala_id: mandalaId,
            video_id: slot.videoId,
          },
        },
        create: {
          user_id: userId,
          mandala_id: mandalaId,
          cell_index: slot.cellIndex,
          keyword,
          video_id: slot.videoId,
          title: slot.title,
          thumbnail: slot.thumbnail,
          channel: slot.channelName?.slice(0, 255) ?? null,
          view_count: slot.viewCount,
          like_ratio:
            slot.likeCount != null && slot.viewCount && slot.viewCount > 0
              ? Math.min(slot.likeCount / slot.viewCount, 1)
              : null,
          duration_sec: slot.durationSec,
          rec_score: Math.max(0, Math.min(1, slot.score)),
          rec_reason: slot.tier,
          status: RECOMMENDATION_STATUS_PENDING,
          weight_version: WEIGHT_VERSION,
          expires_at: expiresAt,
          published_at: slot.publishedAt,
        },
        update: {
          cell_index: slot.cellIndex,
          keyword,
          title: slot.title,
          thumbnail: slot.thumbnail,
          channel: slot.channelName?.slice(0, 255) ?? null,
          view_count: slot.viewCount,
          like_ratio:
            slot.likeCount != null && slot.viewCount && slot.viewCount > 0
              ? Math.min(slot.likeCount / slot.viewCount, 1)
              : null,
          duration_sec: slot.durationSec,
          rec_score: Math.max(0, Math.min(1, slot.score)),
          rec_reason: slot.tier,
          weight_version: WEIGHT_VERSION,
          expires_at: expiresAt,
          published_at: slot.publishedAt,
        },
      });
      count++;
    } catch (err) {
      log.warn(
        `recommendation_cache upsert failed for ${slot.videoId}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
  return count;
}

// ============================================================================
// Tokenization (duplicated from v2 — keeping v3 self-contained so v2 stays
// untouched and rollback is trivial)
// ============================================================================

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

function tokenize(text: string, language: KeywordLanguage): Set<string> {
  if (!text) return new Set();
  const stops = language === 'ko' ? KO_STOPWORDS : EN_STOPWORDS;
  const cleaned = text
    .toLowerCase()
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ');
  const tokens = cleaned.split(/\s+/).filter((t) => t.length >= 2 && !stops.has(t));
  return new Set(tokens);
}

function jaccard(videoTokens: Set<string>, cellTokens: Set<string>): number {
  if (cellTokens.size === 0 || videoTokens.size === 0) return 0;
  let hits = 0;
  for (const t of cellTokens) {
    if (videoTokens.has(t)) hits++;
  }
  return hits / cellTokens.size;
}
