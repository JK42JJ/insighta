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
import { applyMandalaFilterWithStats, MIN_SUB_RELEVANCE } from './mandala-filter';

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
  titleIndicatesShorts,
  titleHitsBlocklist,
  resolveSearchApiKeys,
  type YouTubeVideoStatsItem,
  type YouTubeSearchItem,
} from '../v2/youtube-client';

const log = logger.child({ module: 'video-discover/v3/executor' });

const TTL_DAYS = 7;
const RECOMMENDATION_STATUS_PENDING = 'pending';
const WEIGHT_VERSION = 3;
// Retained as a reference; the actual value now lives in mandala-filter.ts
// (MIN_SUB_RELEVANCE). Both are 0.05 and kept in sync intentionally.
void MIN_SUB_RELEVANCE;
// How many search queries to attempt per deficit cell (rule-based + LLM
// together; the LLM pass yields at most a handful for the whole mandala).
const TIER2_MAX_QUERIES_PER_CELL = 2;

/**
 * Tier 1 (video_pool cache) is disabled by default (2026-04-16).
 *
 * The current pool holds ~1k rows dominated (~60%) by `user-derived`
 * leftovers from past mandalas. At that scale embedding cosine (≥0.3)
 * produces cross-topic hits — e.g. "하느님 자비의 기도" admitted into a
 * "일일 습관 성장" mandala because both land near each other in the
 * generic Korean self-help cluster. Until the pool reaches a useful
 * scale (10⁵–10⁶ rows) and/or is replaced with a domain-tuned model,
 * we skip Tier 1 entirely and route every request through Tier 2.
 *
 * The pgvector index, matchFromVideoPool function, and upsert path all
 * remain intact. Flip this env flag (V3_ENABLE_TIER1_CACHE=true) to
 * reactivate without a code change.
 */
const V3_ENABLE_TIER1_CACHE = process.env['V3_ENABLE_TIER1_CACHE'] === 'true';

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

    const apiKeys = resolveSearchApiKeys(ctx.env ?? {});
    if (apiKeys.length === 0) {
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
    const apiKeys = resolveSearchApiKeys(ctx.env ?? {});
    const openRouterApiKey = ctx.env?.['OPENROUTER_API_KEY'];
    const openRouterModel = ctx.env?.['OPENROUTER_MODEL'] ?? 'qwen/qwen3-30b-a3b';
    const state = ctx.state as unknown as HydratedState;
    const mandalaId = ctx.mandalaId!;

    // ── Tier 1: video_pool cache (disabled by default — see V3_ENABLE_TIER1_CACHE)
    const tier1Matches = V3_ENABLE_TIER1_CACHE
      ? await matchFromVideoPool({
          mandalaId,
          language: state.language,
          perCell: V3_TARGET_PER_CELL,
        })
      : [];
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
    let tier2Debug: Tier2Debug | null = null;
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
        apiKeys,
        openRouterApiKey: openRouterApiKey || undefined,
        openRouterModel,
        existingVideoIds: new Set(slots.map((s) => s.videoId)),
      });
      slots.push(...tier2Fill.slots);
      tier2Count = tier2Fill.slots.length;
      tier2QueriesUsed = tier2Fill.queriesUsed;
      tier2Debug = tier2Fill.debug;
    }

    if (slots.length === 0) {
      return {
        status: 'failed',
        data: {
          tier1_matches: 0,
          tier2_matches: 0,
          ...(tier2Debug ? { debug: tier2Debug } : {}),
        },
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
        ...(tier2Debug ? { debug: tier2Debug } : {}),
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
  /** Ordered API keys — rotated on quota (403) errors. */
  apiKeys: string[];
  openRouterApiKey?: string;
  openRouterModel: string;
  existingVideoIds: ReadonlySet<string>;
}

interface Tier2Debug {
  timing: {
    keywordRuleMs: number;
    keywordLlmMs: number;
    ruleSearchMs: number;
    llmSearchMs: number;
    videosBatchMs: number;
    filterMs: number;
    mandalaFilterMs: number;
    scoringMs: number;
    totalMs: number;
  };
  queries: Array<{ query: string; source: 'rule' | 'llm'; cellIndex: number | null }>;
  perQueryCounts: Array<{ query: string; source: 'rule' | 'llm'; count: number; error?: string }>;
  poolAfterDedupe: number;
  droppedShortsDuration: number;
  droppedShortsTitle: number;
  droppedBlocklist: number;
  afterFilter: number;
  existingExcluded: number;
  mandalaFilterInput: number;
  mandalaFilterOutput: number;
  mandalaFilterDroppedCenterGate: number;
  mandalaFilterDroppedJaccard: number;
  mandalaFilterCenterTokens: string[];
  mandalaFilterSubGoalTokenCounts: number[];
  perCellAssigned: Record<number, number>;
  scoredCandidates: number;
  finalSlots: number;
  centerGoal: string;
  subGoalsSample: string[];
  llmQuotaHit: boolean;
  ytSearchErrors: string[];
}

interface Tier2Output {
  slots: AssembledSlot[];
  queriesUsed: number;
  /**
   * Observability-only trace. Added 2026-04-17 to diagnose dev vs prod
   * tier2_matches divergence. No behavior change. Serialized into
   * step2_result.debug for read-side comparison.
   */
  debug: Tier2Debug;
}

function makeEmptyDebug(input: Tier2Input): Tier2Debug {
  return {
    timing: {
      keywordRuleMs: 0,
      keywordLlmMs: 0,
      ruleSearchMs: 0,
      llmSearchMs: 0,
      videosBatchMs: 0,
      filterMs: 0,
      mandalaFilterMs: 0,
      scoringMs: 0,
      totalMs: 0,
    },
    queries: [],
    perQueryCounts: [],
    poolAfterDedupe: 0,
    droppedShortsDuration: 0,
    droppedShortsTitle: 0,
    droppedBlocklist: 0,
    afterFilter: 0,
    existingExcluded: 0,
    mandalaFilterInput: 0,
    mandalaFilterOutput: 0,
    mandalaFilterDroppedCenterGate: 0,
    mandalaFilterDroppedJaccard: 0,
    mandalaFilterCenterTokens: [],
    mandalaFilterSubGoalTokenCounts: [],
    perCellAssigned: {},
    scoredCandidates: 0,
    finalSlots: 0,
    centerGoal: input.state.centerGoal,
    subGoalsSample: [...input.state.subGoals],
    llmQuotaHit: false,
    ytSearchErrors: [],
  };
}

async function runTier2(input: Tier2Input): Promise<Tier2Output> {
  const t0 = Date.now();
  const debug = makeEmptyDebug(input);
  if (input.deficitCells.length === 0) {
    debug.timing.totalMs = Date.now() - t0;
    return { slots: [], queriesUsed: 0, debug };
  }

  // Build queries targeting the deficit cells specifically. keyword-builder
  // already supports tagging by sub_goal index; here we narrow the
  // sub_goals array to only deficit ones so LLM+rule paths focus there.
  const deficitSubGoals: string[] = new Array(V3_NUM_CELLS).fill('');
  for (const { cellIndex } of input.deficitCells) {
    deficitSubGoals[cellIndex] = input.state.subGoals[cellIndex] ?? '';
  }

  const tKwRuleStart = Date.now();
  const ruleQueries = buildRuleBasedQueriesSync({
    centerGoal: input.state.centerGoal,
    subGoals: deficitSubGoals,
    focusTags: input.state.focusTags,
    targetLevel: input.state.targetLevel,
    language: input.state.language,
  });
  debug.timing.keywordRuleMs = Date.now() - tKwRuleStart;

  const tKwLlmStart = Date.now();
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

  const tRuleSearchStart = Date.now();
  const ruleSearch = await runSearchTraced(ruleQueries, input.apiKeys, input.state.language);
  debug.timing.ruleSearchMs = Date.now() - tRuleSearchStart;
  const rulePool = ruleSearch.pool;
  for (const t of ruleSearch.perQuery) {
    debug.perQueryCounts.push({ ...t, source: 'rule' });
  }
  for (const q of ruleQueries) {
    debug.queries.push({ query: q.query, source: 'rule', cellIndex: q.cellIndex ?? null });
  }
  debug.ytSearchErrors.push(...ruleSearch.perQuery.filter((p) => p.error).map((p) => p.error!));

  const llmQueries = await llmPromise;
  debug.timing.keywordLlmMs = Date.now() - tKwLlmStart;
  debug.llmQuotaHit = llmQueries.length === 0 && Boolean(input.openRouterApiKey);
  const usedQueryTexts = new Set(ruleQueries.map((q) => q.query.toLowerCase()));
  const extraLLM = llmQueries.filter((q) => !usedQueryTexts.has(q.query.toLowerCase()));
  for (const q of extraLLM) {
    debug.queries.push({ query: q.query, source: 'llm', cellIndex: q.cellIndex ?? null });
  }

  let llmPool: PoolItem[] = [];
  if (extraLLM.length > 0) {
    const tLlmSearchStart = Date.now();
    const llmSearch = await runSearchTraced(extraLLM, input.apiKeys, input.state.language);
    debug.timing.llmSearchMs = Date.now() - tLlmSearchStart;
    llmPool = llmSearch.pool;
    for (const t of llmSearch.perQuery) {
      debug.perQueryCounts.push({ ...t, source: 'llm' });
    }
    debug.ytSearchErrors.push(...llmSearch.perQuery.filter((p) => p.error).map((p) => p.error!));
  }

  const queriesUsed = ruleQueries.length + extraLLM.length;
  const combined = dedupePool([...rulePool, ...llmPool]);
  debug.poolAfterDedupe = combined.length;
  if (combined.length === 0) {
    debug.timing.totalMs = Date.now() - t0;
    return { slots: [], queriesUsed, debug };
  }

  // videos.list batch for duration + viewCount
  const tVideosBatchStart = Date.now();
  let stats: YouTubeVideoStatsItem[] = [];
  try {
    stats = await videosBatch({
      videoIds: combined.map((p) => p.videoId),
      apiKey: input.apiKeys,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`videos.list failed (continuing w/o stats): ${msg}`);
    debug.ytSearchErrors.push(`videos.list: ${msg}`);
  }
  debug.timing.videosBatchMs = Date.now() - tVideosBatchStart;
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
  const tFilterStart = Date.now();
  const enriched: Enriched[] = [];
  for (const p of combined) {
    const s = statsById.get(p.videoId);
    const viewCount = s?.statistics?.viewCount ? parseInt(s.statistics.viewCount, 10) : null;
    const likeCount = s?.statistics?.likeCount ? parseInt(s.statistics.likeCount, 10) : null;
    const durationSec = parseIsoDuration(s?.contentDetails?.duration);
    if (isShortsByDuration(durationSec)) {
      debug.droppedShortsDuration++;
      continue;
    }
    if (titleIndicatesShorts(p.title)) {
      debug.droppedShortsTitle++;
      continue;
    }
    if (titleHitsBlocklist(p.title)) {
      debug.droppedBlocklist++;
      continue;
    }
    enriched.push({
      ...p,
      viewCount: Number.isFinite(viewCount) ? viewCount : null,
      likeCount: Number.isFinite(likeCount) ? likeCount : null,
      durationSec,
      publishedDate: p.publishedAt ? new Date(p.publishedAt) : null,
    });
  }
  debug.timing.filterMs = Date.now() - tFilterStart;
  debug.afterFilter = enriched.length;
  if (enriched.length === 0) {
    debug.timing.totalMs = Date.now() - t0;
    return { slots: [], queriesUsed, debug };
  }

  // 9-axis mandala filter: the mandala itself (centerGoal + 8 sub_goals) is
  // the filter. applyMandalaFilter routes each candidate to the best-fit
  // sub_goal cell and drops off-domain candidates. This replaces the prior
  // v3-internal two-gate (3368d34/ff35fcf) so Tier 1 and Tier 2 share the
  // exact same filter logic — see mandala-filter.ts for the contract.
  interface ScoredCandidate {
    video: Enriched;
    cellIndex: number;
    score: number;
  }
  const filterable = enriched.filter((v) => !input.existingVideoIds.has(v.videoId));
  debug.existingExcluded = enriched.length - filterable.length;
  debug.mandalaFilterInput = filterable.length;

  const tMandalaFilterStart = Date.now();
  const { byCell, stats: mfStats } = applyMandalaFilterWithStats(filterable, {
    centerGoal: input.state.centerGoal,
    subGoals: input.state.subGoals,
    language: input.state.language,
    // 2026-04-18 bug #414 fix — propagate user's focusTags so "박문호 강연"
    // videos bypass the center-substring gate. Without this, wizard focus
    // tags were silently dropped at the filter even though the search
    // query layer correctly used them to fetch the pool.
    focusTags: input.state.focusTags,
  });
  debug.timing.mandalaFilterMs = Date.now() - tMandalaFilterStart;

  debug.mandalaFilterOutput = mfStats.output;
  debug.mandalaFilterDroppedCenterGate = mfStats.droppedByCenterGate;
  debug.mandalaFilterDroppedJaccard = mfStats.droppedByJaccardBelowThreshold;
  debug.mandalaFilterCenterTokens = mfStats.centerTokens;
  debug.mandalaFilterSubGoalTokenCounts = mfStats.subGoalTokenCounts;

  // Flatten into a single scored list (per-cell order preserved inside the
  // map by applyMandalaFilter; overall sort happens again below because the
  // cap-per-cell loop needs a global desc order to pick the best slots
  // across cells fairly).
  const tScoringStart = Date.now();
  const deficitCellSet = new Set(input.deficitCells.map((c) => c.cellIndex));
  const scored: ScoredCandidate[] = [];
  for (const [cellIndex, list] of byCell) {
    if (!deficitCellSet.has(cellIndex)) continue;
    for (const a of list) {
      scored.push({ video: a.candidate, cellIndex, score: a.score });
    }
  }
  debug.scoredCandidates = scored.length;

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
  debug.timing.scoringMs = Date.now() - tScoringStart;
  debug.finalSlots = slots.length;
  for (const [cellIndex, n] of cellFilled) {
    debug.perCellAssigned[cellIndex] = n;
  }
  debug.timing.totalMs = Date.now() - t0;
  void TIER2_MAX_QUERIES_PER_CELL; // referenced in docs; retained for future tuning

  return { slots, queriesUsed, debug };
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

interface SearchTrace {
  pool: PoolItem[];
  perQuery: Array<{ query: string; count: number; error?: string }>;
}

async function runSearchTraced(
  queries: ReadonlyArray<SearchQuery>,
  apiKeys: string[],
  language: KeywordLanguage
): Promise<SearchTrace> {
  if (queries.length === 0) return { pool: [], perQuery: [] };
  const regionCode = language === 'ko' ? 'KR' : 'US';
  const results = await Promise.all(
    queries.map(async (q) => {
      try {
        const items = await searchVideos({
          query: q.query,
          apiKey: apiKeys,
          relevanceLanguage: language,
          regionCode,
        });
        return { q, items, error: undefined as string | undefined };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(`search.list failed for "${q.query}": ${msg}`);
        return { q, items: [] as YouTubeSearchItem[], error: msg };
      }
    })
  );
  const pool: PoolItem[] = [];
  const perQuery: SearchTrace['perQuery'] = [];
  for (const { q, items, error } of results) {
    perQuery.push({
      query: q.query,
      count: items.length,
      ...(error ? { error } : {}),
    });
    for (const item of items) {
      const id = item.id?.videoId;
      if (!id) continue;
      pool.push({
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
  return { pool, perQuery };
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
