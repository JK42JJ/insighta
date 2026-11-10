import Fastify, { FastifyInstance } from 'fastify';
import { createMorningFeedRoutes } from '@/api/routes/morning-feed';
import {
  FEED_MAX_CARDS_PER_CELL,
  fetchFeed,
  fetchInsight,
  recordWatch,
  FeedValidationError,
  WATCH_DAILY_VIDEOS,
  type FeedDb,
} from '@/modules/morning-feed/feed';

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

  it('GET answers the per-day watch count decided by the server (additive field)', async () => {
    expect(WATCH_DAILY_VIDEOS).toBe(5);
    const { db } = fakeDb([row({ video_id: 'aaaaaaaaaaa' })]);
    expect((await fetchFeed(db, USER, NOW)).watch_daily).toBe(WATCH_DAILY_VIDEOS);
    const app = await build(db);
    const res = await app.inject({ method: 'GET', url: `${BASE}/` });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.watch_daily).toBe(WATCH_DAILY_VIDEOS);
    // the existing fields are unchanged
    expect(Array.isArray(data.cells)).toBe(true);
    expect(data.cards.map((c: { video_id: string }) => c.video_id)).toEqual(['aaaaaaaaaaa']);
    await app.close();
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
    for (const verdict of ['skip', 'pass']) {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/judgments`,
        payload: { video_id: 'aaaaaaaaaaa', cell: '기술/개발', verdict, shown_position: 1 },
      });
      expect(res.statusCode).toBe(201);
    }
    const unknown = await app.inject({
      method: 'POST',
      url: `${BASE}/judgments`,
      payload: { video_id: 'aaaaaaaaaaa', cell: '기술/개발', verdict: 'love', shown_position: 1 },
    });
    expect(unknown.statusCode).toBe(400);
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

  it('attaches info only when known, falls back to the rich-summary one-liner, ignores expired rows', async () => {
    const rows = [
      row({ video_id: 'aaaaaaaaaaa' }),
      row({
        video_id: 'bbbbbbbbbbb',
        info_one_liner: 'one line',
        info_reason: 'a\nb',
        info_audio_language: 'ko',
        info_link_count: 2,
        info_chapters: [
          { sec: 0, title: 'Intro' },
          { sec: 'x', title: 'bad' },
        ],
      }),
      row({ video_id: 'ccccccccccc', info_one_liner: 'from rich summary' }),
    ];
    const { db, queries } = fakeDb(rows);
    const feed = await fetchFeed(db, USER, NOW);
    const by = (id: string) => feed.cards.find((c) => c.video_id === id)!;
    expect(by('aaaaaaaaaaa').info).toBeUndefined();
    expect('info' in by('aaaaaaaaaaa')).toBe(false);
    expect(by('bbbbbbbbbbb').info).toEqual({
      one_liner: 'one line',
      reason: 'a\nb',
      audio_language: 'ko',
      link_count: 2,
      chapters: [{ sec: 0, title: 'Intro' }],
    });
    expect(by('ccccccccccc').info).toEqual({ one_liner: 'from rich summary' });
    const sql = queries[0]!.sql;
    expect(sql).toContain('i.expires_at > now()');
    expect(sql).toContain('public.video_rich_summaries');
    expect(sql).toContain("NULLIF(r.one_liner, '')");
  });

  it('recordWatch validates and upserts with GREATEST', async () => {
    const { db, queries } = fakeDb();
    await recordWatch(db, USER, {
      video_id: 'aaaaaaaaaaa',
      watched_seconds: 30,
      last_position: 12,
    });
    expect(queries[0]!.sql).toContain('GREATEST');
    expect(queries[0]!.params).toEqual([USER, 'aaaaaaaaaaa', 30, 12]);
    const bad = [
      { video_id: 'short', watched_seconds: 1, last_position: 1 },
      { video_id: 'aaaaaaaaaaa', watched_seconds: -1, last_position: 1 },
      { video_id: 'aaaaaaaaaaa', watched_seconds: 1.5, last_position: 1 },
      { video_id: 'aaaaaaaaaaa', watched_seconds: 86401, last_position: 1 },
      { video_id: 'aaaaaaaaaaa', watched_seconds: 1, last_position: -5 },
    ];
    for (const input of bad) {
      await expect(recordWatch(db, USER, input)).rejects.toBeInstanceOf(FeedValidationError);
    }
    expect(queries).toHaveLength(1);
  });

  it('fetchInsight aggregates counts, keeps unknown watch time null and orders cells', async () => {
    const at = (m: number) => new Date(Date.UTC(2026, 10, 7, 1, m));
    const rows = [
      {
        video_id: 'bbbbbbbbbbb',
        verdict: 'skip',
        cell: '학습/교육',
        created_at: at(2),
        title: 'B',
        duration_seconds: 300,
        watched_seconds: null,
      },
      {
        video_id: 'aaaaaaaaaaa',
        verdict: 'useful',
        cell: '기술/개발',
        created_at: at(1),
        title: 'A',
        duration_seconds: 600,
        watched_seconds: 120,
      },
      {
        video_id: 'ccccccccccc',
        verdict: 'pass',
        cell: '기술/개발',
        created_at: at(3),
        title: 'C',
        duration_seconds: 400,
        watched_seconds: 50,
      },
      {
        video_id: 'ddddddddddd',
        verdict: 'useful',
        cell: '학습/교육',
        created_at: at(4),
        title: 'D',
        duration_seconds: 500,
        watched_seconds: 30,
      },
      {
        video_id: 'eeeeeeeeeee',
        verdict: 'useful',
        cell: '재테크/투자',
        created_at: at(5),
        title: 'E',
        duration_seconds: 500,
        watched_seconds: null,
      },
    ];
    const { db, queries } = fakeDb(rows);
    // 2026-11-07T20:00Z is already 11-08 in KST
    const res = await fetchInsight(db, USER, new Date('2026-11-07T20:00:00Z'));
    expect(res.date_kst).toBe('2026-11-08');
    expect(queries[0]!.params[1]).toEqual(new Date('2026-11-07T15:00:00Z'));
    expect(queries[0]!.params[2]).toEqual(new Date('2026-11-08T15:00:00Z'));
    expect(queries[0]!.sql).toContain('canceled_at IS NULL');
    expect(res).toMatchObject({ reacted: 4, liked: 3, disliked: 1, passed: 1 });
    expect(res.watched_seconds_total).toBe(150);
    expect(res.has_watch_data).toBe(true);
    expect(res.by_cell).toEqual([
      { cell: '기술/개발', count: 1, watched_seconds: 120 },
      { cell: '학습/교육', count: 2, watched_seconds: 30 },
      { cell: '재테크/투자', count: 1, watched_seconds: null },
    ]);
    expect(res.order.map((o) => o.video_id)).toEqual([
      'aaaaaaaaaaa',
      'bbbbbbbbbbb',
      'ccccccccccc',
      'ddddddddddd',
      'eeeeeeeeeee',
    ]);
    expect(res.order[1]!.watched_seconds).toBeNull();
  });

  it('fetchInsight reports null totals without watch rows', async () => {
    const { db } = fakeDb([
      {
        video_id: 'aaaaaaaaaaa',
        verdict: 'useful',
        cell: '기술/개발',
        created_at: NOW,
        title: 'A',
        duration_seconds: 60,
        watched_seconds: null,
      },
    ]);
    const res = await fetchInsight(db, USER, NOW);
    expect(res.watched_seconds_total).toBeNull();
    expect(res.has_watch_data).toBe(false);
  });

  it('new endpoints: 404 flag off, 403 non test user, watch 400 on bad input', async () => {
    const { db } = fakeDb();
    const app = await build(db);
    const watch = { video_id: 'aaaaaaaaaaa', watched_seconds: 5, last_position: 5 };
    expect(
      (await app.inject({ method: 'POST', url: `${BASE}/watch`, payload: watch })).statusCode
    ).toBe(201);
    expect(
      (await app.inject({ method: 'POST', url: `${BASE}/watch`, payload: { video_id: 'x' } }))
        .statusCode
    ).toBe(400);
    const insight = await app.inject({ method: 'GET', url: `${BASE}/insight` });
    expect(insight.statusCode).toBe(200);
    expect(insight.json().data.reacted).toBe(0);
    process.env['MORNING_CARDS_TEST_USER_IDS'] = '22222222-2222-4222-8222-222222222222';
    expect((await app.inject({ method: 'GET', url: `${BASE}/insight` })).statusCode).toBe(403);
    expect(
      (await app.inject({ method: 'POST', url: `${BASE}/watch`, payload: watch })).statusCode
    ).toBe(403);
    process.env['MOBILE_MORNING_CARDS'] = 'false';
    expect((await app.inject({ method: 'GET', url: `${BASE}/insight` })).statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'POST', url: `${BASE}/watch`, payload: watch })).statusCode
    ).toBe(404);
    await app.close();
  });
});
