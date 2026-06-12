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
import { tsvectorKeywordCandidatesPerCell } from '@/skills/plugins/video-discover/v3/hybrid-rerank';
import {
  resolveSearchApiKeys,
  searchVideos,
  titleHitsBlocklist,
  titleIndicatesShorts,
} from '@/skills/plugins/video-discover/v2/youtube-client';
import { isOffLanguageTitleToggled } from '@/skills/plugins/video-discover/v5/youtube-fanout';
import { dedupeSeries, softChannelCap } from '@/skills/plugins/video-discover/diversity-guard';
import { loadDiversityGuardConfig } from '@/config/diversity-guard';
import { logger } from '@/utils/logger';
import { getJobQueue } from '../manager';
import { JOB_NAMES, POOL_SERVE_FILL_RETRY_OPTIONS, type PoolServeFillPayload } from '../types';
import { richSummaryWorkOptions } from './rich-summary-work-options';

const log = logger.child({ module: 'pool-serve-fill' });

const ROOT_LEVEL_ID = 'root';
/** Candidates scored concurrently (OpenRouter key shared — bursts of 4, CP499). */
const SCORE_BURST_SIZE = 4;
/** Live fallback fetch size — one search.list call, gated downstream. */
const LIVE_FALLBACK_MAX_RESULTS = 10;
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
}

interface PassedCandidate extends GateCandidate {
  relevancePct: number;
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
  };

  try {
    const need = Math.min(p.deficit, cfg.maxFillPerCell);
    const rubric = loadRelevanceRubricConfig().enabled;
    const volatility = rubric ? await fetchVolatility(p.mandalaId) : null;

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

    /** Semantic gate: vmr cache first, score on miss, threshold; early-exit. */
    const gate = async (cands: GateCandidate[], passed: PassedCandidate[]): Promise<void> => {
      for (let i = 0; i < cands.length && passed.length < need; i += SCORE_BURST_SIZE) {
        const burst = cands.slice(i, i + SCORE_BURST_SIZE);
        const scores = await Promise.all(
          burst.map(async (c) => {
            const cached = await prisma.$queryRaw<{ relevance_pct: number }[]>`
              SELECT relevance_pct FROM video_mandala_relevance
              WHERE video_id = ${c.youtubeVideoId} AND mandala_id = ${p.mandalaId}::uuid`;
            if (cached[0]) {
              result.cacheHits += 1;
              return { c, pct: cached[0].relevance_pct };
            }
            const r = await computeCardRelevance({
              title: c.title,
              description: c.description ?? '',
              centerGoal: p.centerGoal,
              cellGoal: p.cellGoal,
              language: p.language,
              ...(rubric ? { rubric: true, publishedAt: c.publishedAt, volatility } : {}),
            });
            result.scored += 1;
            if (!r.ok) {
              log.warn(`pool-serve gate score failed (skip): ${r.reason}`);
              return { c, pct: null };
            }
            await prisma.$executeRaw`
              INSERT INTO video_mandala_relevance (video_id, mandala_id, relevance_pct)
              VALUES (${c.youtubeVideoId}, ${p.mandalaId}::uuid, ${r.relevancePct})
              ON CONFLICT (video_id, mandala_id)
              DO UPDATE SET relevance_pct = EXCLUDED.relevance_pct, relevance_at = now()`;
            return { c, pct: r.relevancePct };
          })
        );
        for (const { c, pct } of scores) {
          if (pct !== null && pct >= cfg.relevanceMin && passed.length < need) {
            passed.push({ ...c, relevancePct: pct });
            seen.add(c.youtubeVideoId);
          }
        }
      }
    };

    // ── 1차 POOL ──────────────────────────────────────────────────────────
    const recruits = await tsvectorKeywordCandidatesPerCell(
      [{ cellIndex: p.cellIndex, query: p.cellQuery }],
      [...seen],
      cfg.candidatesLimit,
      ['v2_promoted']
    );
    result.recruited = recruits.length;
    const passed: PassedCandidate[] = [];
    await gate(
      applyDiversity(
        hygienic(
          recruits.map((c) => ({
            youtubeVideoId: c.videoId,
            title: c.title,
            description: c.description,
            channelTitle: c.channelName,
            thumbnail: c.thumbnail,
            publishedAt: c.publishedAt,
          }))
        ),
        []
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
          }))
        );
        result.liveRecruited = liveCands.length;
        const before = passed.length;
        await gate(applyDiversity(liveCands, passed), passed);
        result.livePassed = passed.length - before;
      } catch (err) {
        // Live failure never fails the job — pool passes still insert.
        log.warn(
          `pool-serve live fallback failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // ── Insert (1차+2차 합산) — auto-add 파이프라인과 동일 shape; 게이트
    //    점수를 행에 복사 (재채점 0콜). live 후보는 youtube_videos 행이 없을
    //    수 있어 minimal upsert 로 보강 (정상 파이프라인의 cache-hint 동작).
    for (const cand of passed) {
      let yv = await prisma.youtube_videos.findUnique({
        where: { youtube_video_id: cand.youtubeVideoId },
        select: { id: true },
      });
      if (!yv) {
        yv = await prisma.youtube_videos.create({
          data: {
            youtube_video_id: cand.youtubeVideoId,
            title: cand.title,
            description: cand.description,
            thumbnail_url: cand.thumbnail,
            channel_title: cand.channelTitle,
            published_at: cand.publishedAt,
          },
          select: { id: true },
        });
      }
      const created = await prisma.userVideoState.createMany({
        data: [
          {
            user_id: p.userId,
            videoId: yv.id,
            mandala_id: p.mandalaId,
            cell_index: p.cellIndex,
            level_id: ROOT_LEVEL_ID,
            is_in_ideation: false,
            auto_added: true,
            relevance_pct: cand.relevancePct,
            relevance_at: new Date(),
          },
        ],
        skipDuplicates: true,
      });
      result.inserted += created.count;
    }
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
  }
}

async function fetchVolatility(mandalaId: string): Promise<string | null> {
  const prisma = getPrismaClient();
  try {
    const rows = await prisma.$queryRaw<{ volatility: string | null }[]>`
      SELECT volatility FROM user_mandalas WHERE id = ${mandalaId}::uuid`;
    return rows[0]?.volatility ?? null;
  } catch {
    return null; // fail-open — recency bonus simply stays 0
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
