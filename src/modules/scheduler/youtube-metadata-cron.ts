/**
 * YouTube metadata backfill cron (CP437, 2026-04-29).
 *
 * Schedules a node-cron task that picks up to
 * `YOUTUBE_METADATA_BACKFILL_BATCH_SIZE` (default 2,000) youtube_videos
 * rows where `metadata_fetched_at IS NULL`, fetches full metadata via
 * `videos.list` (50-id batches), and upserts the new columns.
 *
 * Priority (matches handoff §4 spec):
 *   1. user_video_states-bookmarked videos
 *   2. recommendation_cache-mentioned videos
 *   3. view_count DESC
 *
 * Quota: 50-id batch = 1 unit; 2,000 = 40 units. Safe vs the 10,000
 * daily quota even alongside the search.list path (100 units/call).
 */

import * as cron from 'node-cron';
import { Prisma } from '@prisma/client';

import { getPrismaClient } from '@/modules/database/client';
import { loadYouTubeMetadataConfig } from '@/config/youtube-metadata';
import { logger } from '@/utils/logger';
import { collectAndUpsertMetadata } from '../youtube/metadata-collector';
import { VIDEOS_LIST_MAX_IDS_PER_CALL } from '@/skills/plugins/video-discover/v2/youtube-client';

const log = logger.child({ module: 'YouTubeMetadataCron' });

let cronTask: cron.ScheduledTask | null = null;
let runInProgress = false;

export async function selectMetadataCandidates(limit: number): Promise<string[]> {
  if (limit <= 0) return [];
  const prisma = getPrismaClient();

  // Single CTE-based query: candidates without metadata_fetched_at, joined to
  // bookmark + recommendation counts for ordering. ORDER BY:
  //   1. has_bookmark DESC (true first)
  //   2. has_rec_cache DESC
  //   3. view_count DESC NULLS LAST
  const rows = await prisma.$queryRaw<{ youtube_video_id: string }[]>(Prisma.sql`
    SELECT yv.youtube_video_id
    FROM youtube_videos yv
    LEFT JOIN (
      SELECT yv2.youtube_video_id, COUNT(*) AS bookmark_count
      FROM user_video_states uvs
      JOIN youtube_videos yv2 ON yv2.id = uvs.video_id
      GROUP BY yv2.youtube_video_id
    ) book ON book.youtube_video_id = yv.youtube_video_id
    LEFT JOIN (
      SELECT video_id, COUNT(*) AS rec_count
      FROM recommendation_cache
      GROUP BY video_id
    ) rec ON rec.video_id = yv.youtube_video_id
    WHERE yv.metadata_fetched_at IS NULL
    ORDER BY
      (COALESCE(book.bookmark_count, 0) > 0) DESC,
      (COALESCE(rec.rec_count, 0) > 0) DESC,
      yv.view_count DESC NULLS LAST
    LIMIT ${Prisma.raw(String(limit))}
  `);
  return rows.map((r) => r.youtube_video_id);
}

export async function runMetadataBatchOnce(batchSize: number): Promise<{
  picked: number;
  fetched: number;
  upserted: number;
  errors: number;
}> {
  if (runInProgress) {
    log.warn('metadata cron tick skipped — previous run still in progress');
    return { picked: 0, fetched: 0, upserted: 0, errors: 0 };
  }
  runInProgress = true;
  const t0 = Date.now();
  try {
    const candidates = await selectMetadataCandidates(batchSize);
    log.info('metadata cron batch start', { picked: candidates.length, batchSize });
    let totalFetched = 0;
    let totalUpserted = 0;
    let totalErrors = 0;
    // Chunk into 50-id calls (videos.list max). Each call = 1 quota unit.
    for (let i = 0; i < candidates.length; i += VIDEOS_LIST_MAX_IDS_PER_CALL) {
      const chunk = candidates.slice(i, i + VIDEOS_LIST_MAX_IDS_PER_CALL);
      const result = await collectAndUpsertMetadata(chunk);
      totalFetched += result.fetched;
      totalUpserted += result.upserted;
      totalErrors += result.errors;
    }
    log.info('metadata cron batch done', {
      picked: candidates.length,
      fetched: totalFetched,
      upserted: totalUpserted,
      errors: totalErrors,
      elapsedMs: Date.now() - t0,
    });
    return {
      picked: candidates.length,
      fetched: totalFetched,
      upserted: totalUpserted,
      errors: totalErrors,
    };
  } finally {
    runInProgress = false;
  }
}

export function startYouTubeMetadataCron(): void {
  const config = loadYouTubeMetadataConfig();
  if (!config.backfillEnabled) {
    log.info('metadata cron disabled (YOUTUBE_METADATA_BACKFILL_ENABLED=false)');
    return;
  }
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
  }
  if (!cron.validate(config.backfillSchedule)) {
    log.error('metadata cron schedule invalid — not started', {
      schedule: config.backfillSchedule,
    });
    return;
  }
  cronTask = cron.schedule(config.backfillSchedule, () => {
    void runMetadataBatchOnce(config.backfillBatchSize);
  });
  log.info('metadata cron started', {
    schedule: config.backfillSchedule,
    batchSize: config.backfillBatchSize,
  });
}

export function stopYouTubeMetadataCron(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    log.info('metadata cron stopped');
  }
}
