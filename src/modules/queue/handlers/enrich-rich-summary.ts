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

// CP475+ — v1 `enrichRichSummary` removed from this handler path per user
// directive "v1 은 코드는 유지, 패스에서는 제거". Cron / other callers can
// still import from '../../skills/rich-summary'. The v2 quick + full
// generators below take over the row-creation responsibility.
import { generateRichSummaryV2Quick } from '../../skills/rich-summary-v2-quick-generator';
import { generateRichSummaryV2 } from '../../skills/rich-summary-v2-generator';
import { getMandalaManager } from '../../mandala/manager';
import { getCaptionExtractor } from '../../caption/extractor';
import { getPrismaClient } from '../../database/client';
import { logger } from '../../../utils/logger';
import { getJobQueue } from '../manager';
import {
  JOB_NAMES,
  QUEUE_CONFIG,
  RICH_SUMMARY_RETRY_OPTIONS,
  type EnrichRichSummaryPayload,
} from '../types';

/** Thrown when captions are unavailable so the worker fails fast and the
 *  grid surfaces a retry affordance instead of a description-only row. */
export const NO_TRANSCRIPT_ERROR = 'NO_TRANSCRIPT';

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
  // CP475+ — `title` / `description` from job payload are no longer needed
  // in this handler (the v1 path that consumed them is removed; both the
  // quick and full v2 generators re-read from youtube_videos directly).
  const { videoId, userId, mandalaId } = job.data;

  logger.info('enrich-rich-summary: processing', {
    jobId: job.id,
    videoId,
    userId,
    mandalaId,
  });

  // Pick a language hint so caption-extractor probes the spoken language
  // before falling through to its ko/en defaults.
  let langHint: string | undefined;
  try {
    const prisma = getPrismaClient();
    const [rsRow, ytRow] = await Promise.all([
      prisma.video_rich_summaries.findUnique({
        where: { video_id: videoId },
        select: { source_language: true },
      }),
      prisma.youtube_videos.findUnique({
        where: { youtube_video_id: videoId },
        select: { default_language: true },
      }),
    ]);
    langHint = rsRow?.source_language ?? ytRow?.default_language ?? undefined;
  } catch (err) {
    logger.warn('enrich-rich-summary: lang-hint lookup failed (continuing without)', {
      jobId: job.id,
      videoId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Hard rule: NO v2 row without a transcript. Captions absent ⇒ throw
  // NO_TRANSCRIPT ⇒ SSE `failed` ⇒ grid renders the retry icon.
  let transcript: string | undefined;
  try {
    const result = await getCaptionExtractor().extractCaptions(videoId, langHint);
    if (result.success && result.caption?.fullText) {
      transcript = result.caption.fullText;
      logger.info('enrich-rich-summary: transcript fetched', {
        jobId: job.id,
        videoId,
        chars: transcript.length,
        language: result.language,
        langHint: langHint ?? null,
      });
    } else {
      logger.info('enrich-rich-summary: transcript unavailable — surfacing retry', {
        jobId: job.id,
        videoId,
        reason: result.error ?? 'unknown',
        langHint: langHint ?? null,
      });
    }
  } catch (err) {
    logger.warn('enrich-rich-summary: transcript fetch threw — surfacing retry', {
      jobId: job.id,
      videoId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (transcript === undefined) {
    // Stamp the attempt timestamp so the scheduler 7-day cooldown holds.
    try {
      await getPrismaClient().youtube_videos.update({
        where: { youtube_video_id: videoId },
        data: { transcript_attempted_at: new Date() },
      });
    } catch {
      /* non-fatal — stamping failure does not change retry semantics */
    }
    throw new Error(NO_TRANSCRIPT_ERROR);
  }

  // Resolve the mandala center goal (root level, depth=0). When the
  // mandala is missing or unreadable we still attempt v2 with an empty
  // center goal so the LLM scores mandala_relevance_pct=0; the v2 row
  // is still useful for `one_liner` / chapter relevance display.
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

  // ── Step 1: Quick path (Haiku, ~1s) ──
  // Produces ONLY core.one_liner + analysis.core_argument +
  // analysis.mandala_fit.mandala_relevance_pct so the FE can drop the
  // bookmark spinner and show the relevance % within 3-4 seconds of
  // the click (transcript fetch ~2-3s already happened upstream).
  //
  // The legacy v1 path (`enrichRichSummary`) used to run here to create
  // the row. The full generator now upserts it directly — v1 is removed
  // from this handler (code preserved for cron callers, but not invoked
  // here). User directive 2026-05-20: "v1 은 코드는 유지, 패스에서는 제거".
  const quickOutcome = await generateRichSummaryV2Quick({
    videoId,
    userId,
    mandalaCenterGoal: centerGoal,
    transcript,
  });

  // ── Step 2: Full path (Sonnet, ~30-60s) ──
  // Same transcript, full v2 layered schema. UPDATEs the row the quick
  // path just created; replaces the minimal core/analysis with the rich
  // versions and adds segments / atoms / entities / key_concepts / lora.
  const v2Outcome = await generateRichSummaryV2({
    videoId,
    userId,
    mandalaCenterGoal: centerGoal,
    transcript,
    forceRegen: true,
  });

  logger.info('enrich-rich-summary: completed', {
    jobId: job.id,
    videoId,
    hadTranscript: true,
    quickKind: quickOutcome.kind,
    quickDetail:
      quickOutcome.kind === 'pass'
        ? { mandalaRelevancePct: quickOutcome.mandalaRelevancePct }
        : { reason: quickOutcome.reason },
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
