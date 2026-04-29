/**
 * videos-bulk-upsert quality gate (CP438).
 *
 * The route registers a Fastify handler that hits Prisma; integration
 * coverage lives in prod smoke. This file exercises the in-handler
 * filter logic by invoking the same route function with a mocked Prisma
 * client. The pure-filter cases (duration / title length / blocklist /
 * batch dedupe) need no DB at all.
 */

import Fastify, { type FastifyInstance } from 'fastify';

jest.mock('@/config/internal-auth', () => ({
  getInternalBatchToken: () => 'test-token',
}));

const mockExecuteRaw = jest.fn();
const mockQueryRaw = jest.fn();
jest.mock('@/modules/database/client', () => ({
  getPrismaClient: () => ({
    $executeRaw: (...args: unknown[]) => mockExecuteRaw(...args),
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
  }),
}));

import { internalVideosBulkUpsertRoutes } from '@/api/routes/internal/videos-bulk-upsert';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(internalVideosBulkUpsertRoutes, { prefix: '/internal' });
  return app;
}

const HEADERS = { 'x-internal-token': 'test-token', 'content-type': 'application/json' };

describe('POST /internal/videos/bulk-upsert', () => {
  beforeEach(() => {
    mockQueryRaw.mockReset();
    mockExecuteRaw.mockReset();
  });

  test('rejects without internal token', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/internal/videos/bulk-upsert',
      headers: { 'content-type': 'application/json' },
      payload: { videos: [] },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  test('rejects empty videos array', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/internal/videos/bulk-upsert',
      headers: HEADERS,
      payload: { videos: [] },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  test('rejects batch >500', async () => {
    const app = await buildApp();
    const videos = Array.from({ length: 501 }, (_, i) => ({
      youtube_video_id: `id${i}`,
      title: 'a long enough title here',
      duration_seconds: 600,
    }));
    const res = await app.inject({
      method: 'POST',
      url: '/internal/videos/bulk-upsert',
      headers: HEADERS,
      payload: { videos },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  test('quality gate filters short titles + duration + blocklist + dedupe', async () => {
    mockQueryRaw.mockResolvedValue([{ inserted: true }]);
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/internal/videos/bulk-upsert',
      headers: HEADERS,
      payload: {
        videos: [
          { youtube_video_id: 'ok1', title: 'a long enough title', duration_seconds: 600 },
          { youtube_video_id: 'short', title: 'hi', duration_seconds: 600 }, // title_too_short
          { youtube_video_id: 'tooshort', title: 'normal title', duration_seconds: 30 }, // too_short
          { youtube_video_id: 'toolong', title: 'normal title', duration_seconds: 7200 }, // too_long
          { youtube_video_id: 'ad', title: '광고로 보는 신상품', duration_seconds: 600 }, // blocklist:광고
          { youtube_video_id: 'sponsor', title: 'sponsored video here', duration_seconds: 600 }, // blocklist:sponsored
          { youtube_video_id: 'dup', title: 'duplicate test title', duration_seconds: 600 },
          { youtube_video_id: 'dup', title: 'duplicate test title', duration_seconds: 600 }, // duplicate_in_batch
          { title: 'no id title', duration_seconds: 600 }, // no_video_id
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      inserted: number;
      skipped_filter: number;
      filter_breakdown: Record<string, number>;
    };
    // ok1 + dup = 2 pass to DB; mockQueryRaw returns inserted=true for both
    expect(body.inserted).toBe(2);
    expect(body.skipped_filter).toBe(7);
    expect(body.filter_breakdown).toEqual({
      title_too_short: 1,
      too_short: 1,
      too_long: 1,
      'blocklist:광고': 1,
      'blocklist:sponsored': 1,
      duplicate_in_batch: 1,
      no_video_id: 1,
    });
    await app.close();
  });

  test('counts duplicate-by-DB conflict as skipped_duplicate', async () => {
    mockQueryRaw.mockResolvedValueOnce([{ inserted: true }]).mockResolvedValueOnce([]); // conflict — RETURNING produces 0 rows on DO NOTHING
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/internal/videos/bulk-upsert',
      headers: HEADERS,
      payload: {
        videos: [
          { youtube_video_id: 'newone', title: 'fresh row title', duration_seconds: 600 },
          { youtube_video_id: 'existed', title: 'already in db', duration_seconds: 600 },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { inserted: number; skipped_duplicate: number };
    expect(body.inserted).toBe(1);
    expect(body.skipped_duplicate).toBe(1);
    await app.close();
  });

  test('duration filter not applied when duration is null/undefined', async () => {
    mockQueryRaw.mockResolvedValue([{ inserted: true }]);
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/internal/videos/bulk-upsert',
      headers: HEADERS,
      payload: {
        videos: [
          { youtube_video_id: 'noduration', title: 'a long enough title' }, // no duration → pass
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { inserted: number };
    expect(body.inserted).toBe(1);
    await app.close();
  });
});
