/**
 * Playlist sync via the queue.
 *
 * Replaces one node-cron timer per playlist with one scheduled job. The tick
 * claims every schedule whose next_run has passed and enqueues a job per
 * claimed row; a worker runs each sync.
 *
 * The claim is the point of the design. It moves next_run forward in the same
 * statement that selects the row, under FOR UPDATE SKIP LOCKED, so two ticks
 * overlapping or two workers running in parallel cannot take the same
 * playlist. The timer path relied on an in-process Set for that, plus a
 * read-then-write on sync_status which two processes ticking in the same
 * second both pass.
 *
 * Flag-gated: PLAYLIST_SYNC_VIA_QUEUE. Unset leaves the timers in place.
 */

import PgBoss from 'pg-boss';
import { getPrismaClient } from '../../database/client';
import { logger } from '../../../utils/logger';
import { JOB_NAMES } from '../types';
import { getJobQueue } from '../manager';
import { getSchedulerManager } from '../../scheduler/manager';
import {
  isPlaylistSyncViaQueue,
  playlistSyncTickCron,
  playlistSyncBatchLimit,
} from '../../../config/playlist-sync';

export interface PlaylistSyncTickPayload {
  /** Overrides the configured batch limit; used by manual dispatch. */
  limit?: number;
}

export interface PlaylistSyncPayload {
  playlistId: string;
  retryCount: number;
  maxRetries: number;
}

interface ClaimedSchedule {
  playlist_id: string;
  retry_count: number;
  max_retries: number;
}

/**
 * Claim due schedules and move them forward atomically.
 *
 * Selecting and updating in one statement is what makes this safe to run in
 * several processes. SKIP LOCKED means a row another transaction is already
 * claiming is passed over rather than waited on, so ticks never queue behind
 * each other.
 *
 * Exported for the test that proves a second concurrent call claims nothing.
 */
export async function claimDueSchedules(limit: number): Promise<ClaimedSchedule[]> {
  const db = getPrismaClient();
  return db.$queryRaw<ClaimedSchedule[]>`
    UPDATE sync_schedules s
       SET next_run   = now() + (s.interval_ms || ' milliseconds')::interval,
           last_run   = now(),
           updated_at = now()
      FROM (
            SELECT id
              FROM sync_schedules
             WHERE enabled
               AND next_run <= now()
             ORDER BY next_run
             LIMIT ${limit}
               FOR UPDATE SKIP LOCKED
           ) due
     WHERE s.id = due.id
    RETURNING s.playlist_id, s.retry_count, s.max_retries
  `;
}

export async function registerPlaylistSyncWorker(): Promise<void> {
  if (!isPlaylistSyncViaQueue()) {
    logger.info('playlist-sync queue path disabled (PLAYLIST_SYNC_VIA_QUEUE unset)');
    return;
  }

  const boss = getJobQueue().getInstance();

  await boss.work<PlaylistSyncTickPayload>(JOB_NAMES.PLAYLIST_SYNC_TICK, handleTick);
  await boss.work<PlaylistSyncPayload>(JOB_NAMES.PLAYLIST_SYNC, handlePlaylistSync);

  const cron = playlistSyncTickCron();
  await boss.schedule(JOB_NAMES.PLAYLIST_SYNC_TICK, cron);

  logger.info('playlist-sync worker registered + scheduled', {
    cron,
    batchLimit: playlistSyncBatchLimit(),
  });
}

async function handleTick(job: PgBoss.Job<PlaylistSyncTickPayload>): Promise<void> {
  const limit = job.data?.limit ?? playlistSyncBatchLimit();
  const claimed = await claimDueSchedules(limit);

  if (claimed.length === 0) return;

  const boss = getJobQueue().getInstance();
  for (const row of claimed) {
    // singletonKey is a second guard, not the primary one: the claim above
    // already prevents a duplicate. It also collapses a job still queued from
    // an earlier tick for the same playlist.
    await boss.send(
      JOB_NAMES.PLAYLIST_SYNC,
      {
        playlistId: row.playlist_id,
        retryCount: row.retry_count,
        maxRetries: row.max_retries,
      },
      { singletonKey: row.playlist_id }
    );
  }

  logger.info('playlist-sync tick: enqueued', { claimed: claimed.length, limit });
}

async function handlePlaylistSync(job: PgBoss.Job<PlaylistSyncPayload>): Promise<void> {
  const { playlistId, retryCount, maxRetries } = job.data;
  // Same code the timer path runs; only the scheduling differs.
  await getSchedulerManager().runSyncForPlaylist(playlistId, retryCount, maxRetries);
}
