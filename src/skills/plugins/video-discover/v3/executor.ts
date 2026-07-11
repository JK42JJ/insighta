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
import { matchFromVideoPool, matchFromVideoPoolByCenterGoal } from './cache-matcher';
import {
  applyMandalaFilterWithStats,
  MIN_SUB_RELEVANCE,
  type FilterCandidate,
} from './mandala-filter';
import { v3Config, type V3Config } from './config';
import { resolveAlgorithm } from '@/modules/search/algorithm-resolver';
import { filterByQualityGate } from './quality-gate';
import { applyHybridRerank } from './hybrid-rerank';
import { embedBatch, cosineToRelevance } from '@/skills/plugins/iks-scorer/embedding';
import { servingEmbedOptions } from '@/config/embed-serving-timeout';
import { isDiscoverNeverZeroFloorEnabled, getZeroFloorMax } from '@/config/discover-zero-floor';
import { getCenterGoalEmbedding } from '@/modules/mandala/center-goal-embedding';
import { withTraceContext, recordTrace } from '@/modules/discover-tracing';
import { resolveLanguage } from '@/utils/detect-language';
import { scheduleDomainFitShadow } from '@/modules/domain-fit-shadow/shadow';

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
  resolveVideosApiKeys,
  type YouTubeVideoStatsItem,
  type YouTubeSearchItem,
} from '../v2/youtube-client';
import { RedisProvider } from './providers/redis-provider';
import type { CellDefinition } from './providers/types';

const log = logger.child({ module: 'video-discover/v3/executor' });

/**
 * Returns true if the text contains at least one Hangul syllable block.
 * Used by the Tier-2 language post-filter: YouTube's `relevanceLanguage`
 * is a ranking hint, not a hard filter, so Korean videos can leak into
 * English mandalas and Latin-only titles can leak into Korean mandalas.
 */
const hasKoreanTitle = (text: string): boolean => /[가-힣]/.test(text);

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
  /** Sub_goal embedding vectors (same 4096d space as candidate embeddings). */
  subGoalEmbeddings: number[][]; // length 8, indexed by sub_goal_index
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
  /**
   * P3 Stage 2 (CP513) — display-only A-stage relevance (0-100) for the 관련도순
   * sort. Set on the Tier-1 semantic path from the mandala-filter score; null on
   * paths that don't compute it (backfill covers those). NEVER feeds rec_score.
   */
  relevancePct?: number | null;
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

    // CP512 (EMBED_ASYNC_SERVE) — embeddings are NO LONGER a hard precondition.
    // They drive semantic cell-assignment; their absence only degrades ordering,
    // it must not block card serving (search.list finds cards; embeddings sort
    // them). So load the sub_goal TEXT from its own source (user_mandala_levels,
    // independent of the embedding rows) and attach embeddings when present. With
    // the flag off, keep the legacy hard-gate for an exact behavioral rollback.
    const asyncServe = (ctx.env ?? {})['EMBED_ASYNC_SERVE'] !== 'false';

    // Embeddings (level=1), keyed by sub_goal_index — may be partial or empty.
    const embRows = await db.$queryRaw<{ sub_goal_index: number; embedding: string | null }[]>(
      Prisma.sql`SELECT sub_goal_index, embedding::text AS embedding
                 FROM public.mandala_embeddings
                 WHERE mandala_id = ${ctx.mandalaId} AND level = 1 AND embedding IS NOT NULL
                 ORDER BY sub_goal_index ASC`
    );
    const embByIdx = new Map<number, number[]>();
    for (const r of embRows) {
      if (r.embedding) embByIdx.set(r.sub_goal_index, parseVectorLiteral(r.embedding));
    }
    const cnt = embByIdx.size;

    if (!asyncServe && cnt < V3_NUM_CELLS) {
      // Legacy hard-gate — only when the flag is explicitly disabled (rollback).
      return {
        ok: false,
        reason: `Only ${cnt}/${V3_NUM_CELLS} sub_goal embeddings available — wait for embeddings step`,
      };
    }

    // Sub_goal TEXT + center_goal from user_mandala_levels (depth=0) — the source
    // of record for cell subjects, populated at mandala creation regardless of
    // embedding status. This is what makes degraded (embedding-less) serve work.
    const root = await db.user_mandala_levels.findFirst({
      where: { mandala_id: ctx.mandalaId, depth: 0 },
      select: { center_goal: true, subjects: true },
    });
    const subjects = (root?.subjects ?? []).filter((s): s is string => typeof s === 'string');
    const subGoals: string[] = new Array(V3_NUM_CELLS).fill('');
    const subGoalEmbeddings: number[][] = new Array(V3_NUM_CELLS).fill([]);
    const centerGoal = mandala.title ?? root?.center_goal ?? '';
    for (let idx = 0; idx < V3_NUM_CELLS; idx++) {
      subGoals[idx] = subjects[idx] ?? '';
      const emb = embByIdx.get(idx);
      if (emb) subGoalEmbeddings[idx] = emb;
    }
    // No subjects at all → nothing to search for. (mandala misconfigured.)
    if (subGoals.every((s) => !s.trim())) {
      return { ok: false, reason: 'no sub_goal subjects on user_mandala_levels (depth=0)' };
    }

    // CP458: a stored 'ko'/'en' wins; otherwise detect from the goal text
    // rather than blind-defaulting NULL → 'ko'. This is the chokepoint that
    // feeds runSearchTraced's regionCode/relevanceLanguage AND the
    // keyword-builder extraction path — getting it right here makes the
    // YouTube search match the input language end-to-end.
    const language: KeywordLanguage = resolveLanguage(mandala.language, centerGoal);
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
    // CP488 — resolve search algorithm BEFORE binding trace context so all
    // nested recordTrace calls inherit the algorithm_version stamp via ALS.
    // Mandala-level override > global active > 'v1-current' fallback >
    // env-only defaults (resolveAlgorithm never throws).
    const resolved = await resolveAlgorithm({
      userId: ctx.userId ?? null,
      mandalaId: ctx.mandalaId ?? null,
    });
    // CP457+ — bind trace context so all nested LLM/YouTube/Cohere/embed
    // calls land in video_discover_traces with the same run_id. Flag-gated
    // by V3_TRACE_ENABLED inside the tracer; no overhead when off.
    return withTraceContext(
      {
        mandalaId: ctx.mandalaId ?? null,
        userId: ctx.userId ?? null,
        algorithmVersion: resolved.id,
      },
      () => executeImpl(ctx, resolved.parameters, resolved.id)
    );
  },
};

async function executeImpl(
  ctx: ExecuteContext,
  /**
   * CP488 — algorithm-resolved parameters for THIS run. Shadows the
   * module-level `v3Config` via the local rebind below so the existing
   * `v3Config.*` references throughout this function pick up the override
   * with zero textual diff. Helpers (`runTier2`, `runSearchTraced`,
   * `maybeApply*`) still read module-level `v3Config` (env defaults) for
   * now — follow-up PR will thread `cfg` through them too. Until then
   * algorithm override affects only the executeImpl-direct decisions
   * (Redis gate, Tier 1 logic, Tier 2 overfetch toggle, semantic gate prep).
   */
  resolvedConfig: V3Config = v3Config,
  algorithmVersion: string | null = null
): Promise<ExecuteResult> {
  // eslint-disable-next-line @typescript-eslint/no-shadow
  const v3Config = resolvedConfig;
  const t0 = Date.now();
  const apiKeys = resolveSearchApiKeys(ctx.env ?? {});
  const openRouterApiKey = ctx.env?.['OPENROUTER_API_KEY'];
  const openRouterModel = ctx.env?.['OPENROUTER_MODEL'] ?? 'qwen/qwen3-30b-a3b';
  const state = ctx.state as unknown as HydratedState;
  const mandalaId = ctx.mandalaId!;
  recordTrace({
    step: 'pipeline.execute.start',
    status: 'ok',
    request: {
      mandalaId,
      userId: ctx.userId,
      centerGoal: state.centerGoal,
      subGoals: state.subGoals,
      language: state.language,
      focusTags: state.focusTags,
      targetLevel: state.targetLevel,
      algorithm_version: algorithmVersion,
      algorithm_parameters: v3Config,
    },
    response: null,
  });

  // ── Tier 0: Redis video-dictionary (gated by v3Config.enableRedisProvider; default off)
  // CP436 PR-Y0g (Issue #543): Tier 0 was always-on with no quality gate. Prod
  // incident on mandala 1ee990a9 ("감정 컨트롤 하기") admitted 96 cards in cell 2,
  // 100% from RedisProvider, with cross-domain noise (속기/마케팅/자각몽/한복) and
  // hardcoded score 0.5. Re-enable only after a quality gate (semantic cosine
  // threshold or strict minOverlap raise) is in place — see config.ts comment.
  const slots: AssembledSlot[] = [];
  let redisMatchCount = 0;
  if (v3Config.enableRedisProvider) {
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
  } else {
    log.info(`[redis] disabled by V3_ENABLE_REDIS_PROVIDER=false (Y0g)`);
  }

  // ── Tier 1: video_pool cache (disabled by default — see v3Config.enableTier1Cache)
  const redisByCell = new Map<number, number>();
  for (const s of slots) {
    redisByCell.set(s.cellIndex, (redisByCell.get(s.cellIndex) ?? 0) + 1);
  }
  const existingVideoIds = new Set(slots.map((s) => s.videoId));

  // Exclude videos the user already owns in ANY mandala. user_video_states
  // has @@unique([user_id, videoId]) — a video lives in one mandala per
  // user — so a video owned elsewhere can never be inserted here anyway.
  // Filtering it at the source (before Tier 1 + Tier 2) stops the pipeline
  // from computing + SSE-streaming candidates that auto-add would silently
  // drop, which is what made the dashboard count shrink on refresh.
  try {
    // CP489+ dedup-bleed fix — Explicit > Inferred (v0 decision #2).
    // wizard pre-fill (auto_added=true, all engagement signals zero) no
    // longer excludes; only rows with real engagement OR auto_added=false
    // (user explicit add) are excluded. See modules/exclude/excluded-videos.ts.
    const owned = await getPrismaClient().youtube_videos.findMany({
      where: {
        userState: {
          some: {
            user_id: ctx.userId,
            OR: [
              { is_watched: true },
              { is_in_ideation: true },
              { user_note: { not: null } },
              // CP512 — `watch_position_seconds > 0` dropped here to match the
              // CP490 exclude SSOT (getExcludedVideoIds, "Explicit > Inferred").
              // Since /learning now persists watch position (for the grid bar +
              // resume), keeping it would make merely *watching* a video block it
              // from future auto-discovery — an unwanted re-recommendation block
              // (James, CP512). Watch position stays display + eviction-preserve only.
              { pinned_at: { not: null } },
              { auto_added: false },
            ],
          },
        },
      },
      select: { youtube_video_id: true },
    });
    for (const v of owned) existingVideoIds.add(v.youtube_video_id);
    log.info(`[exclude] user owns ${owned.length} videos across mandalas — excluded from this run`);
  } catch (err) {
    log.warn(
      `[exclude] failed to load user-owned video ids (continuing unfiltered): ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  // CP488 Phase 1b — exclude archived + deleted signal videos.
  //   archive = mandala-scoped "soft hide" → don't surface again in THIS mandala
  //             only (signal row's mandala_id field used for scoping).
  //   delete  = global "do not recommend" → exclude across all of user's mandalas.
  // Both apply at the SOURCE so neither Tier 1 (video_pool) nor Tier 2 (YouTube
  // realtime) wastes a slot on a card the user already rejected.
  // FLAG: v3Config.enableSignalExclude (default true). Algorithm row can flip
  //       this off to reproduce pre-CP488 behavior (signals recorded but
  //       never consumed by discovery).
  if (v3Config.enableSignalExclude) {
    try {
      const signalRows = await getPrismaClient().card_interactions.findMany({
        where: {
          user_id: ctx.userId,
          OR: [{ signal: 'delete' }, { signal: 'archive', mandala_id: mandalaId }],
        },
        select: { video_id: true, signal: true },
      });
      let archiveN = 0;
      let deleteN = 0;
      for (const r of signalRows) {
        existingVideoIds.add(r.video_id);
        if (r.signal === 'archive') archiveN++;
        else if (r.signal === 'delete') deleteN++;
      }
      if (archiveN + deleteN > 0) {
        log.info(
          `[exclude] CP488 signals — archive=${archiveN} (this mandala) + delete=${deleteN} (global) excluded`
        );
      }
    } catch (err) {
      log.warn(
        `[exclude] card_interactions signal load failed (continuing): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  } else {
    log.info(`[exclude] CP488 signal exclude DISABLED via algorithm flag`);
  }

  const tier1Matches = v3Config.enableTier1Cache
    ? await matchFromVideoPool({
        mandalaId,
        language: state.language,
        perCell: V3_TARGET_PER_CELL,
        sources: v3Config.tier1Sources,
      })
    : [];

  let tier1Total = 0;
  if (tier1Matches.length > 0) {
    const fresh = tier1Matches.filter((m) => !existingVideoIds.has(m.videoId));
    // CP455+ — semantic center gate on Tier 1 output before admission.
    // Without this, cross-domain noise (e.g. cell 6 "모의고사" sub_goal
    // matching 28 토익스피킹 videos at cosine 0.55+) surfaces unfiltered.
    let filteredTier1: typeof fresh = fresh;
    // P3 Stage 2 (CP513) — capture the mandala-filter per-candidate relevance
    // (0.5·center + 0.5·bestCell) so the placement write can persist relevance_pct.
    // Display-only; does NOT affect the gate or rec_score. Empty on unfiltered paths.
    const relevanceByVideoId = new Map<string, number>();
    if (fresh.length > 0 && v3Config.centerGateMode === 'semantic') {
      try {
        const cap = v3Config.semanticMaxCandidates;
        const capped = fresh.slice(0, cap);
        // CP489 — center_goal embed via cache; candidate title embeddings
        // remain fresh (per-call YouTube candidates change every run).
        const titles = capped.map((m) => m.title);
        const [centerVec, titleVecs] = await Promise.all([
          getCenterGoalEmbedding(mandalaId, state.centerGoal),
          embedBatch(titles, servingEmbedOptions()),
        ]);
        const vectorsOk = centerVec != null && titleVecs.length === titles.length;
        if (vectorsOk) {
          const centerEmbedding = centerVec;
          const candidateEmbeddings = new Map<string, number[]>();
          for (let i = 0; i < capped.length; i++) {
            const vec = titleVecs[i];
            const id = capped[i]?.videoId;
            if (vec && id) candidateEmbeddings.set(id, vec);
          }
          const filterInputs: FilterCandidate[] = capped.map((m) => ({
            videoId: m.videoId,
            title: m.title,
            description: m.description,
            publishedAt: m.publishedAt,
          }));
          const mfT0 = Date.now();
          const { byCell, stats: mfStats } = applyMandalaFilterWithStats(filterInputs, {
            centerGoal: state.centerGoal,
            subGoals: state.subGoals,
            language: state.language,
            focusTags: state.focusTags,
            recencyWeight: v3Config.recencyWeight,
            recencyHalfLifeMonths: v3Config.recencyHalfLifeMonths,
            centerGateMode: v3Config.centerGateMode,
            centerEmbedding,
            candidateEmbeddings,
            semanticMinCosine: v3Config.semanticMinCosine,
            subGoalEmbeddings: state.subGoalEmbeddings,
            emptyTitleGateShadow: v3Config.emptyTitleGateShadow,
            emptyTitleGate: v3Config.emptyTitleGate,
          });
          const keptIds = new Set<string>();
          for (const assignments of byCell.values()) {
            for (const a of assignments) {
              keptIds.add(a.candidate.videoId);
              relevanceByVideoId.set(a.candidate.videoId, a.score);
            }
          }
          filteredTier1 = capped.filter((m) => keptIds.has(m.videoId));
          log.info(
            `[tier1] mandala-filter input=${mfStats.input} output=${mfStats.output} ` +
              `droppedCenterGate=${mfStats.droppedByCenterGate} droppedJaccard=${mfStats.droppedByJaccardBelowThreshold}`
          );
          // CP457+ trace — Tier 1 mandala-filter gate.
          recordTrace({
            step: 'mandala_filter.semantic_gate.tier1',
            status: 'ok',
            request: {
              input_count: filterInputs.length,
              mode: v3Config.centerGateMode,
              language: state.language,
              subGoals_count: state.subGoals.length,
              focusTags: state.focusTags,
              semanticMinCosine: v3Config.semanticMinCosine,
              centerEmbedding_dim: centerEmbedding?.length ?? 0,
            },
            response: {
              stats: mfStats,
              byCell_counts: Array.from({ length: 8 }, (_, i) => byCell.get(i)?.length ?? 0),
            },
            latencyMs: Date.now() - mfT0,
          });

          // R13-1 — domain-fit shadow (Tier 1). Fire-and-forget; enforce-0:
          // reads byCell for logging only, never mutates it or filteredTier1.
          scheduleDomainFitShadow({
            stage: 'tier1',
            centerGoal: state.centerGoal,
            subGoals: state.subGoals,
            candidates: Array.from(byCell.entries()).flatMap(([cellIndex, assignments]) =>
              assignments.map((a, rank) => ({
                videoId: a.candidate.videoId,
                title: a.candidate.title,
                cellIndex,
                rank,
                score: a.score,
              }))
            ),
          });
        } else {
          log.warn(
            `[tier1] mandala-filter embed mismatch: center=${centerVec != null} titles=${titleVecs.length}/${titles.length} — admitting unfiltered`
          );
        }
      } catch (err) {
        log.warn(
          `[tier1] mandala-filter threw — admitting unfiltered: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }
    for (const m of filteredTier1) {
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
        cellIndex: m.cellIndex,
        score: m.score,
        relevancePct: relevanceByVideoId.has(m.videoId)
          ? Math.round(cosineToRelevance(relevanceByVideoId.get(m.videoId)!) * 100)
          : null,
        tier: 'cache',
      });
      existingVideoIds.add(m.videoId);
      tier1Total++;
    }
  }

  // ── Tier 2: realtime YouTube search ────────────────────────────────
  // V3_TIER2_OVERFETCH (default true): Tier 2 ALWAYS runs and fetches a
  // full per-cell budget of *fresh* YouTube candidates regardless of how
  // many the pool (Tier 1) supplied — the pool is a minimal device, live
  // search is the main source. Pre-overfetch Tier 2 was budgeted as
  // `need = V3_TARGET_PER_CELL - have`, so a pool-filled mandala fetched
  // ~zero fresh videos ("돌려막기" — recycling pool cards). Set
  // V3_TIER2_OVERFETCH=false to restore the deficit-fill behaviour.
  let tier2Count = 0;
  let tier2QueriesUsed = 0;
  let tier2Debug: Tier2Debug | null = null;
  const totalHave = slots.length;
  if (v3Config.tier2Overfetch || totalHave < V3_TARGET_TOTAL) {
    const slotsByCell = new Map<number, number>();
    for (const s of slots) {
      slotsByCell.set(s.cellIndex, (slotsByCell.get(s.cellIndex) ?? 0) + 1);
    }
    const deficitCells: Array<{ cellIndex: number; need: number }> = [];
    for (let i = 0; i < V3_NUM_CELLS; i++) {
      const have = slotsByCell.get(i) ?? 0;
      // Overfetch: target a full per-cell budget of fresh candidates,
      // ignoring `have`. Deficit-fill: only top up to the per-cell target.
      const need = v3Config.tier2Overfetch
        ? V3_TARGET_PER_CELL
        : Math.max(0, V3_TARGET_PER_CELL - have);
      if (need > 0) deficitCells.push({ cellIndex: i, need });
    }

    const tier2Fill = await runTier2({
      deficitCells,
      state,
      apiKeys,
      videosApiKeys: resolveVideosApiKeys(ctx.env ?? {}),
      openRouterApiKey: openRouterApiKey || undefined,
      openRouterModel,
      existingVideoIds,
      // CP489 — enable center_goal cache for mandala-bound runs.
      mandalaId,
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

  // ── Hybrid rerank — Cohere cross-encoder (Issue #610 spec PR1) ─────
  // Off by default (V3_ENABLE_HYBRID_RERANK=false). When ON, replaces the
  // medical-English oversaturation (PR #555 mandala-filter bypass) by
  // scoring candidates against centerGoal via Cohere rerank-multilingual-v3.0.
  // Field mapping: AssembledSlot.score ↔ RerankSlot.rec_score (in-memory only,
  // upsertSlots writes to recommendation_cache.rec_score either way).
  const hybridResult = await applyHybridRerank({
    slots: rerankedSlots.slots.map((s) => ({
      videoId: s.videoId,
      title: s.title,
      cellIndex: s.cellIndex,
      rec_score: s.score,
      _original: s,
    })),
    centerGoal: state.centerGoal,
    subGoals: state.subGoals,
    enableKeywordExpansion: true,
    topN: V3_TARGET_TOTAL,
    requestId: mandalaId,
    sources: v3Config.tier1Sources,
  });
  const hybridSlots: AssembledSlot[] = hybridResult.slots
    .map((r) => {
      const ext = r as unknown as {
        _original?: AssembledSlot;
        _keywordFullData?: {
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
        };
      };
      if (ext._original) {
        return { ...ext._original, score: r.rec_score };
      }
      if (ext._keywordFullData) {
        const k = ext._keywordFullData;
        return {
          videoId: k.videoId,
          title: k.title,
          description: k.description,
          channelName: k.channelName,
          channelId: k.channelId,
          thumbnail: k.thumbnail,
          viewCount: k.viewCount,
          likeCount: k.likeCount,
          durationSec: k.durationSec,
          publishedAt: k.publishedAt,
          cellIndex: k.cellIndex,
          score: r.rec_score,
          tier: 'cache' as const,
        };
      }
      return null;
    })
    .filter((s): s is AssembledSlot => s !== null);
  const hybridStats = hybridResult.stats;

  // ── Dual whitelist gate (dual-whitelist.md §3.2 — off by default) ──
  const gatedSlots = await maybeApplyWhitelistGate(hybridSlots);
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
      hybrid_rerank: hybridStats,
    },
    metrics: {
      duration_ms: wallMs,
      rows_written: { recommendation_cache: upserts },
    },
  };
}

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
  /** CP492 — separate pool for videos.list (falls back to apiKeys until
   *  YOUTUBE_API_KEY_VIDEOS keys are provisioned). */
  videosApiKeys: string[];
  /** Ordered API keys — rotated on quota (403) errors. */
  apiKeys: string[];
  openRouterApiKey?: string;
  openRouterModel: string;
  existingVideoIds: ReadonlySet<string>;
  /**
   * CP489 — mandalaId for center_goal embedding cache lookup. Pass from
   * mandala-bound caller (executeImpl). Undefined for ephemeral path
   * (runDiscoverEphemeralImpl — no mandalaId yet), which then falls back
   * to fresh embed.
   */
  mandalaId?: string;
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
  droppedLangMismatch: number;
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
  /** P0 2026-07-11 — candidates admitted by the never-zero floor (gate emptied). */
  floorAdmitted: number;
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
    droppedLangMismatch: 0,
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
    floorAdmitted: 0,
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
  const ruleSearch = await runSearchTraced(ruleQueries, input.apiKeys, input.state.language, {
    // CP488 Phase 2b — 0-hit retry fallback uses the mandala centerGoal as the
    // broadest query (drops sub_goal token concat that often caused empties).
    // FLAG: v3Config.enableZeroHitRetry (default true). When false, fallback
    // is undefined → runSearchTraced reverts to pre-CP488 behavior.
    fallbackQuery: v3Config.enableZeroHitRetry ? input.state.centerGoal : undefined,
  });
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
    const llmSearch = await runSearchTraced(extraLLM, input.apiKeys, input.state.language, {
      // CP488 Phase 2b — same fallback for the LLM-generated fan-out (flag-gated).
      fallbackQuery: v3Config.enableZeroHitRetry ? input.state.centerGoal : undefined,
    });
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
      apiKey: input.videosApiKeys,
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
    // Title-based language post-filter (ported from legacy executor.ts §978-996).
    // YouTube's relevanceLanguage is a ranking hint, not a hard filter — Korean
    // videos leak into English mandalas (and vice versa). Only applied to Tier-2
    // live YouTube candidates; Tier-1 video_pool is already language-filtered at
    // the DB level.
    if (hasKoreanTitle(p.title) !== (input.state.language === 'ko')) {
      debug.droppedLangMismatch++;
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
  // center goal + a CAPPED slice of candidate titles in ONE batch and pass
  // the result into the filter. On failure the filter's internal safety
  // fallback downgrades to 'substring' behavior (mandala-filter.ts).
  //
  // CP436 PR-Y0b2 (Issue #543): cap the candidate slice at
  // `v3Config.semanticMaxCandidates` (default 30) so the embedBatch call
  // never blows past embedding.ts:DEFAULT_EMBED_CHUNK_SIZE = 50 in a single
  // request. Pre-cap, prod sometimes saw hundreds of titles in one call,
  // which CP418 logged as a 56s blocking incident on Mac-mini Ollama. With
  // PR #550's OpenRouter fallback the call still succeeds, but tail latency
  // hurts user-visible "first card" SLO. Cap keeps it ≤ 31 texts (center
  // + 30 titles) → single chunk → ~5-10s wall.
  //
  // Candidates beyond the cap arrive at applyMandalaFilter without
  // candidateEmbeddings entries — semantic mode treats them as
  // centerScore=0 (mandala-filter.ts:272-273) and the center gate drops
  // them. By design: when scoring isn't possible, err on dropping rather
  // than admitting unmeasured candidates.
  let centerEmbedding: number[] | undefined;
  let candidateEmbeddings: Map<string, number[]> | undefined;
  if (v3Config.centerGateMode === 'semantic' && filterInputs.length > 0) {
    const tSemEmbedStart = Date.now();
    const cap = v3Config.semanticMaxCandidates;
    const cappedFilterInputs = filterInputs.slice(0, cap);
    const overflow = Math.max(0, filterInputs.length - cap);
    // CP489 — center_goal via cache when mandalaId known; titles always fresh.
    // Ephemeral path (input.mandalaId undefined) falls back to embedBatch
    // for the center as well via plain embedBatch call.
    const titles = cappedFilterInputs.map((f) => f.title);
    try {
      const [centerVec, titleVecs] = await Promise.all([
        input.mandalaId
          ? getCenterGoalEmbedding(input.mandalaId, input.state.centerGoal)
          : (async () => {
              const [v] = await embedBatch([input.state.centerGoal], servingEmbedOptions());
              return v ?? null;
            })(),
        embedBatch(titles, servingEmbedOptions()),
      ]);
      if (centerVec != null && titleVecs.length === titles.length) {
        centerEmbedding = centerVec;
        candidateEmbeddings = new Map<string, number[]>();
        for (let i = 0; i < cappedFilterInputs.length; i++) {
          const vec = titleVecs[i];
          const id = cappedFilterInputs[i]?.videoId;
          if (vec && id) candidateEmbeddings.set(id, vec);
        }
      } else {
        log.warn(
          `semantic gate embed vector mismatch: center=${centerVec != null} titles=${titleVecs.length}/${titles.length} — falling back to substring`
        );
      }
    } catch (err) {
      log.warn(
        `semantic gate embed failed: ${err instanceof Error ? err.message : String(err)} — falling back to substring`
      );
    }
    debug.timing.semanticGateEmbedMs = Date.now() - tSemEmbedStart;
    log.info(
      `semantic gate: candidates=${filterInputs.length} capped=${cappedFilterInputs.length} ` +
        `overflow=${overflow} cap=${cap} embedMs=${debug.timing.semanticGateEmbedMs}`
    );
  }

  const tMandalaFilterStart = Date.now();
  const deficitCellSet = new Set(input.deficitCells.map((c) => c.cellIndex));
  const scored: ScoredCandidate[] = [];
  // R13-1 domain-fit shadow — true only when applyMandalaFilterWithStats ran
  // (the useYoutubeRankingOnly bypass branch below skips the mandala filter
  // entirely, so there is no domain-fit-relevant filter output to shadow).
  let mandalaFilterRanTier2 = false;

  if (v3Config.useYoutubeRankingOnly) {
    // CP436 PR-Y0d (Issue #543) — bypass mandala-filter, trust YouTube's
    // native search.list ranking. Each enriched candidate keeps the
    // cellIndexHint set by v2/keyword-builder (the per-cell query that
    // produced it), so cards land in the cell whose query they came from.
    // Score is a descending cursor that preserves arrival order through
    // the global desc sort that picks cards across cells.
    let scoreCursor = 1.0;
    const STEP = 0.01;
    const MIN_SCORE = 0.01;
    let kept = 0;
    let droppedNotInDeficit = 0;
    for (const v of filterable) {
      const cellIndex = v.cellIndexHint ?? 0;
      if (!deficitCellSet.has(cellIndex)) {
        droppedNotInDeficit++;
        continue;
      }
      scored.push({ video: enrichedById.get(v.videoId)!, cellIndex, score: scoreCursor });
      scoreCursor = Math.max(MIN_SCORE, scoreCursor - STEP);
      kept++;
    }
    debug.timing.mandalaFilterMs = Date.now() - tMandalaFilterStart;
    debug.mandalaFilterOutput = kept;
    debug.mandalaFilterDroppedCenterGate = 0;
    debug.mandalaFilterDroppedJaccard = droppedNotInDeficit;
    debug.mandalaFilterCenterTokens = [];
    debug.mandalaFilterSubGoalTokenCounts = [];
    log.info(`youtube-ranking-only: kept=${kept} dropped_not_in_deficit=${droppedNotInDeficit}`);
  } else {
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
      semanticMinCosine: v3Config.semanticMinCosine,
      subGoalEmbeddings: input.state.subGoalEmbeddings,
      emptyTitleGateShadow: v3Config.emptyTitleGateShadow,
      emptyTitleGate: v3Config.emptyTitleGate,
    });
    debug.timing.mandalaFilterMs = Date.now() - tMandalaFilterStart;

    debug.mandalaFilterOutput = mfStats.output;
    debug.mandalaFilterDroppedCenterGate = mfStats.droppedByCenterGate;
    debug.mandalaFilterDroppedJaccard = mfStats.droppedByJaccardBelowThreshold;
    debug.mandalaFilterCenterTokens = mfStats.centerTokens;
    debug.mandalaFilterSubGoalTokenCounts = mfStats.subGoalTokenCounts;

    // CP457+ trace — Tier 2 mandala-filter gate (post-YouTube candidates).
    recordTrace({
      step: 'mandala_filter.semantic_gate.tier2',
      status: 'ok',
      request: {
        input_count: filterInputs.length,
        mode: v3Config.centerGateMode,
        language: input.state.language,
        subGoals_count: input.state.subGoals.length,
        focusTags: input.state.focusTags,
        semanticMinCosine: v3Config.semanticMinCosine,
        centerEmbedding_dim: centerEmbedding?.length ?? 0,
      },
      response: {
        stats: mfStats,
        byCell_counts: Array.from({ length: 8 }, (_, i) => byCell.get(i)?.length ?? 0),
      },
      latencyMs: Date.now() - tMandalaFilterStart,
    });

    for (const [cellIndex, list] of byCell) {
      if (!deficitCellSet.has(cellIndex)) continue;
      for (const a of list) {
        const enrichedVideo = enrichedById.get(a.candidate.videoId);
        if (!enrichedVideo) continue;
        scored.push({ video: enrichedVideo, cellIndex, score: a.score });
      }
    }
    mandalaFilterRanTier2 = true;
  }

  // P0 2026-07-11 — never-zero floor. When the RANKING gate (center cosine /
  // jaccard) drops every candidate, the run used to return "No recommendations"
  // → 0 cards, even though search found candidates and the SAFETY gates
  // (shorts / lang / blocklist / quality) already passed them (kapasi
  // 87960287: 108 found → gate input 10 → center-gate -8 → 0). Principle:
  // "덜 정렬된 카드 > 카드 0장" — admit the top-N in search-rank order into
  // deficit cells; async relevance backfill re-ranks them later. Flag off =
  // legacy fail-closed. See config/discover-zero-floor.ts.
  if (scored.length === 0 && filterable.length > 0 && isDiscoverNeverZeroFloorEnabled()) {
    const deficitCellList = input.deficitCells.map((c) => c.cellIndex);
    const cap = Math.min(getZeroFloorMax(), filterable.length);
    let floorScore = 0.05;
    for (let i = 0; i < cap; i++) {
      const v = filterable[i]!;
      const hinted = v.cellIndexHint;
      const cellIndex =
        hinted != null && deficitCellSet.has(hinted)
          ? hinted
          : deficitCellList[i % deficitCellList.length]!;
      scored.push({ video: enrichedById.get(v.videoId)!, cellIndex, score: floorScore });
      floorScore = Math.max(0.01, floorScore - 0.001);
    }
    debug.floorAdmitted = scored.length;
    // Per-fire mandala id (supervisor): floor-served mandalas bypass the
    // ranking gate — stratified quality checks must identify them.
    log.warn(
      `[zero-floor] mandala=${input.mandalaId ?? 'ephemeral'} ranking gate emptied ${filterable.length} candidates — floor-admitted ${scored.length} (cap ${cap})`
    );
  }

  const tScoringStart = Date.now();
  debug.scoredCandidates = scored.length;

  // Cap per cell using the deficit need + overall target remaining.
  const cellFilled = new Map<number, number>();
  const pickedVideoIds = new Set<string>();
  const channelPerCell = new Map<number, Map<string, number>>();
  scored.sort((a, b) => b.score - a.score);

  // R13-1 — domain-fit shadow (Tier 2). Fire-and-forget; enforce-0: reads
  // `scored` (already sorted, unmodified below) for logging only. The
  // in-array index IS the candidate's current serve rank for this run.
  if (mandalaFilterRanTier2) {
    scheduleDomainFitShadow({
      stage: 'tier2',
      centerGoal: input.state.centerGoal,
      subGoals: input.state.subGoals,
      candidates: scored.map((sc, rank) => ({
        videoId: sc.video.videoId,
        title: sc.video.title,
        cellIndex: sc.cellIndex,
        rank,
        score: sc.score,
      })),
    });
  }

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
  language: KeywordLanguage,
  /**
   * CP488 Phase 2b — 0-hit auto-retry fallback string. When ≥ 1 query in this
   * fan-out returns 0 items, ONE additional `search.list` call is issued
   * with this string as `q` (broader, mandala-wide). Pass undefined to keep
   * the legacy behavior (no retry).
   */
  opts?: { fallbackQuery?: string | undefined; videoCategoryId?: string }
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
          ...(opts?.videoCategoryId ? { videoCategoryId: opts.videoCategoryId } : {}),
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

  // CP488 Phase 2b — 0-hit auto-retry. When ≥ 1 query in this fan-out
  // returned 0 items AND a fallback string is supplied, issue ONE broader
  // search.list call (centerGoal only, default relevance order, no
  // videoCategoryId restriction so YouTube's full breadth is searched).
  // CP488 measurement showed 31% of search.list calls return 0 items
  // (run 0a4cdad7); single retry typically rescues niche / over-specific
  // queries to a workable pool without a runaway quota cost (1 extra
  // 100-unit call per run, not per-query).
  const zeroHits = perQuery.filter((p) => p.count === 0).length;
  if (zeroHits > 0 && opts?.fallbackQuery && opts.fallbackQuery.trim().length > 0) {
    try {
      const fallbackItems = await searchVideos({
        query: opts.fallbackQuery,
        apiKey: apiKeys,
        relevanceLanguage: language,
        regionCode,
        timeoutMs: v3Config.youtubeSearchTimeoutMs,
        // intentionally no videoCategoryId on fallback — broaden the net.
      });
      perQuery.push({
        query: `[CP488-fallback] ${opts.fallbackQuery}`,
        count: fallbackItems.length,
      });
      for (const item of fallbackItems) {
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
          cellIndexHint: null, // fallback is mandala-wide
        });
      }
      log.info(
        `[cp488-retry] zeroHits=${zeroHits}/${queries.length} → fallback "${opts.fallbackQuery}" returned ${fallbackItems.length}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`[cp488-retry] fallback search failed (continuing): ${msg}`);
      perQuery.push({
        query: `[CP488-fallback] ${opts.fallbackQuery}`,
        count: 0,
        error: msg,
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

/**
 * Row shape returned by the batch INSERT … RETURNING query.
 * Only the columns needed to build the SSE CardPayload are selected.
 */
interface UpsertedRow {
  id: string;
  video_id: string;
  title: string;
  channel: string | null;
  thumbnail: string | null;
  duration_sec: number | null;
  rec_score: number;
  cell_index: number | null;
  keyword: string;
  weight_version: number;
  rec_reason: string | null;
  published_at: Date | null;
}

/**
 * Batch-upsert all slots in a single SQL round-trip using
 * INSERT … ON CONFLICT … DO UPDATE … RETURNING.
 *
 * Falls back to per-row Prisma upserts if the batch statement fails,
 * so a SQL dialect mismatch or constraint surprise does not block the
 * entire run.
 *
 * The SSE notification (notifyCardAdded) fires for every successfully
 * persisted row — identical behaviour to the previous loop implementation.
 */
async function upsertSlots(
  userId: string,
  mandalaId: string,
  slots: ReadonlyArray<AssembledSlot>,
  subGoals: ReadonlyArray<string>
): Promise<number> {
  if (slots.length === 0) return 0;

  const db = getPrismaClient();
  const expiresAt = new Date(Date.now() + TTL_DAYS * MS_PER_DAY);

  // ------------------------------------------------------------------
  // Build per-slot derived values once so we don't recompute inside loops
  // ------------------------------------------------------------------
  const prepared = slots.map((slot) => ({
    slot,
    keyword: (subGoals[slot.cellIndex] ?? '').slice(0, 255),
    likeRatio:
      slot.likeCount != null && slot.viewCount && slot.viewCount > 0
        ? Math.min(slot.likeCount / slot.viewCount, 1)
        : null,
    recScore: Math.max(0, Math.min(1, slot.score)),
    // P3 Stage 2 (CP513) — display-only relevance_pct write. null → COALESCE keeps
    // any backfilled value on re-serve. Never part of rec_score.
    relevancePct: slot.relevancePct ?? null,
  }));

  // ------------------------------------------------------------------
  // Attempt: single batch INSERT … ON CONFLICT … DO UPDATE … RETURNING
  // ------------------------------------------------------------------
  let upsertedRows: UpsertedRow[] | null = null;
  try {
    // Build a VALUES list: one Prisma.sql fragment per row, then join.
    const valueFragments = prepared.map(
      ({ slot, keyword, likeRatio, recScore, relevancePct }) =>
        Prisma.sql`(
        ${userId}::uuid,
        ${mandalaId}::uuid,
        ${slot.cellIndex}::int,
        ${keyword}::varchar(255),
        ${slot.videoId}::varchar(64),
        ${slot.title},
        ${slot.thumbnail},
        ${slot.channelName?.slice(0, 255) ?? null}::varchar(255),
        ${slot.viewCount}::int,
        ${likeRatio}::float8,
        ${slot.durationSec}::int,
        ${recScore}::float8,
        ${relevancePct}::int,
        ${slot.tier},
        ${RECOMMENDATION_STATUS_PENDING}::varchar(20),
        ${WEIGHT_VERSION}::int,
        ${expiresAt}::timestamptz,
        ${slot.publishedAt}::timestamptz
      )`
    );

    upsertedRows = await db.$queryRaw<UpsertedRow[]>`
      INSERT INTO recommendation_cache (
        user_id, mandala_id, cell_index, keyword, video_id,
        title, thumbnail, channel, view_count, like_ratio,
        duration_sec, rec_score, relevance_pct, rec_reason, status, weight_version,
        expires_at, published_at
      )
      VALUES ${Prisma.join(valueFragments)}
      ON CONFLICT (user_id, mandala_id, video_id) DO UPDATE SET
        relevance_pct  = COALESCE(EXCLUDED.relevance_pct, recommendation_cache.relevance_pct),
        cell_index     = EXCLUDED.cell_index,
        keyword        = EXCLUDED.keyword,
        title          = EXCLUDED.title,
        thumbnail      = EXCLUDED.thumbnail,
        channel        = EXCLUDED.channel,
        view_count     = EXCLUDED.view_count,
        like_ratio     = EXCLUDED.like_ratio,
        duration_sec   = EXCLUDED.duration_sec,
        rec_score      = EXCLUDED.rec_score,
        rec_reason     = EXCLUDED.rec_reason,
        weight_version = EXCLUDED.weight_version,
        expires_at     = EXCLUDED.expires_at,
        published_at   = EXCLUDED.published_at
      RETURNING
        id, video_id, title, channel, thumbnail, duration_sec,
        rec_score, cell_index, keyword, weight_version, rec_reason,
        published_at
    `;
  } catch (batchErr) {
    log.warn(
      `recommendation_cache batch upsert failed (${slots.length} slots), falling back to per-row: ${
        batchErr instanceof Error ? batchErr.message : String(batchErr)
      }`
    );
  }

  // ------------------------------------------------------------------
  // Fallback: per-row Prisma upserts (preserves pre-existing behaviour)
  // ------------------------------------------------------------------
  if (upsertedRows === null) {
    let count = 0;
    for (const { slot, keyword, likeRatio, recScore, relevancePct } of prepared) {
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
            like_ratio: likeRatio,
            duration_sec: slot.durationSec,
            rec_score: recScore,
            // P3 Stage 2 (CP513) — display-only relevance_pct (null if uncomputed).
            relevance_pct: relevancePct,
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
            like_ratio: likeRatio,
            duration_sec: slot.durationSec,
            rec_score: recScore,
            // Only overwrite when computed — preserves any backfilled value (COALESCE parity).
            ...(relevancePct != null ? { relevance_pct: relevancePct } : {}),
            rec_reason: slot.tier,
            weight_version: WEIGHT_VERSION,
            expires_at: expiresAt,
            published_at: slot.publishedAt,
          },
        });
        count++;

        // Phase 1 slice 2 (SSE streaming) — best-effort, non-fatal.
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
            cellLabel: null,
            keyword: row.keyword ?? keyword,
            source: row.weight_version === 0 ? 'manual' : 'auto_recommend',
            recReason: row.rec_reason,
            publishedAt: row.published_at?.toISOString() ?? null,
            // PR3 — chunk anchor for live SSE. We could batch-lookup per slot
            // but that adds DB round trips during the upsert hot path; the
            // backlog emit path already supplies anchors to subscribers when
            // they connect. Set null here; FE falls back to plain URL.
            startSec: null,
          };
          notifyCardAdded(mandalaId, payload);
        } catch (notifyErr) {
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

  // ------------------------------------------------------------------
  // Batch succeeded — fire SSE notifications for each returned row
  // ------------------------------------------------------------------
  const slotByVideoId = new Map(
    prepared.map(({ slot, keyword }) => [slot.videoId, { slot, keyword }])
  );

  for (const row of upsertedRows) {
    const entry = slotByVideoId.get(row.video_id);
    const fallbackCellIndex = entry?.slot.cellIndex ?? 0;
    const fallbackKeyword = entry?.keyword ?? row.keyword;

    // Phase 1 slice 2 (SSE streaming) — best-effort, non-fatal.
    try {
      const payload: CardPayload = {
        id: row.id,
        videoId: row.video_id,
        title: row.title,
        channel: row.channel,
        thumbnail: row.thumbnail,
        durationSec: row.duration_sec,
        recScore: row.rec_score,
        cellIndex: row.cell_index ?? fallbackCellIndex,
        // cellLabel is derived at read-time in /recommendations (from
        // mandala levels). The SSE consumer resolves it client-side
        // from the already-loaded mandala state to avoid a DB round-
        // trip per notification.
        cellLabel: null,
        keyword: row.keyword ?? fallbackKeyword,
        source: row.weight_version === 0 ? 'manual' : 'auto_recommend',
        recReason: row.rec_reason,
        publishedAt: row.published_at?.toISOString() ?? null,
        // PR3 — chunk anchor not looked up in hot upsert path; SSE backlog
        // path supplies anchors on subscriber connect (see mandalas.ts).
        startSec: null,
      };
      notifyCardAdded(mandalaId, payload);
    } catch (notifyErr) {
      log.warn(
        `notifyCardAdded failed for ${row.video_id}: ${
          notifyErr instanceof Error ? notifyErr.message : String(notifyErr)
        }`
      );
    }
  }

  return upsertedRows.length;
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
  /** CP457 — video_pool Tier 1 matches via centerGoal embedding. */
  tier1_matches: number;
  tier2_matches: number;
  duration_ms: number;
  debug?: Tier2Debug;
  /**
   * CP491 F5c — v5 executor diagnostics (stageMs / perQuery / picksRaw / ...).
   * Transport only: carried in mandala_wizard_precompute.discover_result so
   * consumePrecompute can emit a `wizard.discover.end` trace keyed by the
   * mandala_id (which does not exist yet at precompute time). Final queryable
   * storage is the trace, not this JSON. Decoupled (Record) to avoid v3↔v5
   * import coupling.
   */
  diagnostics?: Record<string, unknown>;
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
  // CP488 — ephemeral path has no mandala_id, so resolveAlgorithm only checks
  // global active + 'v1-current' fallback + env. Result still stamps
  // algorithm_version on every trace row from this run.
  const resolved = await resolveAlgorithm({ userId: null, mandalaId: null });
  // CP457+ — bind trace context for ephemeral wizard path. mandalaId is
  // not yet known (wizard precompute), so use null and let downstream
  // consume-time copy the run_id forward.
  return withTraceContext({ mandalaId: null, userId: null, algorithmVersion: resolved.id }, () =>
    runDiscoverEphemeralImpl(input, resolved.parameters, resolved.id)
  );
}

async function runDiscoverEphemeralImpl(
  input: EphemeralDiscoverInput,
  /** CP488 — algorithm-resolved parameters (same pattern as executeImpl). */
  resolvedConfig: V3Config = v3Config,
  algorithmVersion: string | null = null
): Promise<EphemeralDiscoverResult> {
  // eslint-disable-next-line @typescript-eslint/no-shadow
  const v3Config = resolvedConfig;
  const t0 = Date.now();
  const apiKeys = resolveSearchApiKeys(input.env);
  if (apiKeys.length === 0) {
    throw new Error('YOUTUBE_API_KEY_SEARCH is not configured');
  }
  const openRouterApiKey = input.env['OPENROUTER_API_KEY'];
  const openRouterModel = input.env['OPENROUTER_MODEL'] ?? 'qwen/qwen3-30b-a3b';
  recordTrace({
    step: 'pipeline.ephemeral.start',
    status: 'ok',
    request: {
      centerGoal: input.centerGoal,
      subGoals: input.subGoals,
      language: input.language,
      focusTags: input.focusTags,
      targetLevel: input.targetLevel,
      algorithm_version: algorithmVersion,
      algorithm_parameters: v3Config,
    },
    response: null,
  });

  // ── Tier 0: Redis video-dictionary (gated by v3Config.enableRedisProvider; default off, Y0g) ─
  const redisSlots: AssembledSlot[] = [];
  if (v3Config.enableRedisProvider) {
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
  } else {
    log.info(`[redis][ephemeral] disabled by V3_ENABLE_REDIS_PROVIDER=false (Y0g)`);
  }

  // ── Tier 1: video_pool cache by center-goal embedding (CP457) ─
  // Ephemeral path has no mandala_id → cannot use mandala_embeddings table.
  // Instead we embed centerGoal once and query video_pool_embeddings cosine
  // directly. Cell index is assigned via subGoal token-overlap argmax inside
  // matchFromVideoPoolByCenterGoal (same pattern as tsvectorKeywordCandidates).
  // Gated by V3_ENABLE_TIER1_CACHE (same flag as mandala-id Tier 1).
  const tier1Slots: AssembledSlot[] = [];
  const existingVideoIds = new Set(redisSlots.map((s) => s.videoId));
  if (v3Config.enableTier1Cache) {
    try {
      const [centerVec] = await embedBatch([input.centerGoal], servingEmbedOptions());
      if (centerVec && centerVec.length > 0) {
        const tier1Matches = await matchFromVideoPoolByCenterGoal({
          centerEmbedding: centerVec,
          subGoals: input.subGoals,
          language: input.language,
          limit: V3_TARGET_TOTAL,
          threshold: v3Config.semanticMinCosine,
          sources: v3Config.tier1Sources,
        });
        for (const m of tier1Matches) {
          if (existingVideoIds.has(m.videoId)) continue;
          tier1Slots.push({
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
            cellIndex: m.cellIndex,
            score: m.score,
            tier: 'cache',
          });
          existingVideoIds.add(m.videoId);
        }
        log.info(
          `[tier1][ephemeral] matches=${tier1Matches.length} admitted=${tier1Slots.length} ` +
            `sources=[${v3Config.tier1Sources.join(',')}] threshold=${v3Config.semanticMinCosine}`
        );
      } else {
        log.warn(`[tier1][ephemeral] centerGoal embed returned empty — skipping Tier 1`);
      }
    } catch (err) {
      log.warn(
        `[tier1][ephemeral] threw — skipping Tier 1: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  } else {
    log.info(`[tier1][ephemeral] disabled by V3_ENABLE_TIER1_CACHE=false`);
  }

  // ── Compute per-cell deficit after Redis + Tier 1 ─
  const cacheByCell = new Map<number, number>();
  for (const s of [...redisSlots, ...tier1Slots]) {
    cacheByCell.set(s.cellIndex, (cacheByCell.get(s.cellIndex) ?? 0) + 1);
  }

  const deficitCells: { cellIndex: number; need: number }[] = [];
  for (let i = 0; i < V3_NUM_CELLS; i++) {
    const have = cacheByCell.get(i) ?? 0;
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
        // Ephemeral path has no mandala in DB → no sub_goal embeddings.
        // Semantic cell assignment falls back to lexical jaccard+bigram.
        subGoalEmbeddings: [],
        language: input.language,
        focusTags: input.focusTags,
        targetLevel: input.targetLevel,
      },
      apiKeys,
      videosApiKeys: resolveVideosApiKeys(input.env),
      openRouterApiKey: openRouterApiKey || undefined,
      openRouterModel,
      existingVideoIds,
    });
    tier2Slots = tier2.slots;
    queriesUsed = tier2.queriesUsed;
    tier2Debug = tier2.debug;
  }

  const allSlots = [...redisSlots, ...tier1Slots, ...tier2Slots];

  let filteredSlots = allSlots;
  if (allSlots.length > 0 && v3Config.centerGateMode === 'semantic') {
    try {
      const cap = v3Config.semanticMaxCandidates;
      const cappedSlots = allSlots.slice(0, cap);
      const texts = [input.centerGoal, ...cappedSlots.map((s) => s.title)];
      const embedT0 = Date.now();
      const vectors = await embedBatch(texts, servingEmbedOptions());
      const embedMs = Date.now() - embedT0;
      if (vectors.length === texts.length) {
        const centerEmbedding = vectors[0] ?? undefined;
        const candidateEmbeddings = new Map<string, number[]>();
        for (let i = 0; i < cappedSlots.length; i++) {
          const vec = vectors[i + 1];
          const id = cappedSlots[i]?.videoId;
          if (vec && id) candidateEmbeddings.set(id, vec);
        }
        const filterInputs = allSlots.map((s) => ({
          videoId: s.videoId,
          title: s.title,
          description: s.description,
          publishedAt: s.publishedAt,
        }));
        const mfT0 = Date.now();
        const { byCell, stats: mfStats } = applyMandalaFilterWithStats(filterInputs, {
          centerGoal: input.centerGoal,
          subGoals: input.subGoals,
          language: input.language,
          focusTags: input.focusTags,
          recencyWeight: v3Config.recencyWeight,
          recencyHalfLifeMonths: v3Config.recencyHalfLifeMonths,
          centerGateMode: v3Config.centerGateMode,
          centerEmbedding,
          candidateEmbeddings,
          semanticMinCosine: v3Config.semanticMinCosine,
          emptyTitleGateShadow: v3Config.emptyTitleGateShadow,
          emptyTitleGate: v3Config.emptyTitleGate,
        });
        const slotById = new Map(allSlots.map((s) => [s.videoId, s]));
        const flattened: AssembledSlot[] = [];
        for (const [cellIndex, assignments] of byCell.entries()) {
          for (const a of assignments) {
            const original = slotById.get(a.candidate.videoId);
            if (original) {
              flattened.push({ ...original, cellIndex, score: a.score });
            }
          }
        }
        filteredSlots = flattened;
        log.info(
          `[ephemeral] mandala-filter input=${mfStats.input} output=${mfStats.output} ` +
            `droppedCenterGate=${mfStats.droppedByCenterGate} droppedJaccard=${mfStats.droppedByJaccardBelowThreshold} ` +
            `mode=${mfStats.centerGateMode ?? '-'} embedMs=${embedMs}`
        );
        // CP457+ trace — ephemeral mandala-filter gate (Redis + Tier 1 + Tier 2 unified).
        recordTrace({
          step: 'mandala_filter.semantic_gate.ephemeral',
          status: 'ok',
          request: {
            input_count: filterInputs.length,
            mode: v3Config.centerGateMode,
            language: input.language,
            subGoals_count: input.subGoals.length,
            focusTags: input.focusTags,
            semanticMinCosine: v3Config.semanticMinCosine,
            centerEmbedding_dim: centerEmbedding?.length ?? 0,
            embedMs,
          },
          response: {
            stats: mfStats,
            byCell_counts: Array.from({ length: 8 }, (_, i) => byCell.get(i)?.length ?? 0),
            flattened_count: flattened.length,
          },
          latencyMs: Date.now() - mfT0,
        });
      } else {
        log.warn(
          `[ephemeral] mandala-filter embed vector mismatch: got ${vectors.length}/${texts.length} — skipping filter`
        );
      }
    } catch (err) {
      log.warn(
        `[ephemeral] mandala-filter threw — falling back to unfiltered slots: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  let rerankedSlots = filteredSlots;
  try {
    const hybridResult = await applyHybridRerank({
      slots: filteredSlots.map((s) => ({
        videoId: s.videoId,
        title: s.title,
        cellIndex: s.cellIndex,
        rec_score: s.score,
        _original: s,
      })),
      centerGoal: input.centerGoal,
      subGoals: input.subGoals,
      enableKeywordExpansion: true,
      topN: V3_TARGET_TOTAL,
      requestId: 'ephemeral-precompute',
      sources: v3Config.tier1Sources,
    });
    rerankedSlots = hybridResult.slots
      .map((r) => {
        const ext = r as unknown as {
          _original?: AssembledSlot;
          _keywordFullData?: {
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
          };
        };
        if (ext._original) {
          return { ...ext._original, score: r.rec_score };
        }
        if (ext._keywordFullData) {
          const k = ext._keywordFullData;
          return {
            videoId: k.videoId,
            title: k.title,
            description: k.description,
            channelName: k.channelName,
            channelId: k.channelId,
            thumbnail: k.thumbnail,
            viewCount: k.viewCount,
            likeCount: k.likeCount,
            durationSec: k.durationSec,
            publishedAt: k.publishedAt,
            cellIndex: k.cellIndex,
            score: r.rec_score,
            tier: 'cache' as const,
          };
        }
        return null;
      })
      .filter((s): s is AssembledSlot => s !== null);
    log.info(
      `[ephemeral] hybrid-rerank ${filteredSlots.length} → ${rerankedSlots.length} slots ` +
        `(applied=${hybridResult.stats.applied} reason=${hybridResult.stats.reason} ` +
        `keywordAdded=${hybridResult.stats.keywordAdded} reranked=${hybridResult.stats.reranked} ` +
        `latencyMs=${hybridResult.stats.cohereLatencyMs ?? '-'})`
    );
  } catch (err) {
    log.warn(
      `[ephemeral] hybrid-rerank threw — falling back to unranked slots: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  return {
    slots: rerankedSlots,
    queriesUsed,
    tier0_matches: redisSlots.length,
    tier1_matches: tier1Slots.length,
    tier2_matches: tier2Slots.length,
    duration_ms: Date.now() - t0,
    debug: tier2Debug,
  };
}

/**
 * Parse a pgvector literal (`[f1,f2,...]`) into a `number[]`.
 * Mirrors the identical helper in v2/executor.ts — kept local so v3 has
 * no runtime dependency on v2's private scope.
 */
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
