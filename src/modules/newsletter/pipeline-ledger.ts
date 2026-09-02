/**
 * The newsletter pipeline's ledger.
 *
 * Issue 1 printed "2,714 videos harvested, 1,042 reviewed" on the page and
 * cited Insighta's own count as the source. That count came from a script that
 * was never committed, and nothing recorded its result — so the figure on a
 * page selling graded sourcing was the one figure nobody could check.
 *
 * Every stage records here. The rule the rest of the pipeline is built on:
 *
 *   A stage that ends without a step row did not happen.
 *   A number that cannot be read back out of these rows does not go on a page.
 *
 * That is why `recordStep` refuses arithmetic it cannot justify: a drop count
 * whose reasons do not add up is a claim without evidence, which is the exact
 * shape of the failure this module exists to prevent.
 */

import { getPrismaClient } from '@/modules/database/client';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'newsletter/pipeline-ledger' });

/**
 * The eight stages of the brief pipeline, in order.
 *
 * S0 harvest   collect wide — narrowing here cannot be undone later
 * S1 format    shorts, too short, duplicates. Mechanical, no model
 * S2 domain    topic boundary, applied at intake rather than after
 * S3 judge     safe / learnable / practitioner-relevant
 * S4 deep      transcript to summary for the survivors. The expensive one
 * S5 cross     one channel is a claim, independent channels are an event
 * S6 stats     the shape of what was dropped, which is itself the article
 * S7 draft     a person writes; the machine hands over evidence, not prose
 */
export const PIPELINE_STAGES = [
  'S0_harvest',
  'S1_format',
  'S2_domain',
  'S3_judge',
  'S4_deep',
  'S5_cross',
  'S6_stats',
  'S7_draft',
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export interface StepRecord {
  runId: string;
  stage: PipelineStage;
  itemsIn: number;
  itemsOut: number;
  /** Reason -> count. Must account for every dropped item. */
  dropReasons?: Record<string, number>;
  quotaUnits?: number;
  costUsd?: number;
  durationMs?: number;
  /** Queries used, channels read, surviving ids — anything that is not a count. */
  detail?: Record<string, unknown>;
}

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

/**
 * Open a run. The topic definition is copied in rather than referenced: the
 * file changes between weeks, and a finished run has to keep saying what it
 * actually did rather than what the current definition says it would do.
 */
export async function startRun(input: {
  categoryKey: string;
  weekOf: Date;
  topicSnapshot: Record<string, unknown>;
  createdBy?: string;
}): Promise<string> {
  const row = await getPrismaClient().newsletter_pipeline_runs.create({
    data: {
      category_key: input.categoryKey,
      week_of: input.weekOf,
      topic_snapshot: input.topicSnapshot as never,
      created_by: input.createdBy ?? null,
    },
    select: { id: true },
  });
  log.info('pipeline run started', {
    runId: row.id,
    category: input.categoryKey,
    weekOf: input.weekOf.toISOString().slice(0, 10),
  });
  return row.id;
}

/**
 * Record one stage.
 *
 * Throws rather than warns on inconsistent arithmetic. A ledger that accepts
 * numbers it cannot justify is worse than no ledger: it looks like evidence.
 *
 * The unique index on (run_id, stage) makes a second write for the same stage
 * an error too — a stage reporting twice is a bug, not two stages.
 */
export async function recordStep(step: StepRecord): Promise<void> {
  if (step.itemsIn < 0 || step.itemsOut < 0) {
    throw new LedgerError(`${step.stage}: counts cannot be negative`);
  }
  if (step.itemsOut > step.itemsIn) {
    throw new LedgerError(
      `${step.stage}: passed on ${step.itemsOut} of ${step.itemsIn} — a stage cannot emit more than it received`
    );
  }

  const dropped = step.itemsIn - step.itemsOut;
  const reasons = step.dropReasons ?? {};
  const accounted = Object.values(reasons).reduce((sum, n) => sum + n, 0);
  if (accounted !== dropped) {
    throw new LedgerError(
      `${step.stage}: dropped ${dropped} but reasons account for ${accounted}` +
        ` (${JSON.stringify(reasons)}) — every dropped item needs a reason`
    );
  }

  await getPrismaClient().newsletter_pipeline_steps.create({
    data: {
      run_id: step.runId,
      stage: step.stage,
      items_in: step.itemsIn,
      items_out: step.itemsOut,
      drop_reasons: reasons as never,
      quota_units: step.quotaUnits ?? 0,
      cost_usd: step.costUsd ?? null,
      duration_ms: step.durationMs ?? null,
      detail: (step.detail ?? undefined) as never,
    },
  });

  log.info('pipeline step recorded', {
    runId: step.runId,
    stage: step.stage,
    in: step.itemsIn,
    out: step.itemsOut,
    dropped,
  });
}

/**
 * Close a run and total the quota its stages spent.
 *
 * A run is only `complete` when every stage from S0 to the one named as last
 * has a row. Marking a run complete over a gap would let the next issue quote
 * a funnel with a hole in it.
 */
export async function finishRun(
  runId: string,
  outcome: {
    status: 'complete' | 'failed' | 'abandoned';
    error?: string;
    throughStage?: PipelineStage;
  }
): Promise<void> {
  const prisma = getPrismaClient();
  const steps = await prisma.newsletter_pipeline_steps.findMany({
    where: { run_id: runId },
    select: { stage: true, quota_units: true },
  });

  if (outcome.status === 'complete') {
    const last = outcome.throughStage ?? 'S7_draft';
    const required = PIPELINE_STAGES.slice(0, PIPELINE_STAGES.indexOf(last) + 1);
    const present = new Set(steps.map((s) => s.stage));
    const missing = required.filter((s) => !present.has(s));
    if (missing.length > 0) {
      throw new LedgerError(`run ${runId} cannot be complete: no rows for ${missing.join(', ')}`);
    }
  }

  await prisma.newsletter_pipeline_runs.update({
    where: { id: runId },
    data: {
      status: outcome.status,
      ended_at: new Date(),
      error: outcome.error ?? null,
      quota_units: steps.reduce((sum, s) => sum + s.quota_units, 0),
    },
  });
  log.info('pipeline run finished', { runId, status: outcome.status });
}

export interface FunnelStage {
  stage: PipelineStage;
  itemsIn: number;
  itemsOut: number;
  dropReasons: Record<string, number>;
}

/**
 * The funnel, read back out of the ledger.
 *
 * This is the only source for the figures a brief prints about its own
 * process. If a number is not here, it does not go on the page.
 */
export async function readFunnel(runId: string): Promise<{
  quotaUnits: number;
  stages: FunnelStage[];
}> {
  const prisma = getPrismaClient();
  const [run, steps] = await Promise.all([
    prisma.newsletter_pipeline_runs.findUnique({
      where: { id: runId },
      select: { id: true },
    }),
    prisma.newsletter_pipeline_steps.findMany({ where: { run_id: runId } }),
  ]);
  if (!run) throw new LedgerError(`run ${runId} not found`);

  const order = new Map(PIPELINE_STAGES.map((s, i) => [s as string, i]));
  const stages = steps
    .sort((a, b) => (order.get(a.stage) ?? 99) - (order.get(b.stage) ?? 99))
    .map((s) => ({
      stage: s.stage as PipelineStage,
      itemsIn: s.items_in,
      itemsOut: s.items_out,
      dropReasons: (s.drop_reasons ?? {}) as Record<string, number>,
    }));

  // Summed from the steps, not read from the run row. `finishRun` writes that
  // total when a run ends, and S6 reads the funnel while the run is still
  // going — so the first version of this reported 0 quota units for a run that
  // had spent 4,039, and the page would have printed the zero.
  return { quotaUnits: steps.reduce((sum, s) => sum + s.quota_units, 0), stages };
}
