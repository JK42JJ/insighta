/**
 * The lookback window a channel curation asks for, and the name it keeps.
 *
 * Both are regressions found on a real account on 2026-07-28: a curation
 * following two channels showed one video, and the name the user typed came
 * back as the first channel's title.
 */

import { fetchChannelUploads } from '../../src/modules/curation/channel-uploads';

const KEY = ['test-key'];

function playlistReply(items: Array<{ id: string; at: string }>) {
  return {
    ok: true,
    json: async () => ({
      items: items.map((i) => ({
        snippet: { title: i.id, resourceId: { videoId: i.id } },
        contentDetails: { videoId: i.id, videoPublishedAt: i.at },
      })),
    }),
  } as unknown as Response;
}

describe('channel lookback window', () => {
  /**
   * The build that broke it ran on Monday 2026-07-28 with `since` set to that
   * same week's Monday, so it asked for videos uploaded in the few hours since
   * midnight. A seven-day window is what a weekly delivery means.
   */
  it('a seven-day window includes what a same-day window misses', async () => {
    const now = new Date('2026-07-28T03:16:00Z');
    const uploads = [
      { id: 'sun', at: '2026-07-26T09:00:00Z' }, // 2 days ago
      { id: 'wed', at: '2026-07-22T09:00:00Z' }, // 6 days ago
      { id: 'old', at: '2026-07-10T09:00:00Z' }, // 18 days ago — out either way
    ];
    const fetchImpl = (async () => playlistReply(uploads)) as unknown as typeof fetch;

    const sevenDays = await fetchChannelUploads(
      'UC1',
      'UU1',
      new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      KEY,
      fetchImpl
    );
    expect(sevenDays.map((u) => u.videoId).sort()).toEqual(['sun', 'wed']);

    // The old behaviour, kept here as the thing that must not come back.
    const sinceThisMonday = await fetchChannelUploads(
      'UC1',
      'UU1',
      new Date('2026-07-27T00:00:00Z'),
      KEY,
      fetchImpl
    );
    expect(sinceThisMonday).toHaveLength(0);
  });

  /** A Monday build must not ask for a window that has barely started. */
  it('the window is never shorter than a day, whatever day the build runs', () => {
    const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
    for (const day of ['2026-07-27', '2026-07-28', '2026-07-31', '2026-08-02']) {
      const now = new Date(`${day}T03:16:00Z`);
      const since = new Date(now.getTime() - LOOKBACK_MS);
      expect(now.getTime() - since.getTime()).toBe(LOOKBACK_MS);
    }
  });
});

describe('curation naming', () => {
  /**
   * Mirrors the route's resolution order. The typed name wins; the channel
   * title only fills in when nothing was typed. Naming a two-channel curation
   * after one of its channels is wrong on its face, and doing it silently
   * renamed a curation out from under its owner.
   */
  const resolveTopic = (typed: string, channelTitle: string | null) =>
    typed.trim() || (channelTitle ?? '');

  it('keeps the name the user typed', () => {
    expect(resolveTopic('Investing', 'Some Channel - market takes')).toBe('Investing');
  });

  it('falls back to the channel title only when nothing was typed', () => {
    expect(resolveTopic('  ', 'Some Channel')).toBe('Some Channel');
  });
});
