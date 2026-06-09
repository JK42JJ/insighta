/**
 * Enrich Relevance Quick — CP498 PR3b (A-stage).
 *
 * One quick-Haiku relevance score (0-100) per user-scoped card ROW, persisted
 * to that row (UserVideoState.relevance_pct or user_local_cards.relevance_pct).
 *
 * Design invariant (the thing NOT to get wrong): relevance is a RELATION
 * (video × this user's centerGoal), not a property of the video. So the unit
 * of work is the row PK, NEVER the video id — the same video in two rows gets
 * two scores. This worker updates `where: { id: rowId }`; it must never key by
 * video_id. compute-card-relevance.ts is import-pure (no Prisma, no
 * youtube_videos read), so this persist step is the only leak surface.
 *
 * Concurrency: reuses richSummaryWorkOptions(N) (PR2 #865) — teamSize:N +
 * teamRefill so pg-boss actually parallelises (teamSize:1 alone is inert).
 */

import type PgBoss from 'pg-boss';

import { computeCardRelevance } from '@/modules/relevance/compute-card-relevance';
import { getPrismaClient } from '@/modules/database/client';
import { logger } from '@/utils/logger';
import { getJobQueue } from '../manager';
import { JOB_NAMES, RELEVANCE_QUICK_RETRY_OPTIONS, type RelevanceQuickPayload } from '../types';
import { config } from '@/config/index';
import { richSummaryWorkOptions } from './rich-summary-work-options';

/**
 * Register the enrich-relevance-quick worker with pg-boss. Must be called
 * after JobQueue.start().
 */
export async function registerEnrichRelevanceQuickWorker(): Promise<void> {
  const boss = getJobQueue().getInstance();

  // N via env (RELEVANCE_BACKFILL_CONCURRENCY, default 4). Rollback = set to 1.
  const concurrency = config.queue.relevanceBackfillConcurrency;
  await boss.work<RelevanceQuickPayload>(
    JOB_NAMES.ENRICH_RELEVANCE_QUICK,
    richSummaryWorkOptions(concurrency),
    handleEnrichRelevanceQuick
  );

  logger.info('enrich-relevance-quick worker registered', { concurrency });
}

/**
 * Score one card row. no_title ⇒ legitimate skip (null-metadata card) — log
 * and return, do not throw. Other compute failures (provider/validation) throw
 * so pg-boss retries once per RELEVANCE_QUICK_RETRY_OPTIONS.
 */
async function handleEnrichRelevanceQuick(job: PgBoss.Job<RelevanceQuickPayload>): Promise<void> {
  const { table, rowId, title, description, centerGoal, cellGoal } = job.data;

  const result = await computeCardRelevance({ title, description, centerGoal, cellGoal });

  if (!result.ok) {
    if (result.reason === 'no_title') {
      logger.info('enrich-relevance-quick: skipped (no_title)', {
        jobId: job.id,
        table,
        rowId,
      });
      return;
    }
    logger.warn('enrich-relevance-quick: compute failed', {
      jobId: job.id,
      table,
      rowId,
      reason: result.reason,
    });
    throw new Error(`relevance_compute_failed: ${result.reason}`);
  }

  const prisma = getPrismaClient();
  const data = { relevance_pct: result.relevancePct, relevance_at: new Date() };

  // Persist keyed by ROW PK — never by video_id (relation-not-attribute
  // invariant). Each row carries its own centerGoal-scoped score.
  if (table === 'uvs') {
    await prisma.userVideoState.update({ where: { id: rowId }, data });
  } else {
    await prisma.user_local_cards.update({ where: { id: rowId }, data });
  }

  logger.info('enrich-relevance-quick: scored', {
    jobId: job.id,
    table,
    rowId,
    relevancePct: result.relevancePct,
  });
}

/**
 * Enqueue a single relevance-quick job. Returns the pg-boss job id (or null
 * when the queue is unavailable). The trigger counts a null return as skipped.
 */
export async function enqueueRelevanceQuick(
  payload: RelevanceQuickPayload,
  options?: PgBoss.SendOptions
): Promise<string | null> {
  const boss = getJobQueue().getInstance();

  return boss.send(JOB_NAMES.ENRICH_RELEVANCE_QUICK, payload, {
    ...RELEVANCE_QUICK_RETRY_OPTIONS,
    ...options,
  });
}
