/**
 * Mandala book-fill worker (§2-D #1).
 *
 * Durable lane for assembling a mandala's book_json from its placed videos' v2
 * rich summaries. The assembly is LLM-free (build-book.ts is pure string
 * concat); this worker just provides persistence + retries so a triggered fill
 * survives restarts and transient DB errors.
 *
 * Concurrency via richSummaryWorkOptions(N) — teamSize:N + teamRefill so the
 * configured concurrency is NOT inert (CP498 teamSize:1 serial trap).
 */

import PgBoss from 'pg-boss';
import { logger } from '@/utils/logger';
import { getJobQueue } from '../manager';
import { JOB_NAMES, MANDALA_BOOK_FILL_OPTIONS, type MandalaBookFillPayload } from '../types';
import { richSummaryWorkOptions } from './rich-summary-work-options';

const log = logger.child({ module: 'queue/mandala-book-fill' });

// Low volume (one job per manual trigger), but use the trap-proof option shape
// so raising this later actually parallelizes. Named constant — no magic number.
const BOOK_FILL_CONCURRENCY = 2;

export async function registerMandalaBookFillWorker(): Promise<void> {
  const boss = getJobQueue().getInstance();
  await boss.work<MandalaBookFillPayload>(
    JOB_NAMES.MANDALA_BOOK_FILL,
    richSummaryWorkOptions(BOOK_FILL_CONCURRENCY),
    handleMandalaBookFill
  );
  log.info('mandala-book-fill worker registered', { concurrency: BOOK_FILL_CONCURRENCY });
}

export async function handleMandalaBookFill(
  job: PgBoss.Job<MandalaBookFillPayload>
): Promise<void> {
  const { userId, mandalaId, trigger } = job.data ?? ({} as MandalaBookFillPayload);
  if (!userId || !mandalaId) {
    // Malformed payload — retrying cannot fix it; complete without throwing.
    log.warn('mandala-book-fill: missing userId/mandalaId, dropping', { jobId: job.id });
    return;
  }

  // Lazy import keeps the queue boot path free of the assembler import chain.
  const { fillMandalaBook } = await import('@/modules/mandala-book/fill-book');
  const result = await fillMandalaBook({ userId, mandalaId, trigger });

  if (!result.ok && result.action === 'failed') {
    // Throw → pg-boss retry (3× backoff). 'skipped-*' results are terminal (a
    // mandala with no videos is not an error), so only 'failed' retries.
    log.warn('mandala-book-fill: fill failed, will retry', { jobId: job.id, mandalaId });
    throw new Error(`mandala-book-fill failed for ${mandalaId}: ${result.reason ?? 'unknown'}`);
  }

  log.info('mandala-book-fill done', { jobId: job.id, ...result });
}

/** Enqueue a book-fill job for one mandala. Returns the pg-boss job id (or null). */
export async function enqueueMandalaBookFill(
  payload: MandalaBookFillPayload,
  options?: PgBoss.SendOptions
): Promise<string | null> {
  const boss = getJobQueue().getInstance();
  return boss.send(JOB_NAMES.MANDALA_BOOK_FILL, payload, {
    ...MANDALA_BOOK_FILL_OPTIONS,
    ...options,
  });
}
