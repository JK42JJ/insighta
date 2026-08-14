/**
 * Playlist sync scheduling mode.
 *
 * The timer path spawns one node-cron task per playlist inside the process
 * that owns the scheduler. That has two consequences. The number of live
 * timers grows with the number of playlists, and the only thing stopping a
 * second process from running the same schedule is an in-process Set — the
 * database fallback at manager.ts reads sync_status and writes it in a
 * separate statement, so two processes ticking in the same second both pass.
 *
 * The queue path replaces every timer with one scheduled job. On each tick it
 * claims the rows whose next_run has passed, moving next_run forward in the
 * same UPDATE, and enqueues one job per claimed row. The claim uses
 * FOR UPDATE SKIP LOCKED, so overlapping ticks and parallel workers cannot
 * take the same playlist. The scheduler stops holding state, and throughput
 * becomes a function of worker replicas rather than of one process's timers.
 *
 * sync_schedules was already shaped for this: it carries next_run and an
 * index on (next_run, enabled).
 *
 * Default OFF. Unset reproduces the timer behaviour, so the flag alone rolls
 * the change back with no code revert.
 */

function readBool(raw: string | undefined, fallback: boolean): boolean {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (v === '') return fallback;
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return fallback;
}

function readInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(raw ?? '').trim(), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Queue path instead of per-playlist node-cron timers. */
export function isPlaylistSyncViaQueue(env: NodeJS.ProcessEnv = process.env): boolean {
  return readBool(env['PLAYLIST_SYNC_VIA_QUEUE'], false);
}

/**
 * How often to look for due playlists.
 *
 * This is the resolution of the schedule, not its frequency: a playlist with a
 * 6-hour interval still syncs every 6 hours, it just may start up to one tick
 * late. Every minute keeps the lag small while costing one indexed query.
 */
export function playlistSyncTickCron(env: NodeJS.ProcessEnv = process.env): string {
  const v = String(env['PLAYLIST_SYNC_TICK_CRON'] ?? '').trim();
  return v === '' ? '* * * * *' : v;
}

/**
 * Most playlists claimed per tick.
 *
 * A bound, not a target. It caps how much work one tick can put into the
 * queue, so a backlog drains over several ticks instead of arriving at once;
 * anything not claimed stays due and is picked up by the next tick.
 */
export function playlistSyncBatchLimit(env: NodeJS.ProcessEnv = process.env): number {
  return readInt(env['PLAYLIST_SYNC_BATCH_LIMIT'], 25, 1, 500);
}
