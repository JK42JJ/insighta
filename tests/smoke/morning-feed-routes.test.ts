import Fastify, { FastifyInstance } from 'fastify';
import { createMorningFeedRoutes } from '@/api/routes/morning-feed';
import { FEED_MAX_CARDS_PER_CELL, fetchFeed, type FeedDb } from '@/modules/morning-feed/feed';

export {};

const ENV_KEYS = ['MOBILE_MORNING_CARDS', 'MORNING_CARDS_TEST_USER_IDS'] as const;
const BASE = '/api/v1/morning-feed';
const USER = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-07T00:00:00Z');

function row(over: Record<string, unknown>) {
  return {
    cell: '비즈니스/커리어',
    focus: ['업무 실무'],
    why: '이유',
    judge_score: 3,
    video_id: 'aaaaaaaaaaa',
    title: 'T',
    channel_name: 'C',
    published_at: new Date('2026-10-30T00:00:00Z'),
    duration_seconds: 600,
    thumbnail_url: null,
    view_count: 1000,
    ...over,
  };
}

function fakeDb(rows: unknown[] = []) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const db: FeedDb = {
    $queryRawUnsafe: jest.fn(async (sql: string, ...params: unknown[]) => {
      queries.push({ sql, params });
      return rows as never;
    }),
    $executeRawUnsafe: jest.fn(async (sql: string, ...params: unknown[]) => {
      queries.push({ sql, params });
      return 1;
    }),
  };
  return { db, queries };
}

async function build(db: FeedDb): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorate('authenticate', async (request: any) => {
    request.user = { userId: USER };
  });
  await app.register(createMorningFeedRoutes({ getDb: () => db }), { prefix: BASE });
  return app;
}

describe('morning feed', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    process.env['MOBILE_MORNING_CARDS'] = 'true';
    process.env['MORNING_CARDS_TEST_USER_IDS'] = USER;
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('flag off answers 404, a non-listed account 403', async () => {
    const { db } = fakeDb();
    const app = await build(db);
    process.env['MOBILE_MORNING_CARDS'] = 'false';
    expect((await app.inject({ method: 'GET', url: `${BASE}/` })).statusCode).toBe(404);
    process.env['MOBILE_MORNING_CARDS'] = 'true';
    process.env['MORNING_CARDS_TEST_USER_IDS'] = '22222222-2222-4222-8222-222222222222';
    expect((await app.inject({ method: 'GET', url: `${BASE}/` })).statusCode).toBe(403);
    await app.close();
  });

  it('orders by judge score, then views per day, then newest; windows and duration apply', async () => {
    const rows = [
      row({ video_id: 'bbbbbbbbbbb', judge_score: 2, view_count: 999999 }),
      row({ video_id: 'aaaaaaaaaaa', judge_score: 3, view_count: 10 }),
      row({ video_id: 'ccccccccccc', judge_score: 3, view_count: 5000 }),
      // technology cell has a 30 day window: this one is 60 days old and must not appear
      row({
        video_id: 'ddddddddddd',
        cell: '기술/개발',
        published_at: new Date('2026-09-01T00:00:00Z'),
      }),
      row({
        video_id: 'eeeeeeeeeee',
        cell: '기술/개발',
        published_at: new Date('2026-10-20T00:00:00Z'),
      }),
    ];
    const { db, queries } = fakeDb(rows);
    const feed = await fetchFeed(db, USER, NOW);
    const business = feed.cards.filter((c) => c.cell === '비즈니스/커리어').map((c) => c.video_id);
    expect(business).toEqual(['ccccccccccc', 'aaaaaaaaaaa', 'bbbbbbbbbbb']);
    expect(feed.cards.filter((c) => c.cell === '기술/개발').map((c) => c.video_id)).toEqual([
      'eeeeeeeeeee',
    ]);
    // the query itself carries the duration floor, the year start and the user for "already judged"
    const first = queries[0]!;
    expect(first.params[0]).toBe(180);
    expect(first.params[2]).toBe(USER);
    expect(first.sql).toContain('canceled_at IS NULL');
  });

  it('caps each cell', async () => {
    const rows = Array.from({ length: FEED_MAX_CARDS_PER_CELL + 5 }, (_x, i) =>
      row({ video_id: String(i).padStart(11, 'x') })
    );
    const { db } = fakeDb(rows);
    const feed = await fetchFeed(db, USER, NOW);
    expect(feed.cards.length).toBe(FEED_MAX_CARDS_PER_CELL);
  });

  it('POST writes exactly one row; undo only sets the cancel marker and never deletes', async () => {
    const { db, queries } = fakeDb();
    const app = await build(db);
    const ok = await app.inject({
      method: 'POST',
      url: `${BASE}/judgments`,
      payload: { video_id: 'aaaaaaaaaaa', cell: '기술/개발', verdict: 'useful', shown_position: 2 },
    });
    expect(ok.statusCode).toBe(201);
    expect(
      queries.filter((q) => q.sql.includes('INSERT INTO public.morning_card_judgments'))
    ).toHaveLength(1);
    const bad = await app.inject({
      method: 'POST',
      url: `${BASE}/judgments`,
      payload: { video_id: 'aaaaaaaaaaa', cell: '오늘 전체', verdict: 'useful', shown_position: 0 },
    });
    expect(bad.statusCode).toBe(400);
    const undo = await app.inject({ method: 'DELETE', url: `${BASE}/judgments/last`, payload: {} });
    expect(undo.statusCode).toBe(200);
    const sqls = queries.map((q) => q.sql).join('\n');
    expect(sqls).toContain('SET canceled_at = now()');
    expect(sqls).not.toMatch(/DELETE\s+FROM/i);
    await app.close();
  });
});
