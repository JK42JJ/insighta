/**
 * Enrich Rich Summary Job Handler — CP462+ Issue #649 Phase 2
 *
 * Heart-click on-demand rich summary generation. 2-step path per CP462
 * Phase 2 step 3 fact-finding:
 *
 *   1. enrichRichSummary (v1) — short-circuits when a row already exists
 *      with quality_flag='pass'. Otherwise INSERTs the v1 row that v2's
 *      UPDATE-only generator requires.
 *   2. generateRichSummaryV2 — upgrades the v1 row to v2 (writes
 *      core/analysis/lora + mandala_relevance_pct against the user's
 *      mandala center_goal). Skips when the row is already v2 AND the
 *      score is populated. Legacy v2 rows (NULL score) are regenerated
 *      on the first Heart click per the Lazy backfill decision.
 *
 * Job flow:
 *   POST /api/v1/cards/:videoId/like
 *     → INSERT card_interactions signal='like'
 *     → enqueueEnrichRichSummary({videoId, userId, mandalaId, title})
 *     → this handler picks up the job
 *     → step 1 + step 2 above
 *
 * Interactive path: RICH_SUMMARY_RETRY_OPTIONS (no retry, 5-min expiry) —
 * the user is actively waiting via SSE, so failures must surface
 * immediately rather than silent backoff.
 *
 * See:
 *   docs/runbook/card-preference-signal-handoff-2026-05-15.md
 *   docs/runbook/cp462-card-interactions-phase2-handoff.md
 *   src/modules/queue/types.ts (EnrichRichSummaryPayload, RICH_SUMMARY_RETRY_OPTIONS)
 *   src/modules/skills/rich-summary.ts (enrichRichSummary — v1 generator)
 *   src/modules/skills/rich-summary-v2-generator.ts (generateRichSummaryV2 — v2 upgrade)
 */

import type PgBoss from 'pg-boss';

import { enrichRichSummary } from '../../skills/rich-summary';
import { generateRichSummaryV2 } from '../../skills/rich-summary-v2-generator';
import { getMandalaManager } from '../../mandala/manager';
import { getCaptionExtractor } from '../../caption/extractor';
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

  // Step 0 — fetch transcript (in-memory only, never persisted). Best
  // effort: failure → undefined → generators fall back to description.
  let transcript: string | undefined;
  try {
    const result = await getCaptionExtractor().extractCaptions(videoId);
    if (result.success && result.caption?.fullText) {
      transcript = result.caption.fullText;
      logger.info('enrich-rich-summary: transcript fetched', {
        jobId: job.id,
        videoId,
        chars: transcript.length,
        language: result.language,
      });
    } else {
      logger.info('enrich-rich-summary: transcript unavailable (description fallback)', {
        jobId: job.id,
        videoId,
        reason: result.error ?? 'unknown',
      });
    }
  } catch (err) {
    logger.warn('enrich-rich-summary: transcript fetch threw (description fallback)', {
      jobId: job.id,
      videoId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Step 1 — v1 generate. forceRegen when transcript just arrived so a
  // description-only cache row is overwritten by transcript-derived content.
  const v1Result = await enrichRichSummary(videoId, {
    userId,
    title,
    description,
    transcript,
    forceRegen: transcript !== undefined,
  });

  // Step 2 — resolve the mandala center goal (root level, depth=0). When
  // the mandala is missing or unreadable we still attempt v2 with an empty
  // center goal so the LLM scores mandala_relevance_pct=0; the v2 row is
  // still useful for `one_liner` / chapter relevance display.
  let centerGoal = '';
  try {
    const mandala = await getMandalaManager().getMandalaById(userId, mandalaId);
    centerGoal = mandala?.levels[0]?.centerGoal ?? '';
  } catch (err) {
    logger.warn('enrich-rich-summary: mandala lookup failed (continuing with empty center goal)', {
      jobId: job.id,
      videoId,
      mandalaId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Step 3 — v2 upgrade + mandala_relevance_pct, transcript-aware.
  const v2Outcome = await generateRichSummaryV2({
    videoId,
    userId,
    mandalaCenterGoal: centerGoal,
    transcript,
  });

  logger.info('enrich-rich-summary: completed', {
    jobId: job.id,
    videoId,
    hadTranscript: transcript !== undefined,
    v1QualityFlag: v1Result.qualityFlag,
    v1QualityScore: v1Result.qualityScore,
    v2OutcomeKind: v2Outcome.kind,
    v2Detail:
      v2Outcome.kind === 'pass'
        ? { completeness: v2Outcome.completeness }
        : { reason: v2Outcome.reason },
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
