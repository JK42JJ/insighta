/**
 * Batch Scan Job Handler
 *
 * Periodically scans for unenriched YouTube videos and enqueues
 * individual enrich-video jobs. Replaces the EnrichmentScheduler's
 * probe + execute cycle with a persistent, scheduled pg-boss job.
 *
 * Health-adaptive: checks server health before enqueuing.
 */

import PgBoss from 'pg-boss';
import { getPrismaClient } from '../../database/client';
import { logger } from '../../../utils/logger';
import type { BatchScanPayload } from '../types';
import { JOB_NAMES, QUEUE_CONFIG } from '../types';
import { getJobQueue } from '../manager';
import { enqueueEnrichVideo } from './enrich-video';

// ============================================================================
// Constants
// ============================================================================

const HEALTH_TIMEOUT_MS = 2000;
const MAX_BATCH_SIZE = 3;

type HealthLevel = 'good' | 'ok' | 'bad';

// ============================================================================
// Worker Registration
// ============================================================================

/**
 * Register the batch-scan worker and schedule.
 * Must be called after JobQueue.start().
 */
export async function registerBatchScanWorker(): Promise<void> {
  const boss = getJobQueue().getInstance();

  // Register the worker
  await boss.work<BatchScanPayload>(JOB_NAMES.BATCH_SCAN, handleBatchScan);

  // Schedule recurring execution (cron)
  await boss.schedule(JOB_NAMES.BATCH_SCAN, QUEUE_CONFIG.BATCH_SCAN_CRON, { limit: MAX_BATCH_SIZE });

  logger.info('batch-scan worker registered + scheduled', {
    cron: QUEUE_CONFIG.BATCH_SCAN_CRON,
    maxBatch: MAX_BATCH_SIZE,
  });
}

// ============================================================================
// Handler
// ============================================================================

/**
 * Handle a batch-scan job: probe for unenriched videos, check health, enqueue.
 */
async function handleBatchScan(job: PgBoss.Job<BatchScanPayload>): Promise<void> {
  const limit = job.data?.limit ?? MAX_BATCH_SIZE;

  logger.info('batch-scan: starting', { jobId: job.id, limit });

  // ① Probe: count pending + check health
  const pending = await countPending();

  if (pending === 0) {
    logger.info('batch-scan: no pending videos');
    return;
  }

  const health = await checkHealth();

  // ② Decide batch size based on health
  let batchSize: number;
  switch (health) {
    case 'good':
      batchSize = Math.min(limit, pending);
      break;
    case 'ok':
      batchSize = Math.min(1, pending);
      break;
    case 'bad':
      logger.warn('batch-scan: server unhealthy, skipping', { health });
      return;
  }

  // ③ Fetch and enqueue
  const videos = await fetchUnenriched(batchSize);
  let enqueued = 0;

  for (const video of videos) {
    const jobId = await enqueueEnrichVideo({
      videoId: video.vid,
      title: video.title,
      url: video.url,
      source: 'batch',
    });

    if (jobId) enqueued++;
  }

  logger.info('batch-scan: completed', {
    jobId: job.id,
    pending,
    health,
    batchSize,
    enqueued,
  });
}

// ============================================================================
// Helpers
// ============================================================================

async function countPending(): Promise<number> {
  const prisma = getPrismaClient();

  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) as count
    FROM public.user_local_cards c
    WHERE c.link_type IN ('youtube', 'youtube-shorts')
      AND c.video_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.video_summaries vs
        WHERE vs.video_id = c.video_id
      )
  `;

  return Number(rows[0]?.count ?? 0);
}

async function fetchUnenriched(
  limit: number
): Promise<{ vid: string; title: string; url: string }[]> {
  const prisma = getPrismaClient();

  return prisma.$queryRaw<{ vid: string; title: string; url: string }[]>`
    SELECT
      c.video_id as vid,
      COALESCE(c.title, c.metadata_title, 'Untitled') as title,
      c.url
    FROM public.user_local_cards c
    WHERE c.link_type IN ('youtube', 'youtube-shorts')
      AND c.video_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.video_summaries vs
        WHERE vs.video_id = c.video_id
      )
    ORDER BY c.created_at ASC
    LIMIT ${limit}
  `;
}

async function checkHealth(): Promise<HealthLevel> {
  const start = Date.now();
  let latencyMs: number;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    const port = process.env['PORT'] || '3000';
    await fetch(`http://localhost:${port}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    latencyMs = Date.now() - start;
  } catch {
    latencyMs = HEALTH_TIMEOUT_MS + 1;
  }

  if (latencyMs < 500) return 'good';
  if (latencyMs < 1500) return 'ok';
  return 'bad';
}
