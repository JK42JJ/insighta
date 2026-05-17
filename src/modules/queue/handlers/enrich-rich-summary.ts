/**
 * Enrich Rich Summary Job Handler — CP462+ Issue #649 Phase 2
 *
 * Heart-click on-demand rich summary generation. Calls enrichRichSummary()
 * DIRECTLY (NOT via enrichVideo wrapper) per handoff §4 to bypass the
 * cache-hit-skip behaviour in enrichVideo's gate.
 *
 * Job flow:
 *   POST /api/v1/cards/:videoId/like
 *     → INSERT card_interactions signal='like'
 *     → enqueueEnrichRichSummary({videoId, userId, mandalaId, title})
 *     → this handler picks up the job
 *     → enrichRichSummary() generates v2 row (cache hits short-circuit)
 *     → mandala_relevance_pct is populated by the v2 prompt update
 *       (Phase 2 step 3 — until then, the column stays NULL and the FE
 *       falls back to "Scored" phase with no score badge)
 *
 * The interactive Heart path uses RICH_SUMMARY_RETRY_OPTIONS (no retry,
 * 5-min expiry) — the user is actively waiting via SSE, so failures must
 * surface immediately rather than silent backoff.
 *
 * See:
 *   docs/runbook/card-preference-signal-handoff-2026-05-15.md
 *   src/modules/queue/types.ts (EnrichRichSummaryPayload, RICH_SUMMARY_RETRY_OPTIONS)
 *   src/modules/skills/rich-summary.ts (enrichRichSummary direct caller)
 */

import type PgBoss from 'pg-boss';

import { enrichRichSummary } from '../../skills/rich-summary';
import { logger } from '../../../utils/logger';
import { getJobQueue } from '../manager';
import {
  JOB_NAMES,
  QUEUE_CONFIG,
  RICH_SUMMARY_RETRY_OPTIONS,
  type EnrichRichSummaryPayload,
} from '../types';

/**
 * Register the enrich-rich-summary worker with pg-boss. Must be called
 * after JobQueue.start().
 */
export async function registerEnrichRichSummaryWorker(): Promise<void> {
  const boss = getJobQueue().getInstance();

  await boss.work<EnrichRichSummaryPayload>(
    JOB_NAMES.ENRICH_RICH_SUMMARY,
    { teamConcurrency: QUEUE_CONFIG.RICH_SUMMARY_CONCURRENCY, teamSize: 1 },
    handleEnrichRichSummary
  );

  logger.info('enrich-rich-summary worker registered', {
    concurrency: QUEUE_CONFIG.RICH_SUMMARY_CONCURRENCY,
  });
}

/**
 * Handle a single Heart-triggered enrich-rich-summary job.
 *
 * Throws on hard failure so pg-boss marks the job as failed (no retry per
 * RICH_SUMMARY_RETRY_OPTIONS); the FE Heart UI will show a Retry button
 * via the SSE failure event (Phase 2 step 6 — SSE endpoint).
 */
async function handleEnrichRichSummary(job: PgBoss.Job<EnrichRichSummaryPayload>): Promise<void> {
  const { videoId, userId, mandalaId, title, description } = job.data;

  logger.info('enrich-rich-summary: processing', {
    jobId: job.id,
    videoId,
    userId,
    mandalaId,
  });

  // Direct call — bypasses enrichVideo's cache-hit-skip path. enrichRichSummary
  // itself short-circuits when an existing v2 row has quality_flag='pass',
  // so this is still cheap on cache hits.
  // transcript / segments intentionally omitted at this step — the FE Heart
  // click does not yet provide them. Phase 2 step 6+ may add a transcript
  // fetch step inside the worker if the v2 quality on description-only is
  // insufficient.
  const result = await enrichRichSummary(videoId, {
    userId,
    title,
    description,
  });

  logger.info('enrich-rich-summary: completed', {
    jobId: job.id,
    videoId,
    qualityFlag: result.qualityFlag,
    qualityScore: result.qualityScore,
  });
}

/**
 * Enqueue a single Heart-triggered rich-summary job. Returns the pg-boss
 * job id (or null when the queue is unavailable). Callers should ignore
 * a null return — the Heart UI will still record the signal and the FE
 * can present a "queue unavailable" indicator if needed.
 */
export async function enqueueEnrichRichSummary(
  payload: EnrichRichSummaryPayload,
  options?: PgBoss.SendOptions
): Promise<string | null> {
  const boss = getJobQueue().getInstance();

  return boss.send(JOB_NAMES.ENRICH_RICH_SUMMARY, payload, {
    ...RICH_SUMMARY_RETRY_OPTIONS,
    ...options,
  });
}
