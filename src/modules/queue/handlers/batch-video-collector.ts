/**
 * Batch Video Collector — fire-and-forget worker.
 *
 * CP489+ (2026-05-29): the GHA workflow used to await the skill via a
 * sync HTTP POST. After PR #782 raised the daily keyword limit 60 → 200
 * the executor runtime crossed prod nginx's 180s proxy_read_timeout,
 * surfacing as a 504 every scheduled run. Moving the skill behind
 * pg-boss decouples skill duration from HTTP timeouts and lets the
 * trigger route ACK in milliseconds.
 *
 * Job flow:
 *   GHA POST  → route enqueues `batch-video-collector-run`
 *           → this handler invokes `skillRegistry.execute('batch-video-collector', …)`
 *           → executor writes `video_pool_collection_runs` rows as usual.
 */

import PgBoss from 'pg-boss';
import { skillRegistry } from '@/modules/skills/registry';
import { createGenerationProvider } from '@/modules/llm';
import { getInternalUserId } from '@/config/internal-auth';
import { logger } from '@/utils/logger';
import { getJobQueue } from '../manager';
import {
  JOB_NAMES,
  BATCH_VIDEO_COLLECTOR_RUN_OPTIONS,
  type BatchVideoCollectorRunPayload,
} from '../types';

const log = logger.child({ module: 'queue/batch-video-collector' });

const SKILL_ID = 'batch-video-collector';

/** Concurrency = 1: never let two collector runs overlap. */
const WORKER_CONCURRENCY = 1;

/**
 * Register the batch-video-collector worker with pg-boss.
 * Called by initJobQueue() during server startup.
 */
export async function registerBatchVideoCollectorWorker(): Promise<void> {
  const boss = getJobQueue().getInstance();

  await boss.work<BatchVideoCollectorRunPayload>(
    JOB_NAMES.BATCH_VIDEO_COLLECTOR_RUN,
    { teamConcurrency: WORKER_CONCURRENCY, teamSize: 1 },
    handleBatchVideoCollectorRun
  );

  log.info('batch-video-collector worker registered', {
    concurrency: WORKER_CONCURRENCY,
  });
}

/**
 * Handle a single batch-video-collector run.
 *
 * Note: `limit` / `runType` from the payload are advisory — the executor
 * reads `BATCH_COLLECTOR_DAILY_KEYWORD_LIMIT` and `BATCH_COLLECTOR_RUN_TYPE`
 * from env, matching the pre-CP489+ sync behaviour. Body fields are kept
 * on the payload for future explicit-override wiring and forensic logging.
 */
async function handleBatchVideoCollectorRun(
  job: PgBoss.Job<BatchVideoCollectorRunPayload>
): Promise<void> {
  const startedAt = Date.now();
  const { limit, runType, trigger } = job.data ?? {};

  log.info('batch-video-collector: starting', {
    jobId: job.id,
    limit: limit ?? null,
    runType: runType ?? null,
    trigger: trigger ?? null,
  });

  const userId = getInternalUserId();
  const llm = await createGenerationProvider();

  try {
    const result = await skillRegistry.execute(SKILL_ID, {
      userId,
      // batch-video-collector is mandala-agnostic; SkillContext requires
      // a mandalaId string — pass an empty placeholder. The executor's
      // preflight does not read mandalaId.
      mandalaId: '',
      tier: 'admin',
      llm,
    });

    log.info('batch-video-collector: completed', {
      jobId: job.id,
      success: result.success,
      durationMs: Date.now() - startedAt,
    });

    if (!result.success) {
      // pg-boss treats a thrown error as failure for retry/archival
      // accounting. retryLimit=0 means the job is archived as failed —
      // the daily watchdog + next cron tick are the recovery path.
      throw new Error(`skill returned success=false: ${JSON.stringify(result)}`);
    }
  } catch (err) {
    log.error('batch-video-collector: failed', {
      jobId: job.id,
      durationMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Enqueue a single batch-video-collector run.
 * Returns the pg-boss job id (string) or null if the queue rejected the send.
 */
export async function enqueueBatchVideoCollectorRun(
  payload: BatchVideoCollectorRunPayload = {},
  options?: PgBoss.SendOptions
): Promise<string | null> {
  const boss = getJobQueue().getInstance();

  return boss.send(JOB_NAMES.BATCH_VIDEO_COLLECTOR_RUN, payload, {
    ...BATCH_VIDEO_COLLECTOR_RUN_OPTIONS,
    ...options,
  });
}
