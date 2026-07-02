/**
 * Pool-serve fill — CP499+ (UX 원칙 2: 빈 셀 = 풀 서빙으로 충당).
 *
 * ASYNC consumer of the A-2 relevance gate cache: one job per DEFICIT CELL,
 * three stages (James 2026-06-11 unified scope — no partial-state exposure):
 *
 *   1차 POOL  — recruit ko-pool candidates (lexical tsvector = recruitment
 *               ONLY) → semantic judge (computeCardRelevance) ≥
 *               V5_POOL_SERVE_RELEVANCE_MIN → top-K insert.
 *   2차 LIVE  — still short of MIN_PER_CELL → ONE live ko re-search
 *               (search.list, relevanceLanguage=ko, per-cell 1-call cap) →
 *               SAME hygiene gates (#905 incl.) + SAME semantic judge
 *               (live도 무심판 주입 금지 — displacement 방지 동일 원칙).
 *               Lever: V5_POOL_SERVE_LIVE_FALLBACK (default ON).
 *   3차 EMPTY — still zero = HONESTLY EMPTY (no irrelevant injection).
 *
 * This is the pool-side implementation of the "v5 공통 관련성 게이트"
 * (CP494+1 incident: pool serving without a judge destroyed quality).
 *
 * Invariants:
 *  - NEVER blocks a user request — dispatched fire-and-forget after card
 *    placement; deficit cells show the W1b "filling" state
 *    (skill_runs row drives `fillPendingCells`).
 *  - Gate scores are CACHED in video_mandala_relevance (lazy A-2 fill) and
 *    COPIED to uvs.relevance_pct on insert (no re-scoring).
 *  - R1-independent: computeCardRelevance runs legacy single-axis when
 *    RELEVANCE_RUBRIC_ENABLED is off; same call upgrades under R1.
 */

import type PgBoss from 'pg-boss';

import { computeCardRelevance } from '@/modules/relevance/compute-card-relevance';
import { getPrismaClient } from '@/modules/database/client';
import { loadPoolServeConfig } from '@/config/pool-serve';
import { loadRelevanceRubricConfig } from '@/config/relevance-rubric';
import {
  tsvectorKeywordCandidatesPerCell,
  cosinePoolCandidatesPerCell,
} from '@/skills/plugins/video-discover/v3/hybrid-rerank';
import {
  resolveSearchApiKeys,
  resolveVideosApiKeys,
  searchVideos,
  titleHitsBlocklist,
  titleIndicatesShorts,
  videosBatch,
} from '@/skills/plugins/video-discover/v2/youtube-client';
import { isShortCached, SHORT_MAX_DURATION_SEC } from '@/modules/video-pool/is-short';
import { getV5Config } from '@/skills/plugins/video-discover/v5/config';
import { parseIsoDurationSeconds } from '@/skills/plugins/video-discover/v5/executor';
import { isOffLanguageTitleToggled } from '@/skills/plugins/video-discover/v5/youtube-fanout';
import { dedupeSeries, softChannelCap } from '@/skills/plugins/video-discover/diversity-guard';
import { loadDiversityGuardConfig } from '@/config/diversity-guard';
import { logger } from '@/utils/logger';
import { config } from '@/config/index';
import { writeSearchTrace, type SearchTraceCandidateInput } from '@/modules/search-trace';
import { getJobQueue } from '../manager';
import { JOB_NAMES, POOL_SERVE_FILL_RETRY_OPTIONS, type PoolServeFillPayload } from '../types';
import { richSummaryWorkOptions } from './rich-summary-work-options';
import { placeAutoAddedCards } from '@/modules/mandala/place-auto-added-cards';

const log = logger.child({ module: 'pool-serve-fill' });

/** Candidates scored concurrently (OpenRouter key shared — bursts of 4, CP499). */
const SCORE_BURST_SIZE = 4;
/** Live fallback fetch size — one search.list call, gated downstream. */
const LIVE_FALLBACK_MAX_RESULTS = 10;
/** Pool recruitment source whitelist (single tier today — v2_promoted only). */
const POOL_SOURCES = ['v2_promoted'] as const;
/** Per-candidate source_tier for pool recruits. When the whitelist is a single
 *  tier every recruit carries it; if it ever becomes multi-tier, add `source`
 *  to the hybrid-rerank SELECT to attribute per-candidate instead. */
const POOL_SOURCE_TIER: string | null = POOL_SOURCES.length === 1 ? POOL_SOURCES[0] : null;
/** search.list = 100 units/call; videos.list batch = 1 unit (youtube-client). */
const SEARCH_LIST_UNITS = 100;
export const POOL_SERVE_SKILL_ID = 'pool-serve-fill';

export async function registerPoolServeFillWorker(): Promise<void> {
  const boss = getJobQueue().getInstance();
  const concurrency = loadPoolServeConfig().concurrency;
  await boss.work<PoolServeFillPayload>(
    JOB_NAMES.POOL_SERVE_FILL,
    richSummaryWorkOptions(concurrency),
    handlePoolServeFill
  );
  log.info(`pool-serve-fill worker registered (concurrency=${concurrency})`);
}

/** Normalized candidate entering the gate (pool or live). */
export interface GateCandidate {
  youtubeVideoId: string;
  title: string;
  description: string | null;
  channelTitle: string | null;
  thumbnail: string | null;
  publishedAt: Date | null;
  /** CP500+ shorts gate — pool rows carry it; live rows get it via videos.list. */
  durationSec?: number | null;
  /** Observability — pool lexical rec_score (ts_rank); null on live candidates. */
  tsRank?: number | null;
  /** Observability — 'pool' recruits vs 'live' fallback. */
  sourceKind?: 'live' | 'pool';
  /** Observability — pool tier (v2_promoted…); null on live. */
  sourceTier?: string | null;
}

interface PassedCandidate extends GateCandidate {
  relevancePct: number;
  /** Observability — the gate axis value (gc / goalContribution or composite). */
  gatePct: number;
}

export interface PoolServeCellResult {
  recruited: number;
  scored: number;
  cacheHits: number;
  poolPassed: number;
  liveAttempted: boolean;
  liveRecruited: number;
  livePassed: number;
  inserted: number;
  /** CP500+ — dropped by the replicated v5 shorts gate (duration<180 + URL probe). */
  shortsDropped: number;
}

/** One deficit cell: 1차 pool → 2차 live fallback → 3차 honest-empty. */
async function handlePoolServeFill(job: PgBoss.Job<PoolServeFillPayload>): Promise<void> {
  const p = job.data;
  const cfg = loadPoolServeConfig();
  const prisma = getPrismaClient();
  const result: PoolServeCellResult = {
    recruited: 0,
    scored: 0,
    cacheHits: 0,
    poolPassed: 0,
    liveAttempted: false,
    liveRecruited: 0,
    livePassed: 0,
    inserted: 0,
    shortsDropped: 0,
  };

  // Observability Phase 1 (STEP 3) — pool-serve trail log. Observation-only:
  // accumulate PLACED / below_relevance_min / budget_full rows for SCORED
  // candidates (gc/ts_rank/source_tier get filled here — pool-serve's unique
  // value vs the null-scored live sync paths). Emitted in `finally`.
  const traceOn = config.searchTrace.enabled;
  const traceRows: SearchTraceCandidateInput[] = [];
  // Live-fallback quota: search.list (100) + videos.list batch (1). Pool
  // recruitment is quota-free (DB). Recorded nowhere before Phase 1.
  let liveVideosUnits = 0;

  try {
    const need = Math.min(p.deficit, cfg.maxFillPerCell);
    // CP500+ 축 분리: rubric = PURE 3-axis score (no freshness term). The
    // volatile-only recency quota is a PLACEMENT-layer follow-up, not here.
    const rubric = loadRelevanceRubricConfig().enabled;

    const owned = await prisma.$queryRaw<{ youtube_video_id: string }[]>`
      SELECT yv.youtube_video_id
      FROM user_video_states uvs JOIN youtube_videos yv ON yv.id = uvs.video_id
      WHERE uvs.user_id = ${p.userId}::uuid`;
    const seen = new Set(owned.map((r) => r.youtube_video_id));

    const hygienic = (cands: GateCandidate[]): GateCandidate[] =>
      cands.filter(
        (c) =>
          c.youtubeVideoId &&
          !seen.has(c.youtubeVideoId) &&
          !titleHitsBlocklist(c.title) &&
          !titleIndicatesShorts(c.title) &&
          // #905 posture: AUTO inflow on a ko mandala is ko-only.
          !isOffLanguageTitleToggled(c.title, p.language, false)
      );

    // CP500+ diversity guard — series-dedup BEFORE the gate (saves scoring
    // calls), soft channel cap reorders the scoring order. `against` makes the
    // live pass series-aware of what the pool pass already accepted. Known
    // limit: already-OWNED cards' titles are not loaded (id-only exclude), so
    // cross-run series dups are out of scope here (backlog).
    const diversity = loadDiversityGuardConfig();
    const applyDiversity = (cands: GateCandidate[], against: GateCandidate[]): GateCandidate[] => {
      if (!diversity.enabled) return cands;
      const d = dedupeSeries(cands, { simThreshold: diversity.seriesSim, against });
      return softChannelCap(d.kept, diversity.channelSoftCap);
    };

    // CP500+ shorts gate — EXACT replica of the v5 placement gate
    // (v5/executor.ts step 6): duration>=180 short-circuits with no HTTP;
    // <180 (or unknown) probes the /shorts/ URL via isShortCached; probes
    // still in-flight at the shared deadline fail OPEN (kept) — identical
    // semantics, same knob (V5_SHORT_PROBE_DEADLINE_MS). This path shipped
    // (#907) with only the title heuristic — the guard-replication gap
    // (troubleshooting LEVEL-2, recurrence=2 with the channel-cap loss).
    const shortDeadlineMs = getV5Config(process.env).shortProbeDeadlineMs;
    const dropShorts = async (cands: GateCandidate[]): Promise<GateCandidate[]> => {
      if (cands.length === 0 || shortDeadlineMs <= 0) return cands;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), shortDeadlineMs);
      try {
        const flags = await Promise.all(
          cands.map(async (c) => {
            if (c.durationSec != null && c.durationSec >= SHORT_MAX_DURATION_SEC) return false;
            const { isShort } = await isShortCached(c.youtubeVideoId, c.durationSec ?? null, {
              signal: ctl.signal,
            });
            return isShort;
          })
        );
        const kept = cands.filter((_, i) => !flags[i]);
        result.shortsDropped += cands.length - kept.length;
        return kept;
      } finally {
        clearTimeout(timer);
      }
    };

    /** Semantic gate: vmr cache first, score on miss, threshold; early-exit.
     *  CP500+ R1 bundle — GATE AXIS depends on the rubric flag:
     *    rubric ON  → gatePct = goal_contribution (detail.goalContributionPct,
     *                 measured discriminator; threshold 65 spec). Cached rows
     *                 WITHOUT detail (legacy composite scores) are treated as
     *                 MISS and re-scored — legacy 62-72 mode scores must not
     *                 leak through the gc gate.
     *    rubric OFF → gatePct = composite (legacy behavior, byte-identical).
     *  The COMPOSITE is always what gets copied to uvs.relevance_pct (sort/badge). */
    const gate = async (cands: GateCandidate[], passed: PassedCandidate[]): Promise<void> => {
      for (let i = 0; i < cands.length && passed.length < need; i += SCORE_BURST_SIZE) {
        const burst = cands.slice(i, i + SCORE_BURST_SIZE);
        const scores = await Promise.all(
          burst.map(async (c) => {
            const cached = await prisma.$queryRaw<
              { relevance_pct: number; detail: { goalContributionPct?: number } | null }[]
            >`
              SELECT relevance_pct, detail FROM video_mandala_relevance
              WHERE video_id = ${c.youtubeVideoId} AND mandala_id = ${p.mandalaId}::uuid`;
            if (cached[0]) {
              const cachedGc = cached[0].detail?.goalContributionPct;
              if (!rubric) {
                result.cacheHits += 1;
                return { c, gatePct: cached[0].relevance_pct, displayPct: cached[0].relevance_pct };
              }
              if (typeof cachedGc === 'number') {
                result.cacheHits += 1;
                return { c, gatePct: cachedGc, displayPct: cached[0].relevance_pct };
              }
              // rubric ON + legacy cache row (no axes) → fall through to re-score.
            }
            const r = await computeCardRelevance({
              title: c.title,
              description: c.description ?? '',
              centerGoal: p.centerGoal,
              cellGoal: p.cellGoal,
              language: p.language,
              ...(rubric ? { rubric: true } : {}),
            });
            result.scored += 1;
            if (!r.ok) {
              log.warn(`pool-serve gate score failed (skip): ${r.reason}`);
              return { c, gatePct: null, displayPct: null };
            }
            const detailJson = r.detail ? JSON.stringify(r.detail) : null;
            await prisma.$executeRaw`
              INSERT INTO video_mandala_relevance (video_id, mandala_id, relevance_pct, detail)
              VALUES (${c.youtubeVideoId}, ${p.mandalaId}::uuid, ${r.relevancePct}, ${detailJson}::jsonb)
              ON CONFLICT (video_id, mandala_id)
              DO UPDATE SET relevance_pct = EXCLUDED.relevance_pct,
                            detail = EXCLUDED.detail, relevance_at = now()`;
            const gatePct = rubric && r.detail ? r.detail.goalContributionPct : r.relevancePct;
            return { c, gatePct, displayPct: r.relevancePct };
          })
        );
        for (const { c, gatePct, displayPct } of scores) {
          // Identical predicate to the original inline condition — extracted so
          // the trace can label PLACED vs the drop reason. No decision changed.
          const willPlace =
            gatePct !== null &&
            displayPct !== null &&
            gatePct >= cfg.relevanceMin &&
            passed.length < need;
          if (willPlace) {
            passed.push({ ...c, relevancePct: displayPct, gatePct: gatePct });
            seen.add(c.youtubeVideoId);
          }
          // Observation-only: trace scored candidates (skip scorer errors,
          // gatePct=null). budget_full = passed the gate but the cell was
          // already filled to `need`.
          if (traceOn && gatePct !== null) {
            traceRows.push({
              videoId: c.youtubeVideoId,
              channelTitle: c.channelTitle ?? null,
              sourceKind: c.sourceKind ?? 'pool',
              sourceCellIndex: p.cellIndex,
              sourceTier: c.sourceTier ?? null,
              stageReached: 'pool_gate',
              decision: willPlace ? 'PLACED' : 'DROPPED',
              dropReason: willPlace
                ? null
                : gatePct >= cfg.relevanceMin
                  ? 'budget_full'
                  : 'below_relevance_min',
              relevanceGc: Math.round(gatePct),
              tsRank: c.tsRank ?? null,
              durationSec: c.durationSec ?? null,
              publishedAt: c.publishedAt,
              finalCellIndex: willPlace ? p.cellIndex : null,
            });
          }
        }
      }
    };

    // ── 1차 POOL ──────────────────────────────────────────────────────────
    const keywordRecruits = await tsvectorKeywordCandidatesPerCell(
      [{ cellIndex: p.cellIndex, query: p.cellQuery }],
      [...seen],
      cfg.candidatesLimit,
      POOL_SOURCES
    );
    // Optional COSINE recruit pass (flag-gated): surfaces pool supply whose
    // TITLE doesn't literally match the cell goal (keyword misses it). Broadens
    // sources to include yt_promoted (direct-collected). Merged keyword-first,
    // deduped; the gc-gate below still owns precision (cosine noise is rejected).
    let recruits = keywordRecruits;
    if (cfg.cosineRecruit) {
      const kwIds = new Set(keywordRecruits.map((c) => c.videoId));
      const cosineRecruits = await cosinePoolCandidatesPerCell(
        p.mandalaId,
        [p.cellIndex],
        p.language,
        [...seen, ...keywordRecruits.map((c) => c.videoId)],
        cfg.cosineK,
        [...POOL_SOURCES, 'yt_promoted'],
        cfg.cosineDistMax
      );
      recruits = [...keywordRecruits, ...cosineRecruits.filter((c) => !kwIds.has(c.videoId))];
    }
    result.recruited = recruits.length;
    const passed: PassedCandidate[] = [];
    await gate(
      await dropShorts(
        applyDiversity(
          hygienic(
            recruits.map((c) => ({
              youtubeVideoId: c.videoId,
              title: c.title,
              description: c.description,
              channelTitle: c.channelName,
              thumbnail: c.thumbnail,
              publishedAt: c.publishedAt,
              durationSec: c.durationSec,
              tsRank: c.rec_score,
              sourceKind: 'pool' as const,
              sourceTier: POOL_SOURCE_TIER,
            }))
          ),
          []
        )
      ),
      passed
    );
    result.poolPassed = passed.length;

    // ── 2차 LIVE fallback — pool로 부족할 때만, 셀당 search.list 1콜 cap ──
    if (passed.length < need && cfg.liveFallback) {
      result.liveAttempted = true;
      try {
        const keys = resolveSearchApiKeys(process.env);
        const items = await searchVideos({
          query: p.cellQuery,
          apiKey: keys,
          maxResults: LIVE_FALLBACK_MAX_RESULTS,
          relevanceLanguage: p.language,
          regionCode: p.language === 'ko' ? 'KR' : 'US',
        });
        const liveCands = hygienic(
          items.map((it) => ({
            youtubeVideoId: it.id?.videoId ?? '',
            title: it.snippet?.title ?? '',
            description: it.snippet?.description ?? null,
            channelTitle: it.snippet?.channelTitle ?? null,
            thumbnail: it.snippet?.thumbnails?.high?.url ?? null,
            publishedAt: it.snippet?.publishedAt ? new Date(it.snippet.publishedAt) : null,
            sourceKind: 'live' as const,
          }))
        );
        result.liveRecruited = liveCands.length;
        // CP500+ — live candidates carry NO duration (search.list snippet
        // only); fetch it with ONE videos.list call (quota 1 unit) so the
        // replicated shorts gate can run the same duration<180 + probe
        // semantics as the v5 placement path.
        if (liveCands.length > 0) {
          try {
            const metas = await videosBatch({
              videoIds: liveCands.map((c) => c.youtubeVideoId),
              apiKey: resolveVideosApiKeys(process.env),
            });
            liveVideosUnits = 1; // one videos.list batch call = 1 quota unit

            const durById = new Map(
              metas.map((m) => [m.id, parseIsoDurationSeconds(m.contentDetails?.duration)])
            );
            for (const c of liveCands) c.durationSec = durById.get(c.youtubeVideoId) ?? null;
          } catch (err) {
            // Duration fetch failure ⇒ unknown durations ⇒ the gate probes
            // each id (fail-open on probe timeout) — never fails the job.
            log.warn(
              `pool-serve live videos.list failed (gate falls back to probe-only): ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }
        const before = passed.length;
        await gate(await dropShorts(applyDiversity(liveCands, passed)), passed);
        result.livePassed = passed.length - before;
      } catch (err) {
        // Live failure never fails the job — pool passes still insert.
        log.warn(
          `pool-serve live fallback failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // ── Insert (1차+2차 합산) via the shared auto-add chokepoint
    //    `placeAutoAddedCards` — CP500++ PR-2 (INV-CHOKEPOINT-ENFORCED). The
    //    gate score (relevancePct) is copied to uvs.relevance_pct; live
    //    candidates whose youtube_videos row is missing get a minimal create
    //    inside the primitive (same cache-hint behaviour). No view-gate / no
    //    notify here — pool-serve drives FE state via skill_runs, not SSE.
    const placed = await placeAutoAddedCards(
      prisma,
      p.userId,
      p.mandalaId,
      p.cellIndex,
      passed.map((cand) => ({
        videoId: cand.youtubeVideoId,
        title: cand.title,
        description: cand.description,
        thumbnail: cand.thumbnail,
        channelTitle: cand.channelTitle,
        durationSec: cand.durationSec ?? null,
        viewCount: null,
        publishedAt: cand.publishedAt,
        relevancePct: cand.relevancePct,
      }))
    );
    result.inserted += placed.inserted;
    // 3차: passed가 비면 아무것도 넣지 않는다 — 정직한 빈 셀.

    log.info(
      `pool-serve fill cell=${p.cellIndex} mandala=${p.mandalaId}: ` +
        `pool(recruited=${result.recruited} passed=${result.poolPassed}) ` +
        `live(attempted=${result.liveAttempted} recruited=${result.liveRecruited} passed=${result.livePassed}) ` +
        `scored=${result.scored} cacheHits=${result.cacheHits} inserted=${result.inserted} (need=${need})`
    );
  } finally {
    // Record the cell outcome on the batch run row (atomic jsonb concat —
    // concurrent cell jobs write disjoint keys). All cells reported ⇒
    // completed ⇒ FE fill-pending state clears.
    await recordCellOutcome(
      p.runId,
      p.cellIndex,
      result as unknown as Record<string, unknown>
    ).catch((err) =>
      log.warn(
        `pool-serve run record failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
      )
    );

    // Observability Phase 1 — flush the pool-serve trail log (fire-and-forget,
    // no-op when SEARCH_TRACE_ENABLED is off). quota_units = live-fallback
    // search.list + videos.list; pool recruitment itself is quota-free.
    if (traceOn) {
      writeSearchTrace(
        {
          traceId: p.runId,
          mandalaId: p.mandalaId,
          userId: p.userId,
          trigger: 'pool_serve',
          finishedAt: new Date(),
          quotaUnits: (result.liveAttempted ? SEARCH_LIST_UNITS : 0) + liveVideosUnits,
          counts: {
            recruited: result.recruited,
            scored: result.scored,
            cache_hits: result.cacheHits,
            pool_passed: result.poolPassed,
            live_recruited: result.liveRecruited,
            live_passed: result.livePassed,
            shorts_dropped: result.shortsDropped,
            inserted: result.inserted,
          },
          outcome: { cards_count: result.inserted },
          algorithmVersion: null,
        },
        traceRows
      );
    }
  }
}

async function recordCellOutcome(
  runId: string,
  cellIndex: number,
  outcome: Record<string, unknown>
): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.$executeRaw`
    UPDATE skill_runs
    SET output = COALESCE(output, '{}'::jsonb) ||
        jsonb_build_object(${String(cellIndex)}::text, ${JSON.stringify(outcome)}::jsonb)
    WHERE id = ${runId}::uuid`;
  // Mark completed when every dispatched cell has reported.
  await prisma.$executeRaw`
    UPDATE skill_runs
    SET status = 'completed', ended_at = now()
    WHERE id = ${runId}::uuid AND status = 'running'
      AND (SELECT count(*) FROM jsonb_object_keys(COALESCE(output, '{}'::jsonb))) >=
          COALESCE(jsonb_array_length(input -> 'cells'), 0)`;
}

export interface DispatchPoolServeInput {
  userId: string;
  mandalaId: string;
  centerGoal: string;
  language: 'ko' | 'en';
  /** Per-cell goal + recruitment query for DEFICIT cells only. */
  cells: { cellIndex: number; cellGoal: string; cellQuery: string; deficit: number }[];
}

/**
 * Create the skill_runs batch row (FE fill-pending signal) and enqueue one
 * job per deficit cell. Fire-and-forget at the call site — never blocks.
 * Returns the runId (null = disabled or nothing to do).
 */
export async function dispatchPoolServeFill(
  input: DispatchPoolServeInput,
  opts: { bypassFlag?: boolean } = {}
): Promise<string | null> {
  const cfg = loadPoolServeConfig();
  if ((!cfg.enabled && !opts.bypassFlag) || input.cells.length === 0) return null;
  const prisma = getPrismaClient();
  const run = await prisma.skill_runs.create({
    data: {
      skill_id: POOL_SERVE_SKILL_ID,
      user_id: input.userId,
      status: 'running',
      input: {
        mandalaId: input.mandalaId,
        cells: input.cells.map((c) => c.cellIndex),
      },
    },
    select: { id: true },
  });
  const boss = getJobQueue().getInstance();
  for (const cell of input.cells) {
    await boss.send(
      JOB_NAMES.POOL_SERVE_FILL,
      {
        userId: input.userId,
        mandalaId: input.mandalaId,
        cellIndex: cell.cellIndex,
        cellGoal: cell.cellGoal,
        centerGoal: input.centerGoal,
        language: input.language,
        cellQuery: cell.cellQuery,
        deficit: cell.deficit,
        runId: run.id,
      } satisfies PoolServeFillPayload,
      POOL_SERVE_FILL_RETRY_OPTIONS
    );
  }
  log.info(
    `pool-serve dispatched: mandala=${input.mandalaId} cells=[${input.cells
      .map((c) => c.cellIndex)
      .join(',')}] run=${run.id}`
  );
  return run.id;
}

/**
 * Mandala-level dispatcher: detect deficit cells (placed < minPerCell) and
 * enqueue one fill job per cell. Cell goals come from user_mandala_levels
 * (authoritative — the mandala is saved before this runs); the recruitment
 * query is the cell-goal text (tsvector tokens; the semantic judge owns
 * quality, recruitment only needs recall). Returns runId or null.
 */
export async function dispatchPoolServeForMandala(
  userId: string,
  mandalaId: string,
  opts: { bypassFlag?: boolean } = {}
): Promise<{ runId: string | null; deficitCells: number[] }> {
  const cfg = loadPoolServeConfig();
  if (!cfg.enabled && !opts.bypassFlag) return { runId: null, deficitCells: [] };
  const prisma = getPrismaClient();

  const mandala = await prisma.user_mandalas.findFirst({
    where: { id: mandalaId, user_id: userId },
    select: { language: true },
  });
  if (!mandala) return { runId: null, deficitCells: [] };
  const language: 'ko' | 'en' = mandala.language === 'en' ? 'en' : 'ko';

  const levels = await prisma.user_mandala_levels.findMany({
    where: { mandala_id: mandalaId, depth: 1 },
    select: { position: true, center_goal: true },
    orderBy: { position: 'asc' },
  });
  const root = await prisma.user_mandala_levels.findFirst({
    where: { mandala_id: mandalaId, depth: 0 },
    select: { center_goal: true },
  });
  if (!root || levels.length === 0) return { runId: null, deficitCells: [] };

  const counts = await prisma.$queryRaw<{ cell_index: number; n: number }[]>`
    SELECT cell_index, COUNT(*)::int AS n FROM user_video_states
    WHERE mandala_id = ${mandalaId}::uuid AND user_id = ${userId}::uuid
      AND cell_index >= 0
    GROUP BY cell_index`;
  const byCell = new Map(counts.map((c) => [c.cell_index, c.n]));

  const cells = levels
    .map((l) => {
      const placed = byCell.get(l.position) ?? 0;
      const deficit = cfg.minPerCell - placed;
      if (deficit <= 0 || !l.center_goal.trim()) return null;
      return {
        cellIndex: l.position,
        cellGoal: l.center_goal,
        cellQuery: l.center_goal,
        deficit,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  const runId = await dispatchPoolServeFill(
    {
      userId,
      mandalaId,
      centerGoal: root.center_goal,
      language,
      cells,
    },
    opts
  );
  return { runId, deficitCells: cells.map((c) => c.cellIndex) };
}
