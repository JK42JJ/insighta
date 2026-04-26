/**
 * video-discover v3 — executor
 *
 * Flow:
 *   preflight — validate mandala + level=1 embeddings present
 *   execute   — 0. RedisProvider (video-dictionary, priority 1)
 *               1. matchFromVideoPool → Tier 1 cached results
 *               2. Compute per-cell deficit
 *               3. If any deficit, run Tier 2 (YouTube realtime)
 *               4. Upsert recommendation_cache
 *
 * Redis runs first and independently of YouTube quota. Even if all
 * YouTube keys are 403, Redis results still produce cards.
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

import {
  applySemanticRerank,
  getSemanticRank,
  filterByWhitelist,
  getChannelWhitelist,
  type SemanticRerankTrace,
  type WhitelistGateTrace,
} from '@/modules/video-dictionary';
import { notifyCardAdded, type CardPayload } from '@/modules/recommendations/publisher';
import { MS_PER_DAY } from '@/utils/time-constants';
import { manifest, V3_TARGET_PER_CELL, V3_NUM_CELLS, V3_TARGET_TOTAL } from './manifest';
import { matchFromVideoPool, groupByCell } from './cache-matcher';
import {
  applyMandalaFilterWithStats,
  MIN_SUB_RELEVANCE,
  type FilterCandidate,
} from './mandala-filter';
import { v3Config } from './config';
import { filterByQualityGate } from './quality-gate';
import { embedBatch } from '@/skills/plugins/iks-scorer/embedding';

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
import { RedisProvider } from './providers/redis-provider';
import type { CellDefinition } from './providers/types';

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
const MAX_PER_CHANNEL_PER_CELL = 2;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HydratedState {
  centerGoal: string;
  subGoals: string[]; // length 8
  language: KeywordLanguage;
  focusTags: string[];
  targetLevel: string;
}

export interface AssembledSlot {
  videoId: string;
  title: string;
  description: string | null;
  channelName: string | null;
  channelId: string | null;
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

    // ── Tier 0: Redis video-dictionary (always runs, quota-independent) ─
    const slots: AssembledSlot[] = [];
    let redisMatchCount = 0;
    const redisProvider = new RedisProvider();
    const redisHealth = await redisProvider.health();
    if (redisHealth.available) {
      const cells: CellDefinition[] = state.subGoals.map((sg, i) => ({
        cellIndex: i,
        subGoal: sg,
        keywords: [],
      }));
      try {
        const redisResult = await redisProvider.match({
          mandalaId,
          userId: ctx.userId,
          cells,
          budget: V3_TARGET_TOTAL,
          excludeVideoIds: new Set<string>(),
          language: state.language,
          centerGoal: state.centerGoal,
          focusTags: state.focusTags,
        });
        for (const c of redisResult.candidates) {
          slots.push({
            videoId: c.videoId,
            title: c.title,
            description: c.description,
            channelName: c.channelTitle,
            channelId: c.channelId,
            thumbnail: c.thumbnailUrl,
            viewCount: c.viewCount,
            likeCount: c.likeCount,
            durationSec: c.durationSec,
            publishedAt: c.publishedAt,
            cellIndex: c.cellIndex,
            score: c.relevanceScore,
            tier: 'cache',
          });
        }
        redisMatchCount = redisResult.candidates.length;
        log.info(
          `[redis] mandala=${mandalaId} candidates=${redisMatchCount} latencyMs=${redisResult.meta.latencyMs}`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(`[redis] match failed (non-fatal): ${msg}`);
      }
    } else {
      log.info(`[redis] unavailable: ${redisHealth.lastError}`);
    }

    // ── Tier 1: video_pool cache (disabled by default — see v3Config.enableTier1Cache)
    const redisByCell = new Map<number, number>();
    for (const s of slots) {
      redisByCell.set(s.cellIndex, (redisByCell.get(s.cellIndex) ?? 0) + 1);
    }
    const existingVideoIds = new Set(slots.map((s) => s.videoId));

    const tier1Matches = v3Config.enableTier1Cache
      ? await matchFromVideoPool({
          mandalaId,
          language: state.language,
          perCell: V3_TARGET_PER_CELL,
        })
      : [];
    const tier1ByCell = groupByCell(tier1Matches, V3_NUM_CELLS);
    let tier1Total = 0;
    for (const [cellIndex, cached] of tier1ByCell) {
      for (const m of cached) {
        if (existingVideoIds.has(m.videoId)) continue;
        slots.push({
          videoId: m.videoId,
          title: m.title,
          description: m.description,
          channelName: m.channelName,
          channelId: m.channelId,
          thumbnail: m.thumbnail,
          viewCount: m.viewCount,
          likeCount: m.likeCount,
          durationSec: m.durationSec,
          publishedAt: m.publishedAt,
          cellIndex,
          score: m.score,
          tier: 'cache',
        });
        existingVideoIds.add(m.videoId);
        tier1Total++;
      }
    }

    // ── Tier 2: realtime fallback for deficit cells ────────────────────
    let tier2Count = 0;
    let tier2QueriesUsed = 0;
    let tier2Debug: Tier2Debug | null = null;
    const totalHave = slots.length;
    if (totalHave < V3_TARGET_TOTAL) {
      const slotsByCell = new Map<number, number>();
      for (const s of slots) {
        slotsByCell.set(s.cellIndex, (slotsByCell.get(s.cellIndex) ?? 0) + 1);
      }
      const deficitCells: Array<{ cellIndex: number; need: number }> = [];
      for (let i = 0; i < V3_NUM_CELLS; i++) {
        const have = slotsByCell.get(i) ?? 0;
        const need = Math.max(0, V3_TARGET_PER_CELL - have);
        if (need > 0) deficitCells.push({ cellIndex: i, need });
      }

      const tier2Fill = await runTier2({
        deficitCells,
        state,
        apiKeys,
        openRouterApiKey: openRouterApiKey || undefined,
        openRouterModel,
        existingVideoIds,
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
          redis_matches: redisMatchCount,
          tier1_matches: 0,
          tier2_matches: 0,
          ...(tier2Debug ? { debug: tier2Debug } : {}),
        },
        error: 'No recommendations from Redis, cache, or realtime fallback',
        metrics: { duration_ms: Date.now() - t0 },
      };
    }

    // ── Semantic rerank (D36, synthesis spec §4.2 — off by default) ────
    const rerankedSlots = await maybeApplySemanticRerank(slots, mandalaId);
    const semanticTrace: SemanticRerankTrace | null = rerankedSlots.trace;

    // ── Dual whitelist gate (dual-whitelist.md §3.2 — off by default) ──
    const gatedSlots = await maybeApplyWhitelistGate(rerankedSlots.slots);
    const whitelistTrace: WhitelistGateTrace | null = gatedSlots.trace;

    // ── Upsert recommendation_cache ────────────────────────────────────
    const upserts = await upsertSlots(ctx.userId, mandalaId, gatedSlots.slots, state.subGoals);

    const finalTotal = gatedSlots.slots.length;
    const wallMs = Date.now() - t0;

    return {
      status: 'success',
      data: {
        redis_matches: redisMatchCount,
        tier1_matches: tier1Total,
        tier2_matches: tier2Count,
        tier2_queries: tier2QueriesUsed,
        total_recommendations: finalTotal,
        cells_filled: new Set(gatedSlots.slots.map((s) => s.cellIndex)).size,
        rows_upserted: upserts,
        target_met: finalTotal >= V3_TARGET_TOTAL,
        ...(tier2Debug ? { debug: tier2Debug } : {}),
        ...(semanticTrace ? { semantic_rerank: semanticTrace } : {}),
        ...(whitelistTrace ? { whitelist_gate: whitelistTrace } : {}),
      },
      metrics: {
        duration_ms: wallMs,
        rows_written: { recommendation_cache: upserts },
      },
    };
  },
};

// ============================================================================
// Semantic rerank — D36 per synthesis spec §4.2 (off unless V3_ENABLE_SEMANTIC_RERANK=true)
// ============================================================================

interface MaybeRerankOutput {
  slots: AssembledSlot[];
  trace: SemanticRerankTrace | null;
}

/**
 * If the feature flag is on, blend pre-filter `score` with pgvector cosine
 * against `video_chunk_embeddings`. Cell-targeted per §4.2. Missing embeddings
 * pass through unchanged — no penalty.
 */
export async function maybeApplySemanticRerank(
  slots: AssembledSlot[],
  mandalaId: string
): Promise<MaybeRerankOutput> {
  if (!v3Config.enableSemanticRerank || slots.length === 0) {
    return { slots, trace: null };
  }

  const cellAssignments = new Map(slots.map((s) => [s.videoId, s.cellIndex]));
  const ranks = await getSemanticRank({
    mandalaId,
    videoIds: slots.map((s) => s.videoId),
    cellAssignments,
  });

  const { slots: reranked, trace } = applySemanticRerank(slots, ranks, {
    alpha: v3Config.semanticAlpha,
    beta: v3Config.semanticBeta,
  });

  log.info(
    `semantic rerank: mandala=${mandalaId} in=${trace.candidatesIn} scored=${trace.candidatesScored} avgCos=${trace.avgCosine.toFixed(3)}`
  );

  return { slots: reranked, trace };
}

// ============================================================================
// Dual whitelist gate — collection-side design doc §3.2 (off unless V3_ENABLE_WHITELIST_GATE=true)
// ============================================================================

interface MaybeWhitelistOutput {
  slots: AssembledSlot[];
  trace: WhitelistGateTrace | null;
}

/**
 * If the feature flag is on, drop slots whose `channelId` is not in the
 * Redis-backed whitelist. Missing channel IDs (legacy video_pool rows with
 * null channel_id) are treated as non-whitelisted when the gate applies.
 * Empty-whitelist + flag-on falls back to passthrough with a warn log
 * (dual-whitelist.md §3.2 Q1); Redis unavailability fails open to the
 * same inclusive state via `getChannelWhitelist()` (Q2).
 */
export async function maybeApplyWhitelistGate(
  slots: AssembledSlot[]
): Promise<MaybeWhitelistOutput> {
  if (!v3Config.enableWhitelistGate) {
    return { slots, trace: null };
  }
  const whitelist = await getChannelWhitelist();
  const gateInput = slots.map((s) => ({
    ...s,
    channelId: s.channelId ?? '',
  }));
  const { slots: kept, trace } = filterByWhitelist(gateInput, whitelist, {
    enabled: true,
  });
  // Strip the empty-string coercion back to null for downstream callers.
  const restored = kept.map((s) => {
    const { channelId, ...rest } = s;
    return {
      ...(rest as Omit<AssembledSlot, 'channelId'>),
      channelId: channelId === '' ? null : channelId,
    };
  });
  log.info(
    `whitelist gate: input=${trace.inputCount} kept=${trace.keptCount} dropped=${trace.droppedCount} reason=${trace.reason}`
  );
  return { slots: restored, trace };
}

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
    semanticGateEmbedMs: number;
    mandalaFilterMs: number;
    scoringMs: number;
    qualityGateMs: number;
    totalMs: number;
  };
  queries: Array<{ query: string; source: 'rule' | 'llm'; cellIndex: number | null }>;
  perQueryCounts: Array<{ query: string; source: 'rule' | 'llm'; count: number; error?: string }>;
  poolAfterDedupe: number;
  droppedShortsDuration: number;
  droppedShortsTitle: number;
  droppedBlocklist: number;
  droppedQuality: number;
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
      semanticGateEmbedMs: 0,
      mandalaFilterMs: 0,
      scoringMs: 0,
      qualityGateMs: 0,
      totalMs: 0,
    },
    queries: [],
    perQueryCounts: [],
    poolAfterDedupe: 0,
    droppedShortsDuration: 0,
    droppedShortsTitle: 0,
    droppedBlocklist: 0,
    droppedQuality: 0,
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
  const ruleQueries = buildRuleBasedQueriesSync(
    {
      centerGoal: input.state.centerGoal,
      subGoals: deficitSubGoals,
      focusTags: input.state.focusTags,
      targetLevel: input.state.targetLevel,
      language: input.state.language,
    },
    v3Config.maxQueries
  );
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
      maxQueries: v3Config.maxQueries,
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

  // Tier 2 quality gate — pure filter, flag-controlled. See quality-gate.ts.
  if (v3Config.enableQualityGate) {
    const tQualStart = Date.now();
    const gated = filterByQualityGate(enriched, {
      enabled: true,
      minViewCount: v3Config.minViewCount,
      minViewsPerDay: v3Config.minViewsPerDay,
    });
    enriched.length = 0;
    enriched.push(...gated.kept);
    debug.droppedQuality = gated.droppedCount;
    debug.timing.qualityGateMs = Date.now() - tQualStart;
  }

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

  type FilterInput = FilterCandidate & { videoId: string };
  const filterInputs: FilterInput[] = filterable.map((v) => ({
    videoId: v.videoId,
    title: v.title,
    description: v.description ?? null,
    publishedAt: v.publishedDate,
  }));
  const enrichedById = new Map<string, Enriched>();
  for (const v of filterable) enrichedById.set(v.videoId, v);

  // Semantic gate prep: when centerGateMode === 'semantic', embed the
  // center goal + all candidate titles in ONE batch (N+1 texts) and pass
  // both into the filter. On failure the filter's internal safety
  // fallback downgrades to 'substring' behavior (mandala-filter.ts).
  let centerEmbedding: number[] | undefined;
  let candidateEmbeddings: Map<string, number[]> | undefined;
  if (v3Config.centerGateMode === 'semantic' && filterInputs.length > 0) {
    const tSemEmbedStart = Date.now();
    const texts: string[] = [input.state.centerGoal, ...filterInputs.map((f) => f.title)];
    try {
      const vectors = await embedBatch(texts);
      if (vectors.length === texts.length) {
        centerEmbedding = vectors[0];
        candidateEmbeddings = new Map<string, number[]>();
        for (let i = 0; i < filterInputs.length; i++) {
          const vec = vectors[i + 1];
          const id = filterInputs[i]?.videoId;
          if (vec && id) candidateEmbeddings.set(id, vec);
        }
      } else {
        log.warn(
          `semantic gate embed vector mismatch: got ${vectors.length}/${texts.length} — falling back to substring`
        );
      }
    } catch (err) {
      log.warn(
        `semantic gate embed failed: ${err instanceof Error ? err.message : String(err)} — falling back to substring`
      );
    }
    debug.timing.semanticGateEmbedMs = Date.now() - tSemEmbedStart;
  }

  const tMandalaFilterStart = Date.now();
  const { byCell, stats: mfStats } = applyMandalaFilterWithStats(filterInputs, {
    centerGoal: input.state.centerGoal,
    subGoals: input.state.subGoals,
    language: input.state.language,
    focusTags: input.state.focusTags,
    recencyWeight: v3Config.recencyWeight,
    recencyHalfLifeMonths: v3Config.recencyHalfLifeMonths,
    centerGateMode: v3Config.centerGateMode,
    centerEmbedding,
    candidateEmbeddings,
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
      const enrichedVideo = enrichedById.get(a.candidate.videoId);
      if (!enrichedVideo) continue;
      scored.push({ video: enrichedVideo, cellIndex, score: a.score });
    }
  }
  debug.scoredCandidates = scored.length;

  // Cap per cell using the deficit need + overall target remaining.
  const cellFilled = new Map<number, number>();
  const pickedVideoIds = new Set<string>();
  const channelPerCell = new Map<number, Map<string, number>>();
  scored.sort((a, b) => b.score - a.score);
  const slots: AssembledSlot[] = [];
  for (const sc of scored) {
    const need = input.deficitCells.find((c) => c.cellIndex === sc.cellIndex)?.need ?? 0;
    if (need === 0) continue;
    const already = cellFilled.get(sc.cellIndex) ?? 0;
    if (already >= need) continue;
    if (pickedVideoIds.has(sc.video.videoId)) continue;
    if (sc.video.channelId) {
      if (!channelPerCell.has(sc.cellIndex)) channelPerCell.set(sc.cellIndex, new Map());
      const cellMap = channelPerCell.get(sc.cellIndex)!;
      const cnt = cellMap.get(sc.video.channelId) ?? 0;
      if (cnt >= MAX_PER_CHANNEL_PER_CELL) continue;
      cellMap.set(sc.video.channelId, cnt + 1);
    }
    pickedVideoIds.add(sc.video.videoId);
    cellFilled.set(sc.cellIndex, already + 1);
    slots.push({
      videoId: sc.video.videoId,
      title: sc.video.title,
      description: sc.video.description,
      channelName: sc.video.channelTitle,
      channelId: sc.video.channelId,
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
  channelId: string | null;
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
  const publishedAfter =
    v3Config.publishedAfterDays > 0
      ? new Date(Date.now() - v3Config.publishedAfterDays * MS_PER_DAY).toISOString()
      : undefined;
  // Phase 1 slice 1 (post-SGNL-parity audit): Promise.allSettled instead
  // of Promise.all, combined with a per-call timeout passed into the
  // YouTube client (`timeoutMs`). Rationale: before this change the
  // entire fan-out blocked on the slowest YouTube API response (p95
  // tail). Now each call has a hard cutoff; slow calls abort and
  // surface as `{ items: [], error: 'timeout ...' }`, matching the
  // existing error-handling contract so downstream pool assembly and
  // perQuery tracing are unaffected. Tail latency no longer dominates
  // wall clock.
  const settled = await Promise.allSettled(
    queries.map(async (q, idx) => {
      try {
        const order: 'relevance' | 'viewCount' | 'date' | undefined =
          idx % 5 === 3 ? 'viewCount' : idx % 5 === 4 ? 'date' : undefined;
        const queryLang = language === 'ko' && idx % 5 === 2 ? 'en' : language;
        const items = await searchVideos({
          query: q.query,
          apiKey: apiKeys,
          relevanceLanguage: queryLang,
          regionCode,
          order,
          timeoutMs: v3Config.youtubeSearchTimeoutMs,
          ...(publishedAfter ? { publishedAfter } : {}),
        });
        return { q, items, error: undefined as string | undefined };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(`search.list failed for "${q.query}": ${msg}`);
        return { q, items: [] as YouTubeSearchItem[], error: msg };
      }
    })
  );
  const results = settled.map((r, idx) => {
    if (r.status === 'fulfilled') return r.value;
    // Defensive: the inner try/catch already converts errors to the
    // fulfilled shape, so a rejected settle result would indicate a
    // bug in the inner map fn (sync throw before the try). Surface it
    // as an empty-items entry so the outer pipeline still completes.
    const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
    log.warn(`search.list settled=rejected for "${queries[idx]?.query ?? '?'}": ${reason}`);
    return {
      q: queries[idx]!,
      items: [] as YouTubeSearchItem[],
      error: reason,
    };
  });
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
        channelId: item.snippet?.channelId ?? null,
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
  const expiresAt = new Date(Date.now() + TTL_DAYS * MS_PER_DAY);
  let count = 0;

  for (const slot of slots) {
    const keyword = (subGoals[slot.cellIndex] ?? '').slice(0, 255);
    try {
      const row = await db.recommendation_cache.upsert({
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

      // Phase 1 slice 2 (SSE streaming): push the freshly-upserted card
      // to any SSE subscriber for this mandala. Non-fatal — notification
      // delivery is best-effort, persistence has already succeeded above.
      try {
        const payload: CardPayload = {
          id: row.id,
          videoId: row.video_id,
          title: row.title,
          channel: row.channel,
          thumbnail: row.thumbnail,
          durationSec: row.duration_sec,
          recScore: row.rec_score,
          cellIndex: row.cell_index ?? slot.cellIndex,
          // cellLabel is derived at read-time in /recommendations (from
          // mandala levels). The SSE consumer resolves it client-side
          // from the already-loaded mandala state to avoid a DB round-
          // trip per notification.
          cellLabel: null,
          keyword: row.keyword ?? keyword,
          source: row.weight_version === 0 ? 'manual' : 'auto_recommend',
          recReason: row.rec_reason,
          publishedAt: row.published_at?.toISOString() ?? null,
        };
        notifyCardAdded(mandalaId, payload);
      } catch (notifyErr) {
        // EventEmitter.emit can only throw if a listener throws
        // synchronously, which would be a listener bug. Log and move
        // on — the row is persisted regardless.
        log.warn(
          `notifyCardAdded failed for ${slot.videoId}: ${
            notifyErr instanceof Error ? notifyErr.message : String(notifyErr)
          }`
        );
      }
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

// ---------------------------------------------------------------------------
// CP424.2 Wizard Precompute — ephemeral discovery (no mandala_id)
// ---------------------------------------------------------------------------
//
// Design: docs/design/precompute-pipeline.md (CP417 draft).
// Called by /wizard-stream at Step 1 via setImmediate fire-and-forget.
// Produces the same AssembledSlot[] shape as `executor.execute` but:
//   - Tier 1 (video_pool KNN) disabled — no mandala_id to scope candidates,
//     and flag-gated off in prod anyway (V3_ENABLE_TIER1_CACHE=false default).
//   - No upsertSlots — caller persists to mandala_wizard_precompute.discover_result
//     as JSON, then copies to recommendation_cache at consume-time (/create-with-data).
//   - No cardPublisher.notify — no mandala_id to publish under. Notify fires
//     at consume-time when mandala row exists.
//   - Semantic rerank + whitelist gate skipped (both require mandala_id); can be
//     revisited in a follow-up if precompute quality warrants.
//
// Result shape mirrors Tier2Output + metadata so caller stores it intact.

export interface EphemeralDiscoverInput {
  centerGoal: string;
  subGoals: string[]; // length 8
  language: KeywordLanguage;
  focusTags: string[];
  targetLevel: string;
  env: NodeJS.ProcessEnv;
}

export interface EphemeralDiscoverResult {
  slots: AssembledSlot[];
  queriesUsed: number;
  tier0_matches: number;
  tier2_matches: number;
  duration_ms: number;
  debug?: Tier2Debug;
}

/**
 * Run v3 Tier 2 discovery with an ephemeral hydrated state (no mandala_id
 * required). Intended for wizard precompute path: caller hydrates state from
 * client-provided goal + inferred/echoed sub_goals at Step 1, stores result in
 * mandala_wizard_precompute table, consumes at Step 3 save.
 *
 * Throws:
 *   - `Error('YOUTUBE_API_KEY_SEARCH is not configured')` if no API keys
 *
 * Caller responsibility:
 *   - Catch errors and persist them to precompute.error_message
 *   - Never call with a sub_goals array shorter than V3_NUM_CELLS; the queries
 *     will silently skip empty cells.
 */
export async function runDiscoverEphemeral(
  input: EphemeralDiscoverInput
): Promise<EphemeralDiscoverResult> {
  const t0 = Date.now();
  const apiKeys = resolveSearchApiKeys(input.env);
  if (apiKeys.length === 0) {
    throw new Error('YOUTUBE_API_KEY_SEARCH is not configured');
  }
  const openRouterApiKey = input.env['OPENROUTER_API_KEY'];
  const openRouterModel = input.env['OPENROUTER_MODEL'] ?? 'qwen/qwen3-30b-a3b';

  // ── Tier 0: Redis video-dictionary (same as execute(), quota-independent) ─
  const redisSlots: AssembledSlot[] = [];
  const redisProvider = new RedisProvider();
  const redisHealth = await redisProvider.health();
  if (redisHealth.available) {
    const cells: CellDefinition[] = input.subGoals.map((sg, i) => ({
      cellIndex: i,
      subGoal: sg,
      keywords: [],
    }));
    try {
      const redisResult = await redisProvider.match({
        mandalaId: 'ephemeral',
        userId: 'precompute',
        cells,
        budget: V3_TARGET_TOTAL,
        excludeVideoIds: new Set<string>(),
        language: input.language,
        centerGoal: input.centerGoal,
        focusTags: input.focusTags,
      });
      for (const c of redisResult.candidates) {
        redisSlots.push({
          videoId: c.videoId,
          title: c.title,
          description: c.description,
          channelName: c.channelTitle,
          channelId: c.channelId,
          thumbnail: c.thumbnailUrl,
          viewCount: c.viewCount,
          likeCount: c.likeCount,
          durationSec: c.durationSec,
          publishedAt: c.publishedAt,
          cellIndex: c.cellIndex,
          score: c.relevanceScore,
          tier: 'cache',
        });
      }
      log.info(
        `[redis][ephemeral] candidates=${redisResult.candidates.length} latencyMs=${redisResult.meta.latencyMs}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`[redis][ephemeral] match failed (non-fatal): ${msg}`);
    }
  } else {
    log.info(`[redis][ephemeral] unavailable: ${redisHealth.lastError}`);
  }

  // ── Compute per-cell deficit after Redis ─
  const redisByCell = new Map<number, number>();
  for (const s of redisSlots) {
    redisByCell.set(s.cellIndex, (redisByCell.get(s.cellIndex) ?? 0) + 1);
  }
  const existingVideoIds = new Set(redisSlots.map((s) => s.videoId));

  const deficitCells: { cellIndex: number; need: number }[] = [];
  for (let i = 0; i < V3_NUM_CELLS; i++) {
    const have = redisByCell.get(i) ?? 0;
    const need = V3_TARGET_PER_CELL - have;
    if (need > 0) {
      deficitCells.push({ cellIndex: i, need });
    }
  }

  // ── Tier 2: YouTube realtime (only for deficit cells) ─
  let tier2Slots: AssembledSlot[] = [];
  let queriesUsed = 0;
  let tier2Debug: Tier2Debug | undefined;

  if (deficitCells.length > 0) {
    const tier2 = await runTier2({
      deficitCells,
      state: {
        centerGoal: input.centerGoal,
        subGoals: input.subGoals,
        language: input.language,
        focusTags: input.focusTags,
        targetLevel: input.targetLevel,
      },
      apiKeys,
      openRouterApiKey: openRouterApiKey || undefined,
      openRouterModel,
      existingVideoIds,
    });
    tier2Slots = tier2.slots;
    queriesUsed = tier2.queriesUsed;
    tier2Debug = tier2.debug;
  }

  const allSlots = [...redisSlots, ...tier2Slots];

  return {
    slots: allSlots,
    queriesUsed,
    tier0_matches: redisSlots.length,
    tier2_matches: tier2Slots.length,
    duration_ms: Date.now() - t0,
    debug: tier2Debug,
  };
}
