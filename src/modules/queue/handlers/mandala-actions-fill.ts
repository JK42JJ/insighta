/**
 * Mandala actions fill — guaranteed worker (W1', CP499+).
 *
 * Replaces the in-memory fire-and-forget IIFE in mandala-post-creation: that
 * attempt died with the process (deploy restarts!) and never retried after
 * its single inline failure — a mandala could stay permanently actions-less,
 * violating the absolute rule "missing actions ⇒ LLM-generate and store".
 *
 * pg-boss gives: persistence across restarts + 3 backoff retries
 * (MANDALA_ACTIONS_FILL_OPTIONS). The worker delegates to
 * fillMissingActionsIfNeeded, which is idempotent ('skipped-full' when a
 * concurrent/SSE path already filled the cells) — re-runs are free.
 *
 * The wizard-stream SSE actions path (mandalas.ts wizard-stream) is NOT
 * touched: it remains the fast UX lane; this job is the durability lane.
 */

import PgBoss from 'pg-boss';
import { logger } from '@/utils/logger';
import { getJobQueue } from '../manager';
import { JOB_NAMES, MANDALA_ACTIONS_FILL_OPTIONS, type MandalaActionsFillPayload } from '../types';

const log = logger.child({ module: 'queue/mandala-actions-fill' });

// One mandala-create at a time produces one job; low volume, serial is fine.
// Explicit teamSize per the CP498 pg-boss trap (teamConcurrency alone is inert).
const WORKER_TEAM = { teamConcurrency: 1, teamSize: 1 } as const;

export async function registerMandalaActionsFillWorker(): Promise<void> {
  const boss = getJobQueue().getInstance();
  await boss.work<MandalaActionsFillPayload>(
    JOB_NAMES.MANDALA_ACTIONS_FILL,
    WORKER_TEAM,
    handleMandalaActionsFill
  );
  log.info('mandala-actions-fill worker registered');
}

export async function handleMandalaActionsFill(
  job: PgBoss.Job<MandalaActionsFillPayload>
): Promise<void> {
  const startedAt = Date.now();
  const { mandalaId, trigger } = job.data ?? {};
  if (!mandalaId) {
    // Malformed payload — retrying cannot fix it; complete without throwing.
    log.warn('mandala-actions-fill: missing mandalaId, dropping', { jobId: job.id });
    return;
  }

  // Lazy import keeps narrow test module graphs (and the queue boot path)
  // free of the generator/OpenRouter imports — same convention as the old
  // inline call site in mandala-post-creation.
  const { fillMissingActionsIfNeeded } = await import('@/modules/mandala/fill-missing-actions');
  const result = await fillMissingActionsIfNeeded(mandalaId);

  if (!result.ok && result.action === 'failed') {
    // Throw → pg-boss retry (3× backoff). This is the guarantee the old
    // fire-and-forget lacked.
    log.warn('mandala-actions-fill: fill failed, will retry', {
      jobId: job.id,
      mandalaId,
      reason: result.reason,
      durationMs: Date.now() - startedAt,
    });
    throw new Error(`actions fill failed for ${mandalaId}: ${result.reason ?? 'unknown'}`);
  }

  log.info('mandala-actions-fill: completed', {
    jobId: job.id,
    mandalaId,
    trigger,
    action: result.action,
    cellsFilled: result.cellsFilled ?? 0,
    durationMs: Date.now() - startedAt,
  });
}

/** Enqueue a guaranteed actions fill. Returns the pg-boss job id or null. */
export async function enqueueMandalaActionsFill(
  payload: MandalaActionsFillPayload,
  options?: PgBoss.SendOptions
): Promise<string | null> {
  const boss = getJobQueue().getInstance();
  return boss.send(JOB_NAMES.MANDALA_ACTIONS_FILL, payload, {
    ...MANDALA_ACTIONS_FILL_OPTIONS,
    ...options,
  });
}
