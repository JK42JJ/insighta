/**
 * Enrich Video Job Handler
 *
 * Processes individual video enrichment jobs from the pg-boss queue.
 * Reuses existing enrichVideo() from ontology module.
 *
 * Job flow:
 *   batch-scan → enqueues enrich-video jobs → this handler processes each
 */

import PgBoss from 'pg-boss';
import { enrichVideo } from '../../ontology/enrichment';
import { logger } from '../../../utils/logger';
import type { EnrichVideoPayload } from '../types';
import { JOB_NAMES, ENRICH_RETRY_OPTIONS, QUEUE_CONFIG } from '../types';
import { getJobQueue } from '../manager';

/**
 * Register the enrich-video worker with pg-boss.
 * Must be called after JobQueue.start().
 */
export async function registerEnrichVideoWorker(): Promise<void> {
  const boss = getJobQueue().getInstance();

  await boss.work<EnrichVideoPayload>(
    JOB_NAMES.ENRICH_VIDEO,
    { teamConcurrency: QUEUE_CONFIG.ENRICH_CONCURRENCY, teamSize: 1 },
    handleEnrichVideo
  );

  logger.info('enrich-video worker registered', {
    concurrency: QUEUE_CONFIG.ENRICH_CONCURRENCY,
  });
}

/**
 * Handle a single enrich-video job.
 */
async function handleEnrichVideo(job: PgBoss.Job<EnrichVideoPayload>): Promise<void> {
  const { videoId, title, url, source } = job.data;

  logger.info('enrich-video: processing', { jobId: job.id, videoId, source });

  try {
    await enrichVideo(videoId, { title, url });

    logger.info('enrich-video: completed', { jobId: job.id, videoId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // CAPTION_FAILED: mark as no-caption (permanent skip via video_summaries placeholder)
    if (msg.startsWith('CAPTION_FAILED')) {
      logger.info('enrich-video: no caption available (permanent skip)', { videoId });
      await markNoCaption(videoId, title, url);
      // Don't throw — job is "completed" (no retries for no-caption videos)
      return;
    }

    // Rate limit: throw to trigger retry with backoff
    if (msg.includes('rate') || msg.includes('429') || msg.includes('limit')) {
      logger.warn('enrich-video: rate limited, will retry', { videoId });
    }

    throw err; // pg-boss handles retry based on ENRICH_RETRY_OPTIONS
  }
}

/**
 * Enqueue a single video for enrichment.
 */
export async function enqueueEnrichVideo(
  payload: EnrichVideoPayload,
  options?: PgBoss.SendOptions
): Promise<string | null> {
  const boss = getJobQueue().getInstance();

  return boss.send(JOB_NAMES.ENRICH_VIDEO, payload, {
    ...ENRICH_RETRY_OPTIONS,
    ...options,
  });
}

/**
 * Mark a video as having no captions (placeholder in video_summaries).
 * Reused from EnrichmentScheduler — ensures consistency.
 */
async function markNoCaption(videoId: string, title: string, url: string): Promise<void> {
  const { getPrismaClient } = await import('../../database/client');
  const prisma = getPrismaClient();

  try {
    await prisma.$executeRaw`
      INSERT INTO public.video_summaries (video_id, url, title, summary_en, model, transcript_segments, created_at, updated_at)
      VALUES (${videoId}, ${url}, ${title}, NULL, 'no-caption', 0, now(), now())
      ON CONFLICT (video_id) DO NOTHING
    `;
  } catch (err) {
    logger.warn('Failed to mark no-caption', {
      videoId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
