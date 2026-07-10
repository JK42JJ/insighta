/**
 * Mandala post-creation VIDEO pipeline — durable worker (P0, 2026-07-10).
 *
 * Replaces the fire-and-forget `setImmediate` pipeline in
 * mandala-post-creation: that in-process promise died with the process on any
 * container restart (deploy/redeploy/crash). A restart mid-run left the
 * mandala at 0 cards, the run stuck at status=running, with no retry — the
 * same failure class `mandala-actions-fill` was moved to pg-boss to close, but
 * the video pipeline was left behind (P0 incident: restart 12s into a run →
 * orphaned run → 0 cards).
 *
 * pg-boss gives: persistence across restarts (redelivery) + 2 backoff retries
 * (MANDALA_PIPELINE_OPTIONS). A `singletonKey` per mandala dedups concurrent
 * enqueues (create + watchdog). The watchdog re-enqueues runs orphaned by a
 * restart that happened between job pickup and completion.
 *
 * Gated by PIPELINE_DURABLE_ENABLED — the enqueue site (mandala-post-creation)
 * only routes here when the flag is on; the worker + watchdog are always
 * registered but the watchdog no-ops when the flag is off (legacy behavior).
 */

import PgBoss from 'pg-boss';
import { logger } from '@/utils/logger';
import { getPrismaClient } from '@/modules/database/client';
import { isPipelineDurableEnabled } from '@/config/pipeline-durable';
import { getJobQueue } from '../manager';
import {
  JOB_NAMES,
  QUEUE_CONFIG,
  MANDALA_PIPELINE_OPTIONS,
  type MandalaPipelinePayload,
} from '../types';

const log = logger.child({ module: 'queue/mandala-pipeline' });

// The pipeline is heavy (embeddings on Mac Mini + discover + Haiku, ~55s).
// Keep concurrency low so a burst of mandala creates cannot overload the
// single embedding host. Explicit teamSize per the pg-boss trap (CP498).
const WORKER_TEAM = { teamConcurrency: 2, teamSize: 2 } as const;

/** pg-boss job id or null; singletonKey dedups per mandala. */
export async function enqueueMandalaPipeline(
  payload: MandalaPipelinePayload,
  options?: PgBoss.SendOptions
): Promise<string | null> {
  const boss = getJobQueue().getInstance();
  return boss.send(JOB_NAMES.MANDALA_PIPELINE, payload, {
    ...MANDALA_PIPELINE_OPTIONS,
    singletonKey: `mandala-pipeline-${payload.mandalaId}`,
    ...options,
  });
}

export async function handleMandalaPipeline(
  job: PgBoss.Job<MandalaPipelinePayload>
): Promise<void> {
  const startedAt = Date.now();
  const { mandalaId, userId, trigger } = job.data ?? {};
  if (!mandalaId || !userId) {
    // Malformed payload — retrying cannot fix it; complete without throwing.
    log.warn('mandala-pipeline: missing mandalaId/userId, dropping', { jobId: job.id });
    return;
  }

  // Lazy import keeps the queue boot path free of the discover/OpenRouter
  // import graph — same convention as the old inline call site.
  const { createPipelineRun, executePipelineRun } =
    await import('@/modules/mandala/pipeline-runner');

  const runId = await createPipelineRun(mandalaId, userId, trigger ?? 'wizard');
  log.info('mandala-pipeline: run created', { jobId: job.id, runId, mandalaId, trigger });

  try {
    await executePipelineRun(runId);
  } catch (err) {
    // Throw → pg-boss retry (2× backoff). This is the guarantee the old
    // fire-and-forget lacked.
    log.warn('mandala-pipeline: run failed, will retry', {
      jobId: job.id,
      runId,
      mandalaId,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    });
    throw err instanceof Error ? err : new Error(String(err));
  }

  log.info('mandala-pipeline: completed', {
    jobId: job.id,
    runId,
    mandalaId,
    durationMs: Date.now() - startedAt,
  });
}

/**
 * Watchdog — re-enqueue pipeline runs stuck at status=running past the stale
 * window (orphaned by a restart between pickup and completion, or legacy
 * setImmediate runs from before the flag was on). No-op when the durable flag
 * is off so flag-off === exact legacy behavior.
 */
export async function handleMandalaPipelineWatchdog(): Promise<void> {
  if (!isPipelineDurableEnabled()) {
    log.info('mandala-pipeline-watchdog: durable mode off — skipping');
    return;
  }
  const prisma = getPrismaClient();
  const stale = await prisma.$queryRawUnsafe<
    Array<{ id: string; mandala_id: string; user_id: string; trigger: string | null }>
  >(
    `SELECT DISTINCT ON (mandala_id) id, mandala_id, user_id, trigger
       FROM mandala_pipeline_runs
      WHERE status = 'running'
        AND created_at < now() - ($1 || ' minutes')::interval
      ORDER BY mandala_id, created_at DESC`,
    String(QUEUE_CONFIG.MANDALA_PIPELINE_STALE_MINUTES)
  );

  if (stale.length === 0) return;

  // Runs we hand a fresh replacement job. Marking these 'superseded' below is
  // what closes the CP512-incident loop: a stale run left at status='running'
  // is re-found by every 10-min tick → re-enqueued forever (12 runs/hr
  // observed 2026-07-10). This keys purely on status+age, so it also
  // terminates pre-flag-on fire-and-forget orphans that never had a pg-boss
  // job (e.g. the run stuck at step1 since before the durable flag was on).
  let reEnqueued = 0;
  const supersededIds: string[] = [];
  for (const r of stale) {
    try {
      const jobId = await enqueueMandalaPipeline({
        mandalaId: r.mandala_id,
        userId: r.user_id,
        trigger: r.trigger ?? 'watchdog',
      });
      if (jobId) {
        reEnqueued++;
        supersededIds.push(r.id);
      }
    } catch (err) {
      log.warn('mandala-pipeline-watchdog: re-enqueue failed', {
        mandalaId: r.mandala_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Terminate the stale runs we replaced so the next tick can't re-enqueue
  // them again. Only runs that actually got a fresh job are superseded; a
  // freshly-created run (< stale window) is never in this set. Each stuck run
  // therefore gets exactly one watchdog retry, not an unbounded loop.
  let superseded = 0;
  if (supersededIds.length > 0) {
    const res = await prisma.mandala_pipeline_runs.updateMany({
      where: { id: { in: supersededIds }, status: 'running' },
      data: { status: 'superseded', updated_at: new Date() },
    });
    superseded = res.count;
  }

  log.info('mandala-pipeline-watchdog: re-enqueued orphaned runs', {
    stale: stale.length,
    reEnqueued,
    superseded,
  });
}

export async function registerMandalaPipelineWorker(): Promise<void> {
  const boss = getJobQueue().getInstance();
  await boss.work<MandalaPipelinePayload>(
    JOB_NAMES.MANDALA_PIPELINE,
    WORKER_TEAM,
    handleMandalaPipeline
  );
  await boss.work(JOB_NAMES.MANDALA_PIPELINE_WATCHDOG, handleMandalaPipelineWatchdog);
  await boss.schedule(
    JOB_NAMES.MANDALA_PIPELINE_WATCHDOG,
    QUEUE_CONFIG.MANDALA_PIPELINE_WATCHDOG_CRON
  );
  log.info('mandala-pipeline worker + watchdog registered');
}
