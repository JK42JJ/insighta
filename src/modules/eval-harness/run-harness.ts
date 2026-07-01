/**
 * Phase 3 Eval Harness runner (G2-b) — golden-cohort gc baseline.
 *
 * Scores the FIXED golden cohort (golden-cohort.ts) against its mandala center
 * goal to produce a gc (relevance) distribution, then upserts the headline into
 * today's search_metrics_daily row. This is the G3 before/after baseline.
 *
 * Governance (CLAUDE.md LLM ban):
 *   - The gc miss-scoring path calls computeCardRelevance = OpenRouter Haiku.
 *     That runs ONLY as a PROD runtime admin trigger (same class as the shipped
 *     relevance-backfill worker). CC/dev must NEVER run the Haiku path.
 *   - `cacheOnly: true` uses ONLY existing relevance_pct (no LLM call) — safe to
 *     run anywhere, and the way CC verifies the harness end-to-end.
 *
 * Cost control (Claude-web feedback):
 *   - Cache reuse first: a card with a stored relevance_pct is NOT re-scored.
 *   - Cache MISSES are scored up to `capPerMandala` per mandala (representative
 *     sample, not exhaustive). Misses beyond the cap are counted as unmeasured.
 *
 * Storage: PARTIAL upsert of gc_median / gc_pct_below_65 / coverage only — never
 * touches the fleet-rollup columns (2-B). `coverage.run_type='golden_cohort'`
 * tags the provenance so cohort vs fleet numbers never get confused.
 *
 * NOTE: the per-cell pool-cosine coverage (the metric that moves with the G3
 * embedding backfill) is a marked follow-up — `coverage.cosine_coverage=null`
 * here. This run delivers the gc baseline; cosine coverage lands next.
 */

import { Prisma } from '@prisma/client';

import { getPrismaClient } from '@/modules/database/client';
import { getMandalaManager } from '@/modules/mandala/manager';
import { computeCardRelevance } from '@/modules/relevance/compute-card-relevance';
import { logger } from '@/utils/logger';
import { GOLDEN_COHORT, GOLDEN_COHORT_IDS } from './golden-cohort';

const log = logger.child({ module: 'EvalHarness' });

const DEFAULT_CAP_PER_MANDALA = 30;
const GC_BELOW_THRESHOLD = 65;

export interface HarnessRunOptions {
  /** true ⇒ only existing relevance_pct used, ZERO Haiku calls (CC-safe verify). */
  cacheOnly?: boolean;
  /** Max cache-MISSES scored per mandala (cost bound). Default 30. */
  capPerMandala?: number;
}

export interface PerMandalaResult {
  mandalaId: string;
  title: string;
  cards: number;
  cacheHits: number;
  scored: number;
  unmeasured: number;
  gcMedian: number | null;
  gcPctBelow65: number | null;
  error?: string;
}

export interface HarnessResult {
  cacheOnly: boolean;
  capPerMandala: number;
  cohortSize: number;
  totalCards: number;
  cacheHits: number;
  scored: number;
  gcN: number;
  gcMedian: number | null;
  gcPctBelow65: number | null;
  perMandala: PerMandalaResult[];
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function pctBelow(xs: number[], threshold: number): number | null {
  if (xs.length === 0) return null;
  return +((xs.filter((x) => x < threshold).length / xs.length) * 100).toFixed(1);
}

function utcMidnightToday(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

interface LoadedCard {
  title: string;
  description?: string;
  cellIndex: number | null;
  cached: number | null;
}

/** Run the golden-cohort gc baseline and persist the headline. */
export async function runGoldenCohortHarness(opts: HarnessRunOptions = {}): Promise<HarnessResult> {
  const prisma = getPrismaClient();
  const cacheOnly = opts.cacheOnly ?? false;
  const capPerMandala = opts.capPerMandala ?? DEFAULT_CAP_PER_MANDALA;

  const allGc: number[] = [];
  const perMandala: PerMandalaResult[] = [];
  let totalCards = 0;
  let totalCacheHits = 0;
  let totalScored = 0;

  for (const entry of GOLDEN_COHORT) {
    const mandalaId = entry.mandalaId;
    const owner = await prisma.user_mandalas.findUnique({
      where: { id: mandalaId },
      select: { user_id: true, title: true },
    });
    if (!owner) {
      perMandala.push({
        mandalaId,
        title: entry.title,
        cards: 0,
        cacheHits: 0,
        scored: 0,
        unmeasured: 0,
        gcMedian: null,
        gcPctBelow65: null,
        error: 'mandala_not_found',
      });
      continue;
    }
    const userId = owner.user_id;

    let centerGoal = '';
    let cellGoals: string[] = [];
    try {
      const mandala = await getMandalaManager().getMandalaById(userId, mandalaId);
      centerGoal = mandala?.levels[0]?.centerGoal ?? '';
      cellGoals = mandala?.levels[0]?.subjects ?? [];
    } catch (err) {
      log.warn('mandala lookup failed', {
        mandalaId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const [uvs, ulc] = await Promise.all([
      prisma.userVideoState.findMany({
        where: { user_id: userId, mandala_id: mandalaId, cell_index: { gte: 0 } },
        select: { cell_index: true, relevance_pct: true, video: { select: { title: true } } },
      }),
      prisma.user_local_cards.findMany({
        where: { user_id: userId, mandala_id: mandalaId, cell_index: { gte: 0 } },
        select: {
          cell_index: true,
          relevance_pct: true,
          title: true,
          metadata_title: true,
          metadata_description: true,
        },
      }),
    ]);

    const cards: LoadedCard[] = [
      ...uvs.map((r) => ({
        title: r.video?.title ?? '',
        description: undefined,
        cellIndex: r.cell_index,
        cached: r.relevance_pct,
      })),
      ...ulc.map((r) => ({
        title: r.title ?? r.metadata_title ?? '',
        description: r.metadata_description ?? undefined,
        cellIndex: r.cell_index,
        cached: r.relevance_pct,
      })),
    ];

    const gc: number[] = [];
    let cacheHits = 0;
    let scored = 0;
    let unmeasured = 0;

    for (const c of cards) {
      if (c.cached != null) {
        gc.push(c.cached);
        cacheHits += 1;
        continue;
      }
      if (cacheOnly || scored >= capPerMandala || !c.title) {
        unmeasured += 1;
        continue;
      }
      // PROD-ONLY: OpenRouter Haiku. CC/dev never reaches here (cacheOnly=true).
      const r = await computeCardRelevance({
        title: c.title,
        description: c.description,
        centerGoal,
        cellGoal: c.cellIndex != null ? cellGoals[c.cellIndex] : undefined,
      });
      if (r.ok) {
        gc.push(r.relevancePct);
        scored += 1;
      } else {
        unmeasured += 1;
      }
    }

    totalCards += cards.length;
    totalCacheHits += cacheHits;
    totalScored += scored;
    allGc.push(...gc);
    perMandala.push({
      mandalaId,
      title: owner.title,
      cards: cards.length,
      cacheHits,
      scored,
      unmeasured,
      gcMedian: median(gc),
      gcPctBelow65: pctBelow(gc, GC_BELOW_THRESHOLD),
    });
  }

  const gcMedian = median(allGc);
  const gcPctBelow65 = pctBelow(allGc, GC_BELOW_THRESHOLD);

  const coverage = {
    run_type: 'golden_cohort',
    cache_only: cacheOnly,
    cap_per_mandala: capPerMandala,
    cohort_ids: [...GOLDEN_COHORT_IDS],
    total_cards: totalCards,
    cache_hits: totalCacheHits,
    scored: totalScored,
    gc_n: allGc.length,
    per_mandala: perMandala,
    cosine_coverage: null, // follow-up: per-cell pool-cosine coverage (G3 metric)
  } as unknown as Prisma.InputJsonValue;

  const metricDate = utcMidnightToday();
  // PARTIAL upsert — only gc + coverage. Fleet-rollup (2-B) columns untouched.
  await prisma.search_metrics_daily.upsert({
    where: { metric_date: metricDate },
    create: {
      metric_date: metricDate,
      gc_median: gcMedian,
      gc_pct_below_65: gcPctBelow65,
      coverage,
    },
    update: { gc_median: gcMedian, gc_pct_below_65: gcPctBelow65, coverage },
  });

  const result: HarnessResult = {
    cacheOnly,
    capPerMandala,
    cohortSize: GOLDEN_COHORT_IDS.length,
    totalCards,
    cacheHits: totalCacheHits,
    scored: totalScored,
    gcN: allGc.length,
    gcMedian,
    gcPctBelow65,
    perMandala,
  };
  log.info('golden-cohort harness run', {
    cacheOnly,
    gcMedian,
    gcN: allGc.length,
    scored: totalScored,
    cacheHits: totalCacheHits,
  });
  return result;
}
