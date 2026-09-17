/**
 * The resolver the publish gates call.
 *
 * It existed only inside a verify script someone had to remember to run, so
 * the server could not run the gate that asks YouTube whether a recommended
 * video is real. These tests hold the two properties the publish path depends
 * on: no key returns null rather than a resolver that throws at call time, and
 * ids are batched at fifty so a whole issue costs one unit.
 */

import { createVideoResolver } from '@/modules/newsletter/video-resolver';

function fakeFetch(pages: Array<Record<string, unknown>>, urls: string[]): typeof fetch {
  let i = 0;
  return (async (url: string) => {
    urls.push(String(url));
    const body = pages[Math.min(i, pages.length - 1)] ?? { items: [] };
    i += 1;
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;
}

const item = (id: string, channel = 'Some Channel') => ({
  id,
  snippet: { title: `title ${id}`, channelTitle: channel },
  statistics: { viewCount: '1234' },
});

describe('createVideoResolver', () => {
  it('returns null when no key is configured, rather than a resolver that fails later', () => {
    // The publish route turns this into a refusal. A gate that cannot run is
    // not a gate that passed, and it must be able to tell the difference
    // before it starts rather than in the middle of a request.
    expect(createVideoResolver({}, fakeFetch([], []))).toBeNull();
  });

  it('reads the fields the gates compare against the page', async () => {
    const urls: string[] = [];
    const resolve = createVideoResolver(
      { YOUTUBE_API_KEY_VIDEOS: 'k' },
      fakeFetch([{ items: [item('aaaaaaaaaaa', 'Real Channel')] }], urls)
    );
    const found = await resolve!(['aaaaaaaaaaa']);

    expect(found.get('aaaaaaaaaaa')).toEqual({
      videoId: 'aaaaaaaaaaa',
      title: 'title aaaaaaaaaaa',
      channelTitle: 'Real Channel',
      viewCount: 1234,
    });
  });

  it('omits an id the API did not return, which is what the gate reports as unresolved', async () => {
    const urls: string[] = [];
    const resolve = createVideoResolver(
      { YOUTUBE_API_KEY_VIDEOS: 'k' },
      fakeFetch([{ items: [item('aaaaaaaaaaa')] }], urls)
    );
    const found = await resolve!(['aaaaaaaaaaa', 'bbbbbbbbbbb']);

    expect(found.has('aaaaaaaaaaa')).toBe(true);
    expect(found.has('bbbbbbbbbbb')).toBe(false);
  });

  it('batches at fifty ids per call', async () => {
    const urls: string[] = [];
    const ids = Array.from({ length: 51 }, (_, i) => `id${String(i).padStart(9, '0')}`);
    const resolve = createVideoResolver(
      { YOUTUBE_API_KEY_VIDEOS: 'k' },
      fakeFetch([{ items: [] }], urls)
    );
    await resolve!(ids);

    expect(urls).toHaveLength(2);
    expect(urls[0]?.split('id=')[1]?.split('&')[0]?.split(',')).toHaveLength(50);
    expect(urls[1]?.split('id=')[1]?.split('&')[0]?.split(',')).toHaveLength(1);
  });

  it('throws on an API error instead of returning an empty map', async () => {
    // An empty map reads as "none of these videos exist", which would fail
    // every pick for the wrong reason. The publish route turns the throw into
    // "try again", which is the honest answer.
    const bad = (async () => ({ ok: false, status: 503 }) as unknown as Response) as typeof fetch;
    const resolve = createVideoResolver({ YOUTUBE_API_KEY_VIDEOS: 'k' }, bad);
    await expect(resolve!(['aaaaaaaaaaa'])).rejects.toThrow('503');
  });
});
