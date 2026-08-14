import {
  isPlaylistSyncViaQueue,
  playlistSyncTickCron,
  playlistSyncBatchLimit,
} from '../../src/config/playlist-sync';

/**
 * The queue path replaces one node-cron timer per playlist with a single
 * scheduled tick that claims due rows. Both paths starting at once would run
 * every playlist twice, so the default has to be the existing behaviour:
 * unset means timers.
 */
describe('playlist sync mode', () => {
  it('defaults to the timer path, so an unset environment is unchanged', () => {
    expect(isPlaylistSyncViaQueue({})).toBe(false);
  });

  it.each(['true', 'TRUE', '1', 'yes'])('switches to the queue on %s', (v) => {
    expect(isPlaylistSyncViaQueue({ PLAYLIST_SYNC_VIA_QUEUE: v })).toBe(true);
  });

  it.each(['false', '0', 'no', '', '  '])('stays on timers for %s', (v) => {
    expect(isPlaylistSyncViaQueue({ PLAYLIST_SYNC_VIA_QUEUE: v })).toBe(false);
  });

  // A typo must not silently switch scheduling modes.
  it('falls back to timers for an unrecognised value', () => {
    expect(isPlaylistSyncViaQueue({ PLAYLIST_SYNC_VIA_QUEUE: 'queue' })).toBe(false);
  });
});

describe('tick cron', () => {
  it('runs every minute by default', () => {
    expect(playlistSyncTickCron({})).toBe('* * * * *');
  });

  it('is overridable', () => {
    expect(playlistSyncTickCron({ PLAYLIST_SYNC_TICK_CRON: '*/5 * * * *' })).toBe('*/5 * * * *');
  });

  it('ignores an empty override rather than scheduling on an empty string', () => {
    expect(playlistSyncTickCron({ PLAYLIST_SYNC_TICK_CRON: '   ' })).toBe('* * * * *');
  });
});

describe('batch limit', () => {
  it('defaults to 25', () => {
    expect(playlistSyncBatchLimit({})).toBe(25);
  });

  it('parses an override', () => {
    expect(playlistSyncBatchLimit({ PLAYLIST_SYNC_BATCH_LIMIT: '50' })).toBe(50);
  });

  // A limit of 0 would claim nothing and stall every schedule silently;
  // an unbounded one would enqueue the whole table in one tick.
  it('clamps to a usable range', () => {
    expect(playlistSyncBatchLimit({ PLAYLIST_SYNC_BATCH_LIMIT: '0' })).toBe(1);
    expect(playlistSyncBatchLimit({ PLAYLIST_SYNC_BATCH_LIMIT: '-5' })).toBe(1);
    expect(playlistSyncBatchLimit({ PLAYLIST_SYNC_BATCH_LIMIT: '99999' })).toBe(500);
  });

  it('falls back on a non-numeric value', () => {
    expect(playlistSyncBatchLimit({ PLAYLIST_SYNC_BATCH_LIMIT: 'all' })).toBe(25);
  });
});
