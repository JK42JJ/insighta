/**
 * Segment-relevance fill worker (§2-D #2).
 *
 * Scores ONE rich-summary time-segment against the mandala centerGoal using the
 * SSOT card scorer (computeCardRelevance, Haiku) and upserts the result into
 * video_mandala_segment_relevance, keyed (video_id, mandala_id, segment_idx).
 *
 * Why re-score (not reuse video_rich_summaries.segments[].relevance_pct): that
 * value lives on the video-keyed (shared) v2 row and was scored against whatever
 * single mandala triggered generation — wrong for every other mandala holding
 * the same video. Re-scoring per mandala is the whole reason this table is
 * mandala-keyed (cross-mandala leak avoidance, §2-C).
 *
 * Interpolation = 0 (hard rule): relevance_pct is ONLY ever the scorer's output.
 * A failed/empty score writes NOTHING — never a fabricated 0 or default.
 *
 * Concurrency: richSummaryWorkOptions(N) — teamSize:N + teamRefill so N is not
 * inert (CP498 teamSize:1 serial trap). Reuses the relevance-backfill knob; the
 * scorer shares the OpenRouter key, so concurrency is bounded the same way.
 */

import type PgBoss from 'pg-boss';

import { computeCardRelevance } from '@/modules/relevance/compute-card-relevance';
import { getPrismaClient } from '@/modules/database/client';
import { logger } from '@/utils/logger';
import { getJobQueue } from '../manager';
import {
  JOB_NAMES,
  SEGMENT_RELEVANCE_FILL_OPTIONS,
  type SegmentRelevanceFillPayload,
} from '../types';
import { config } from '@/config/index';
import { richSummaryWorkOptions } from './rich-summary-work-options';

const log = logger.child({ module: 'queue/segment-relevance-fill' });

export async function registerSegmentRelevanceFillWorker(): Promise<void> {
  const boss = getJobQueue().getInstance();
  const concurrency = config.queue.relevanceBackfillConcurrency;
  await boss.work<SegmentRelevanceFillPayload>(
    JOB_NAMES.SEGMENT_RELEVANCE_FILL,
    richSummaryWorkOptions(concurrency),
    handleSegmentRelevanceFill
  );
  log.info('segment-relevance-fill worker registered', { concurrency });
}

async function handleSegmentRelevanceFill(
  job: PgBoss.Job<SegmentRelevanceFillPayload>
): Promise<void> {
  const { videoId, mandalaId, segmentIdx, fromSec, toSec, title, summary, centerGoal, cellGoal } =
    job.data;

  const result = await computeCardRelevance({
    title,
    description: summary,
    centerGoal,
    cellGoal,
  });

  if (!result.ok) {
    // no_title = legitimate terminal skip (no usable text). NO row written —
    // an unscored segment simply has no row (interpolation forbidden).
    if (result.reason === 'no_title') {
      log.info('segment-relevance-fill: skipped (no_title)', {
        jobId: job.id,
        videoId,
        segmentIdx,
      });
      return;
    }
    // Transient (provider/validation) → throw → pg-boss retries once.
    log.warn('segment-relevance-fill: compute failed', {
      jobId: job.id,
      videoId,
      segmentIdx,
      reason: result.reason,
    });
    throw new Error(`segment_relevance_compute_failed: ${result.reason}`);
  }

  // Upsert — relevance_pct is ONLY ever result.relevancePct (scorer output).
  // Raw SQL: composite PK, and the model may lag client regen on some deploys.
  const prisma = getPrismaClient();
  await prisma.$executeRawUnsafe(
    `INSERT INTO video_mandala_segment_relevance
       (video_id, mandala_id, segment_idx, from_sec, to_sec, relevance_pct, computed_at)
     VALUES ($1, $2::uuid, $3, $4, $5, $6, NOW())
     ON CONFLICT (video_id, mandala_id, segment_idx) DO UPDATE SET
       from_sec      = EXCLUDED.from_sec,
       to_sec        = EXCLUDED.to_sec,
       relevance_pct = EXCLUDED.relevance_pct,
       computed_at   = NOW()`,
    videoId,
    mandalaId,
    segmentIdx,
    fromSec,
    toSec,
    result.relevancePct
  );

  log.info('segment-relevance-fill: scored', {
    jobId: job.id,
    videoId,
    segmentIdx,
    relevancePct: result.relevancePct,
  });
}

/** Enqueue one segment-relevance job. Returns the pg-boss job id (or null). */
export async function enqueueSegmentRelevanceFill(
  payload: SegmentRelevanceFillPayload,
  options?: PgBoss.SendOptions
): Promise<string | null> {
  const boss = getJobQueue().getInstance();
  return boss.send(JOB_NAMES.SEGMENT_RELEVANCE_FILL, payload, {
    ...SEGMENT_RELEVANCE_FILL_OPTIONS,
    ...options,
  });
}
