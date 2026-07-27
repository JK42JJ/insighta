/**
 * Channel-mode collection leg.
 *
 * The properties that matter are the ones a user would notice: a week only
 * contains things published that week, one busy channel cannot crowd out the
 * others, Shorts stay out, and a quiet week stays honestly empty instead of
 * being topped up from somewhere else.
 */

import {
  fetchChannelUploads,
  collectChannelUploads,
  CHANNEL_MODE_RELEVANCE_PCT,
} from '../../src/modules/curation/channel-uploads';

const KEY = ['test-key'];
const MONDAY = new Date('2026-07-27T00:00:00+09:00');

function playlistReply(items: Array<{ id: string; at: string; title?: string }>) {
  return {
    ok: true,
    json: async () => ({
      items: items.map((i) => ({
        snippet: { title: i.title ?? i.id, resourceId: { videoId: i.id } },
        contentDetails: { videoId: i.id, videoPublishedAt: i.at },
      })),
    }),
  } as unknown as Response;
}

/** videos.list reply — duration drives the Shorts filter. */
function videosReply(rows: Array<{ id: string; duration: string }>) {
  return {
    ok: true,
    json: async () => ({
      items: rows.map((r) => ({
        id: r.id,
        snippet: { title: r.id },
        contentDetails: { duration: r.duration },
      })),
    }),
  } as unknown as Response;
}

const LONG = 'PT12M30S';
const SHORT = 'PT45S';

/** Routes a call to the playlist or videos stub based on its URL. */
function router(
  uploads: Record<string, Array<{ id: string; at: string }>>,
  durations: Record<string, string>
) {
  return jest.fn(async (url: unknown) => {
    const u = String(url);
    if (u.includes('/playlistItems')) {
      const pl = decodeURIComponent(u.match(/playlistId=([^&]+)/)?.[1] ?? '');
      return playlistReply(uploads[pl] ?? []);
    }
    // searchParams encodes the comma, so decode before splitting
    const ids = decodeURIComponent(u.match(/[?&]id=([^&]+)/)?.[1] ?? '')
      .split(',')
      .filter(Boolean);
    return videosReply(ids.map((id) => ({ id, duration: durations[id] ?? LONG })));
  }) as unknown as typeof fetch;
}

describe('fetchChannelUploads', () => {
  it('keeps only uploads published at or after the week start', async () => {
    const fetchImpl = jest.fn(async () =>
      playlistReply([
        { id: 'new1', at: '2026-07-27T09:00:00Z' },
        { id: 'lastweek', at: '2026-07-24T09:00:00Z' },
      ])
    ) as unknown as typeof fetch;

    const out = await fetchChannelUploads('UC1', 'UU1', MONDAY, KEY, fetchImpl);
    expect(out.map((u) => u.videoId)).toEqual(['new1']);
  });

  it('returns [] instead of throwing when the channel call fails', async () => {
    const fetchImpl = jest.fn(
      async () => ({ ok: false, status: 404 }) as unknown as Response
    ) as unknown as typeof fetch;
    expect(await fetchChannelUploads('UC1', 'UU1', MONDAY, KEY, fetchImpl)).toEqual([]);
  });

  it('skips rows with no publish date rather than guessing one', async () => {
    const fetchImpl = jest.fn(
      async () =>
        ({
          ok: true,
          json: async () => ({ items: [{ contentDetails: { videoId: 'x' } }] }),
        }) as unknown as Response
    ) as unknown as typeof fetch;
    expect(await fetchChannelUploads('UC1', 'UU1', MONDAY, KEY, fetchImpl)).toEqual([]);
  });

  it('spends nothing when no API key is configured', async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    expect(await fetchChannelUploads('UC1', 'UU1', MONDAY, [], fetchImpl)).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('collectChannelUploads', () => {
  const twoChannels = [
    { channel_id: 'UC1', uploads_playlist_id: 'UU1' },
    { channel_id: 'UC2', uploads_playlist_id: 'UU2' },
  ];

  it('interleaves so one prolific channel cannot fill the week', async () => {
    const fetchImpl = router(
      {
        UU1: [
          { id: 'a1', at: '2026-07-31T10:00:00Z' },
          { id: 'a2', at: '2026-07-30T10:00:00Z' },
          { id: 'a3', at: '2026-07-29T10:00:00Z' },
        ],
        UU2: [{ id: 'b1', at: '2026-07-28T10:00:00Z' }],
      },
      {}
    );

    const out = await collectChannelUploads({
      channels: twoChannels,
      since: MONDAY,
      limit: 3,
      apiKeys: KEY,
      fetchImpl,
    });
    // round 1 takes the newest from each channel before round 2 revisits UC1
    expect(out.map((p) => p.videoId)).toEqual(['a1', 'b1', 'a2']);
  });

  it('drops Shorts by measured duration', async () => {
    const fetchImpl = router(
      {
        UU1: [
          { id: 'short', at: '2026-07-31T10:00:00Z' },
          { id: 'long', at: '2026-07-30T10:00:00Z' },
        ],
      },
      { short: SHORT, long: LONG }
    );

    const out = await collectChannelUploads({
      channels: [twoChannels[0]!],
      since: MONDAY,
      limit: 10,
      apiKeys: KEY,
      fetchImpl,
    });
    expect(out.map((p) => p.videoId)).toEqual(['long']);
  });

  it('keeps everything when videos.list itself fails (no measurement, no drop)', async () => {
    const fetchImpl = jest.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes('/playlistItems'))
        return playlistReply([{ id: 'unknown', at: '2026-07-31T10:00:00Z' }]);
      return { ok: false, status: 500 } as unknown as Response;
    }) as unknown as typeof fetch;

    const out = await collectChannelUploads({
      channels: [twoChannels[0]!],
      since: MONDAY,
      limit: 10,
      apiKeys: KEY,
      fetchImpl,
    });
    expect(out.map((p) => p.videoId)).toEqual(['unknown']);
  });

  it('drops a video whose duration is absent from a successful reply', async () => {
    // videos.list omits contentDetails.duration for Shorts specifically, so an
    // absent duration in an OK reply is treated as a Short (codebase convention).
    const fetchImpl = jest.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes('/playlistItems'))
        return playlistReply([{ id: 'nodur', at: '2026-07-31T10:00:00Z' }]);
      return {
        ok: true,
        json: async () => ({ items: [{ id: 'nodur', snippet: { title: 'nodur' } }] }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const out = await collectChannelUploads({
      channels: [twoChannels[0]!],
      since: MONDAY,
      limit: 10,
      apiKeys: KEY,
      fetchImpl,
    });
    expect(out).toEqual([]);
  });

  it('reports an empty week honestly rather than reaching further back', async () => {
    const fetchImpl = router({ UU1: [{ id: 'old', at: '2026-07-20T10:00:00Z' }] }, {});
    const out = await collectChannelUploads({
      channels: [twoChannels[0]!],
      since: MONDAY,
      limit: 10,
      apiKeys: KEY,
      fetchImpl,
    });
    expect(out).toEqual([]);
  });

  it('survives one channel failing without losing the other', async () => {
    const fetchImpl = jest.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes('playlistId=UU1')) return { ok: false, status: 403 } as unknown as Response;
      if (u.includes('/playlistItems'))
        return playlistReply([{ id: 'b1', at: '2026-07-28T10:00:00Z' }]);
      return videosReply([{ id: 'b1', duration: LONG }]);
    }) as unknown as typeof fetch;

    const out = await collectChannelUploads({
      channels: twoChannels,
      since: MONDAY,
      limit: 10,
      apiKeys: KEY,
      fetchImpl,
    });
    expect(out.map((p) => p.videoId)).toEqual(['b1']);
  });

  it('ignores channels with no uploads playlist and spends nothing on them', async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    const out = await collectChannelUploads({
      channels: [{ channel_id: 'UC1', uploads_playlist_id: null }],
      since: MONDAY,
      limit: 10,
      apiKeys: KEY,
      fetchImpl,
    });
    expect(out).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('deduplicates a video that two followed channels both surface', async () => {
    const fetchImpl = router(
      {
        UU1: [{ id: 'same', at: '2026-07-31T10:00:00Z' }],
        UU2: [{ id: 'same', at: '2026-07-31T10:00:00Z' }],
      },
      {}
    );
    const out = await collectChannelUploads({
      channels: twoChannels,
      since: MONDAY,
      limit: 10,
      apiKeys: KEY,
      fetchImpl,
    });
    expect(out).toHaveLength(1);
  });

  it('stores a constant relevance — the user picked the channel', async () => {
    const fetchImpl = router({ UU1: [{ id: 'a1', at: '2026-07-31T10:00:00Z' }] }, {});
    const out = await collectChannelUploads({
      channels: [twoChannels[0]!],
      since: MONDAY,
      limit: 10,
      apiKeys: KEY,
      fetchImpl,
    });
    expect(out[0]!.relevancePct).toBe(CHANNEL_MODE_RELEVANCE_PCT);
  });
});
