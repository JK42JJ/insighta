import Fastify, { type FastifyInstance } from 'fastify';
import sharp from 'sharp';

import { createMorningFeedRoutes } from '@/api/routes/morning-feed';
import type { FeedDb } from '@/modules/morning-feed/feed';
import {
  AMBIENT_CACHE_TTL_MS,
  AMBIENT_FAIL_TTL_MS,
  AmbientCache,
  ambientForThumb,
  ambientFromImage,
  ambientFromPixels,
  isYouTubeThumbUrl,
  withAmbient,
} from '@/modules/morning-feed/thumb-ambient';

const THUMB = 'https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg';

function rgb(...px: Array<[number, number, number]>): Uint8Array {
  return Uint8Array.from(px.flat());
}

function channels(hex: string): [number, number, number] {
  const c = (i: number): number => parseInt(hex.slice(i, i + 2), 16);
  return [c(1), c(3), c(5)];
}

describe('watch screen ambient colour (thumbnail)', () => {
  it('only https YouTube thumbnail hosts are accepted', () => {
    expect(isYouTubeThumbUrl(THUMB)).toBe(true);
    expect(isYouTubeThumbUrl('https://img.youtube.com/vi/x/0.jpg')).toBe(true);
    expect(isYouTubeThumbUrl('http://i.ytimg.com/vi/x/0.jpg')).toBe(false);
    expect(isYouTubeThumbUrl('https://example.com/a.jpg')).toBe(false);
    expect(isYouTubeThumbUrl('https://i.ytimg.com.evil.test/a.jpg')).toBe(false);
    expect(isYouTubeThumbUrl('not a url')).toBe(false);
    expect(isYouTubeThumbUrl(null)).toBe(false);
  });

  it('saturated pixels dominate grey ones, then the colour is darkened', () => {
    // one saturated blue pixel among black and white ones: the grey pixels have zero weight
    const c = ambientFromPixels(rgb([0, 0, 0], [255, 255, 255], [40, 60, 200]), 3);
    const [r, g, b] = channels(c);
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
    // HSL lightness stays at or under 20%
    expect((Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255).toBeLessThanOrEqual(0.2 + 1 / 255);
  });

  it('an all-grey image falls back to the plain mean, darkened', () => {
    const c = ambientFromPixels(rgb([100, 100, 100], [100, 100, 100]), 3);
    const [r, g, b] = channels(c);
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(r).toBeLessThan(100);
  });

  it('decodes an encoded image', async () => {
    const png = await sharp({
      create: { width: 16, height: 9, channels: 3, background: { r: 200, g: 40, b: 40 } },
    })
      .png()
      .toBuffer();
    const [r, g, b] = channels(await ambientFromImage(png));
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
  });

  it('caches per URL; a failure is cached briefly and retried later', async () => {
    const cache = new AmbientCache();
    let now = 0;
    let calls = 0;
    const failing = async (): Promise<Buffer> => {
      calls += 1;
      throw new Error('down');
    };
    const deps = { cache, fetcher: failing, now: () => now };
    expect(await ambientForThumb(THUMB, deps)).toBeNull();
    expect(await ambientForThumb(THUMB, deps)).toBeNull();
    expect(calls).toBe(1);
    now = AMBIENT_FAIL_TTL_MS + 1;
    await ambientForThumb(THUMB, deps);
    expect(calls).toBe(2);
  });

  it('a computed colour expires after 30 days', () => {
    const cache = new AmbientCache();
    cache.set('k', '#101010', 0);
    expect(cache.get('k', AMBIENT_CACHE_TTL_MS)?.color).toBe('#101010');
    expect(cache.get('k', AMBIENT_CACHE_TTL_MS + 1)).toBeUndefined();
  });

  it('the cache drops its oldest entry at the cap', () => {
    const cache = new AmbientCache(AMBIENT_CACHE_TTL_MS, 2);
    cache.set('a', '#000001', 0);
    cache.set('b', '#000002', 0);
    cache.set('c', '#000003', 0);
    expect(cache.size).toBe(2);
    expect(cache.get('a', 0)).toBeUndefined();
  });

  it('non-YouTube URLs are never fetched', async () => {
    let calls = 0;
    const fetcher = async (): Promise<Buffer> => {
      calls += 1;
      return Buffer.alloc(0);
    };
    const out = await withAmbient(
      [{ thumbnail_url: 'https://example.com/a.jpg' }, { thumbnail_url: null }],
      { fetcher, cache: new AmbientCache() }
    );
    expect(out.map((o) => o.ambient)).toEqual([null, null]);
    expect(calls).toBe(0);
  });
});

describe('POST /watch/batch adds the ambient colour without changing the batch', () => {
  const USER = '11111111-1111-4111-8111-111111111111';
  const BASE = '/api/v1/morning-feed';
  let app: FastifyInstance;

  beforeEach(() => {
    process.env['MOBILE_MORNING_CARDS'] = 'true';
    process.env['MORNING_CARDS_TEST_USER_IDS'] = USER;
  });
  afterEach(async () => {
    await app?.close();
    delete process.env['MOBILE_MORNING_CARDS'];
    delete process.env['MORNING_CARDS_TEST_USER_IDS'];
  });

  it('each item gets the colour from addAmbient; cell, day and judged are as stored', async () => {
    const row = (video_id: string) => ({
      cell: '기술/개발',
      focus: [],
      why: '',
      judge_score: 3,
      video_id,
      title: 'T',
      channel_name: 'C',
      published_at: new Date('2026-10-30T00:00:00Z'),
      duration_seconds: 600,
      thumbnail_url: THUMB,
      view_count: 1000,
    });
    const db: FeedDb = {
      $queryRawUnsafe: jest.fn(async (sql: string, ...params: unknown[]) => {
        if (sql.includes('SELECT b.video_ids FROM public.morning_watch_batches'))
          return [{ video_ids: ['aaaaaaaaaaa', 'bbbbbbbbbbb'] }] as never;
        if (sql.includes('WITH ORDINALITY'))
          return (params[0] as string[]).map((id) => row(id)) as never;
        if (sql.includes('SELECT DISTINCT ON (j.video_id) j.video_id, j.verdict\n'))
          return [{ video_id: 'aaaaaaaaaaa', verdict: 'useful' }] as never;
        return [] as never;
      }),
      $executeRawUnsafe: jest.fn(async () => 1),
    };
    app = Fastify();
    app.decorate('authenticate', async (request: any) => {
      request.user = { userId: USER };
    });
    await app.register(
      createMorningFeedRoutes({
        getDb: () => db,
        addAmbient: async (items) => items.map((it) => ({ ...it, ambient: '#201e32' })),
      }),
      { prefix: BASE }
    );
    const res = await app.inject({
      method: 'POST',
      url: BASE + '/watch/batch',
      payload: { cell: '기술/개발' },
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.cell).toBe('기술/개발');
    expect(data.items.map((i: { video_id: string }) => i.video_id)).toEqual([
      'aaaaaaaaaaa',
      'bbbbbbbbbbb',
    ]);
    expect(data.judged).toEqual({ aaaaaaaaaaa: 'useful' });
    for (const it of data.items) expect(it.ambient).toBe('#201e32');
    // the batch was read, never written
    expect(db.$executeRawUnsafe).not.toHaveBeenCalled();
  });
});
