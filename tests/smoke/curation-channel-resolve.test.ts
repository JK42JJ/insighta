/**
 * Channel resolution — parsing rules and the channels.list contract.
 *
 * Parsing is pure, so every accepted spelling is asserted without spending a
 * quota unit. The network tests pin the two things the weekly build depends on:
 * the uploads playlist comes from the RESPONSE (never derived from UC->UU), and
 * an unresolvable input yields null rather than a half-filled row.
 */

import {
  parseChannelRef,
  resolveChannel,
  resolveChannelIds,
} from '../../src/modules/curation/channel-resolve';

const KEY = ['test-key'];
const CH = 'UCUpJs89fSBXNolQGOYKn0YQ';

function channelsReply(items: unknown[]) {
  return {
    ok: true,
    json: async () => ({ items }),
  } as unknown as Response;
}

const nomad = {
  id: CH,
  snippet: { title: '노마드 코더', thumbnails: { medium: { url: 'https://i/med.jpg' } } },
  contentDetails: { relatedPlaylists: { uploads: 'UUUpJs89fSBXNolQGOYKn0YQ' } },
};

describe('parseChannelRef', () => {
  it('accepts a bare channel id', () => {
    expect(parseChannelRef(CH)).toEqual({ kind: 'id', value: CH });
  });

  it('accepts handles with and without the @', () => {
    expect(parseChannelRef('@nomadcoders')).toEqual({ kind: 'handle', value: 'nomadcoders' });
    expect(parseChannelRef('nomadcoders')).toEqual({ kind: 'handle', value: 'nomadcoders' });
  });

  it.each([
    ['https://youtube.com/@nomadcoders', { kind: 'handle', value: 'nomadcoders' }],
    ['https://www.youtube.com/@nomadcoders/videos', { kind: 'handle', value: 'nomadcoders' }],
    ['http://m.youtube.com/@nomadcoders?si=x', { kind: 'handle', value: 'nomadcoders' }],
    [`https://www.youtube.com/channel/${CH}`, { kind: 'id', value: CH }],
    [`youtube.com/channel/${CH}/videos`, { kind: 'id', value: CH }],
    ['https://youtube.com/c/SomeName', { kind: 'handle', value: 'SomeName' }],
    ['https://youtube.com/user/SomeName', { kind: 'username', value: 'SomeName' }],
  ])('parses %s', (input, expected) => {
    expect(parseChannelRef(input as string)).toEqual(expected);
  });

  it.each([
    ['', 'empty'],
    ['   ', 'blank'],
    ['https://youtube.com/watch?v=abc', 'a video url is not a channel'],
    ['https://vimeo.com/@someone', 'another host'],
    ['https://youtube.com/channel/notavalidid', 'malformed id after /channel/'],
  ])('rejects %s (%s)', (input) => {
    expect(parseChannelRef(input as string)).toBeNull();
  });
});

describe('resolveChannel', () => {
  it('returns the uploads playlist from the response, not from the id', async () => {
    const fetchImpl = jest.fn(async () => channelsReply([nomad])) as unknown as typeof fetch;
    const out = await resolveChannel('@nomadcoders', KEY, fetchImpl);
    expect(out).toEqual({
      channelId: CH,
      title: '노마드 코더',
      uploadsPlaylistId: 'UUUpJs89fSBXNolQGOYKn0YQ',
      thumbnailUrl: 'https://i/med.jpg',
    });
  });

  it('asks channels.list by handle for a handle, by id for an id', async () => {
    const urls: string[] = [];
    const fetchImpl = jest.fn(async (url: unknown) => {
      urls.push(String(url));
      return channelsReply([nomad]);
    }) as unknown as typeof fetch;

    await resolveChannel('@nomadcoders', KEY, fetchImpl);
    await resolveChannel(CH, KEY, fetchImpl);
    expect(urls[0]).toContain('forHandle=nomadcoders');
    expect(urls[1]).toContain(`id=${CH}`);
    // the uploads playlist is only in contentDetails — always request it
    expect(urls[0]).toContain('part=snippet%2CcontentDetails'.replace('%2C', ','));
  });

  it('returns null for an empty items array', async () => {
    const fetchImpl = jest.fn(async () => channelsReply([])) as unknown as typeof fetch;
    expect(await resolveChannel('@ghost', KEY, fetchImpl)).toBeNull();
  });

  it('returns null on a non-OK status without throwing', async () => {
    const fetchImpl = jest.fn(
      async () => ({ ok: false, status: 403 }) as unknown as Response
    ) as unknown as typeof fetch;
    expect(await resolveChannel('@nomadcoders', KEY, fetchImpl)).toBeNull();
  });

  it('does not call out when the input is unparseable', async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    expect(await resolveChannel('https://youtube.com/watch?v=abc', KEY, fetchImpl)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not call out when no API key is configured', async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    expect(await resolveChannel('@nomadcoders', [], fetchImpl)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('tolerates a channel with no thumbnails or uploads playlist', async () => {
    const fetchImpl = jest.fn(async () =>
      channelsReply([{ id: CH, snippet: { title: 'bare' } }])
    ) as unknown as typeof fetch;
    const out = await resolveChannel(CH, KEY, fetchImpl);
    expect(out).toMatchObject({ channelId: CH, uploadsPlaylistId: null, thumbnailUrl: null });
  });
});

describe('resolveChannelIds', () => {
  it('batches 50 at a time and keys the result by channel id', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `UC${String(i).padStart(22, 'x')}`);
    let calls = 0;
    const fetchImpl = jest.fn(async (url: unknown) => {
      calls++;
      const idParam = String(url).match(/id=([^&]+)/)?.[1] ?? '';
      const batch = idParam.split(',');
      return channelsReply(
        batch.map((id) => ({
          id,
          snippet: { title: id },
          contentDetails: { relatedPlaylists: { uploads: id.replace(/^UC/, 'UU') } },
        }))
      );
    }) as unknown as typeof fetch;

    const out = await resolveChannelIds(ids, KEY, fetchImpl);
    expect(calls).toBe(2);
    expect(out.size).toBe(51);
    expect(out.get(ids[0]!)?.uploadsPlaylistId).toBe(ids[0]!.replace(/^UC/, 'UU'));
  });

  it('drops malformed ids before spending a call', async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    const out = await resolveChannelIds(['not-an-id', ''], KEY, fetchImpl);
    expect(out.size).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('keeps the batches that succeed when one fails', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `UC${String(i).padStart(22, 'y')}`);
    let call = 0;
    const fetchImpl = jest.fn(async (url: unknown) => {
      call++;
      if (call === 1) return { ok: false, status: 500 } as unknown as Response;
      const idParam = String(url).match(/id=([^&]+)/)?.[1] ?? '';
      return channelsReply(idParam.split(',').map((id) => ({ id, snippet: { title: id } })));
    }) as unknown as typeof fetch;

    const out = await resolveChannelIds(ids, KEY, fetchImpl);
    expect(out.size).toBe(1); // only the second batch survived
  });
});
