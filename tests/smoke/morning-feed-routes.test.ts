import Fastify, { FastifyInstance } from 'fastify';
import { createMorningFeedRoutes } from '@/api/routes/morning-feed';
import {
  FEED_HISTORY_MAX,
  FEED_MAX_CARDS_PER_CELL,
  fetchFeed,
  fetchHistory,
  fetchInsight,
  fetchWatchInsight,
  fetchWatchTodayBatches,
  getOrCreateWatchBatch,
  recordWatch,
  FeedValidationError,
  WATCH_CANDIDATE_SOURCE,
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

  it('fetchInsight with a cell filters in SQL with a parameter; without one the query is unchanged', async () => {
    const { db, queries } = fakeDb([]);
    await fetchInsight(db, USER, NOW, { cell: '학습/교육' });
    expect(queries[0]!.sql).toContain('AND j.cell = $4');
    expect(queries[0]!.sql).not.toContain('학습/교육');
    expect(queries[0]!.params).toHaveLength(4);
    expect(queries[0]!.params[3]).toBe('학습/교육');
    await fetchInsight(db, USER, NOW);
    expect(queries[1]!.sql).not.toContain('j.cell = $');
    expect(queries[1]!.params).toHaveLength(3);
    await expect(fetchInsight(db, USER, NOW, { cell: '오늘 전체' })).rejects.toBeInstanceOf(
      FeedValidationError
    );
    expect(queries).toHaveLength(2);
  });

  it('GET /insight?cell= passes a known cell, answers 400 for an unknown one, no cell = all cells', async () => {
    const { db, queries } = fakeDb([]);
    const app = await build(db);
    const ok = await app.inject({
      method: 'GET',
      url: `${BASE}/insight?cell=${encodeURIComponent('기술/개발')}`,
    });
    expect(ok.statusCode).toBe(200);
    expect(queries[0]!.params[3]).toBe('기술/개발');
    for (const bad of ['없는칸', '오늘 전체', '']) {
      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/insight?cell=${encodeURIComponent(bad)}`,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('invalid_insight');
    }
    expect(queries).toHaveLength(1);
    const all = await app.inject({ method: 'GET', url: `${BASE}/insight` });
    expect(all.statusCode).toBe(200);
    expect(queries[1]!.params).toHaveLength(3);
    expect(queries[1]!.sql).not.toContain('j.cell = $');
    await app.close();
  });

  it('GET answers watch_today: distinct videos judged today per goal cell (KST day, live, latest per video)', async () => {
    const judged = [
      { video_id: 'aaaaaaaaaaa', cell: '기술/개발' },
      { video_id: 'bbbbbbbbbbb', cell: '기술/개발' },
      { video_id: 'ccccccccccc', cell: '학습/교육' },
      { video_id: 'ddddddddddd', cell: '오늘 전체' },
      { video_id: 'eeeeeeeeeee', cell: '없는칸' },
    ];
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const db: FeedDb = {
      $queryRawUnsafe: jest.fn(async (sql: string, ...params: unknown[]) => {
        queries.push({ sql, params });
        return (
          sql.includes('morning_feed_annotations') ? [row({ video_id: 'fffffffffff' })] : judged
        ) as never;
      }),
      $executeRawUnsafe: jest.fn(async () => 1),
    };
    // 2026-11-07T20:00Z is already 11-08 in KST
    const feed = await fetchFeed(db, USER, new Date('2026-11-07T20:00:00Z'));
    expect(feed.watch_today['기술/개발']).toBe(2);
    expect(feed.watch_today['학습/교육']).toBe(1);
    expect(feed.watch_today['건강/피트니스']).toBe(0);
    expect(Object.keys(feed.watch_today)).toHaveLength(8);
    expect('오늘 전체' in feed.watch_today).toBe(false);
    const q = queries.find((x) => !x.sql.includes('morning_feed_annotations'))!;
    expect(q.sql).toContain('DISTINCT ON (j.video_id)');
    expect(q.sql).toContain('j.canceled_at IS NULL');
    expect(q.sql).toContain('j.cell IS NOT NULL');
    expect(q.sql).not.toContain('verdict');
    expect(q.params).toEqual([
      USER,
      new Date('2026-11-07T15:00:00Z'),
      new Date('2026-11-08T15:00:00Z'),
    ]);
    // the existing fields are unchanged
    expect(feed.watch_daily).toBe(WATCH_DAILY_VIDEOS);
    expect(feed.cards.map((c) => c.video_id)).toEqual(['fffffffffff']);
    const app = await build(db);
    const res = await app.inject({ method: 'GET', url: `${BASE}/` });
    expect(res.json().data.watch_today['기술/개발']).toBe(2);
    await app.close();
  });

  it('fetchHistory: one row per goal from watch batches before today (KST), parameterised, newest first, max 5', async () => {
    const rows = [
      { cell: '학습/교육', day: '2026-11-07', count: 3 },
      { cell: '기술/개발', day: '2026-10-28', count: BigInt(5) },
      { cell: '없는칸', day: '2026-10-20', count: 1 },
    ];
    const { db, queries } = fakeDb(rows);
    // 2026-11-07T20:00Z is 11-08 in KST
    const history = await fetchHistory(db, USER, new Date('2026-11-07T20:00:00Z'));
    expect(history).toEqual([
      { cell: '학습/교육', day: '2026-11-07', count: 3 },
      { cell: '기술/개발', day: '2026-10-28', count: 5 },
    ]);
    expect(queries).toHaveLength(1);
    const q = queries[0]!;
    // batches only: the swipe deck's judgments never reach 이전 주제
    expect(q.sql).toContain('public.morning_watch_batches');
    expect(q.sql).not.toContain('morning_card_judgments');
    expect(q.sql).toContain('DISTINCT ON (b.cell)');
    expect(q.sql).toContain('cardinality(b.video_ids)');
    expect(q.sql).toContain('b.day < $3::date');
    expect(q.sql).toContain('LIMIT $4');
    expect(q.sql).not.toContain(USER);
    expect(q.params[0]).toBe(USER);
    expect(q.params[1]).toHaveLength(8);
    expect(q.params[1]).not.toContain('오늘 전체');
    expect(q.params[2]).toBe('2026-11-08');
    expect(q.params[3]).toBe(FEED_HISTORY_MAX);
    expect(FEED_HISTORY_MAX).toBe(5);
    await expect(fetchHistory(db, '', NOW)).rejects.toThrow(FeedValidationError);
  });

  it('GET /history answers the rows; 401 without a user, 403 non test user, 404 flag off', async () => {
    const { db } = fakeDb([{ cell: '기술/개발', day: '2026-10-28', count: 12 }]);
    const app = await build(db);
    const ok = await app.inject({ method: 'GET', url: `${BASE}/history` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({
      status: 'ok',
      data: [{ cell: '기술/개발', day: '2026-10-28', count: 12 }],
    });
    process.env['MORNING_CARDS_TEST_USER_IDS'] = '22222222-2222-4222-8222-222222222222';
    expect((await app.inject({ method: 'GET', url: `${BASE}/history` })).statusCode).toBe(403);
    process.env['MOBILE_MORNING_CARDS'] = 'false';
    expect((await app.inject({ method: 'GET', url: `${BASE}/history` })).statusCode).toBe(404);
    await app.close();

    process.env['MOBILE_MORNING_CARDS'] = 'true';
    process.env['MORNING_CARDS_TEST_USER_IDS'] = USER;
    const anon = Fastify();
    anon.decorate('authenticate', async () => undefined);
    await anon.register(createMorningFeedRoutes({ getDb: () => db }), { prefix: BASE });
    expect((await anon.inject({ method: 'GET', url: `${BASE}/history` })).statusCode).toBe(401);
    await anon.close();
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

  it('POST /judgments: surface "watch" is stored, absent is NULL, anything else 400', async () => {
    const { db, queries } = fakeDb();
    const app = await build(db);
    const base = {
      video_id: 'aaaaaaaaaaa',
      cell: '기술/개발',
      verdict: 'useful',
      shown_position: 0,
    };
    const inserts = () =>
      queries.filter((q) => q.sql.includes('INSERT INTO public.morning_card_judgments'));
    expect(
      (await app.inject({ method: 'POST', url: `${BASE}/judgments`, payload: base })).statusCode
    ).toBe(201);
    expect(inserts()[0]!.sql).toContain('surface');
    expect(inserts()[0]!.params[5]).toBeNull();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `${BASE}/judgments`,
          payload: { ...base, surface: 'watch' },
        })
      ).statusCode
    ).toBe(201);
    expect(inserts()[1]!.params[5]).toBe('watch');
    for (const surface of ['deck', '', null, 1, ['watch']]) {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/judgments`,
        payload: { ...base, surface },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('invalid_judgment');
    }
    expect(inserts()).toHaveLength(2);
    // undo is unchanged: latest live feed judgment of any surface
    await app.inject({ method: 'DELETE', url: `${BASE}/judgments/last`, payload: {} });
    const undo = queries.find((q) => q.sql.includes('SET canceled_at = now()'))!;
    expect(undo.sql).not.toContain('surface');
    await app.close();
  });

  /** A fake db that answers by SQL shape, so one call can read several tables. */
  function scriptedDb(answer: (sql: string, params: unknown[]) => unknown[]) {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const db: FeedDb = {
      $queryRawUnsafe: jest.fn(async (sql: string, ...params: unknown[]) => {
        queries.push({ sql, params });
        return answer(sql, params) as never;
      }),
      $executeRawUnsafe: jest.fn(async (sql: string, ...params: unknown[]) => {
        queries.push({ sql, params });
        return 1;
      }),
    };
    return { db, queries };
  }
  const isBatchRead = (sql: string) =>
    sql.includes('SELECT b.video_ids FROM public.morning_watch_batches');
  const isCandidates = (sql: string) =>
    sql.includes('SELECT a.video_id') && sql.includes('LIMIT $5');
  const isCards = (sql: string) => sql.includes('WITH ORDINALITY');
  const isVerdicts = (sql: string) =>
    sql.includes('SELECT DISTINCT ON (j.video_id) j.video_id, j.verdict\n');
  // 2026-11-07T20:00Z is 11-08 in KST
  const LATE = new Date('2026-11-07T20:00:00Z');

  it('watch batch: creates from review_v3 gate-passed candidates, ON CONFLICT DO NOTHING, then re-reads', async () => {
    let stored: string[] | null = null;
    const { db, queries } = scriptedDb((sql, params) => {
      if (isBatchRead(sql)) return stored ? [{ video_ids: stored }] : [];
      if (isCandidates(sql)) return [{ video_id: 'bbbbbbbbbbb' }, { video_id: 'aaaaaaaaaaa' }];
      if (isCards(sql))
        return (params[0] as string[]).map((id) => row({ video_id: id, cell: '기술/개발' }));
      if (isVerdicts(sql)) return [{ video_id: 'bbbbbbbbbbb', verdict: 'useful' }];
      return [];
    });
    (db.$executeRawUnsafe as jest.Mock).mockImplementation(
      async (sql: string, ...params: unknown[]) => {
        queries.push({ sql, params });
        stored = params[3] as string[];
        return 1;
      }
    );
    const batch = await getOrCreateWatchBatch(db, USER, '기술/개발', LATE);
    expect(batch.day).toBe('2026-11-08');
    expect(batch.cell).toBe('기술/개발');
    expect(batch.items.map((c) => c.video_id)).toEqual(['bbbbbbbbbbb', 'aaaaaaaaaaa']);
    expect(batch.judged).toEqual({ bbbbbbbbbbb: 'useful' });
    const cand = queries.find((q) => isCandidates(q.sql))!;
    expect(cand.sql).toContain('a.source = $3');
    expect(cand.sql).toContain('a.why IS NOT NULL');
    expect(cand.sql).toContain('v.is_active = true');
    expect(cand.sql).toContain('v.duration_seconds >= $2');
    expect(cand.sql).toContain('ORDER BY a.judge_score DESC NULLS LAST, a.video_id');
    // any live judgment (any surface) and any earlier batch exclude a video
    expect(cand.sql).toContain('j.canceled_at IS NULL');
    expect(cand.sql).not.toContain('j.surface');
    expect(cand.sql).toContain('a.video_id = ANY(b.video_ids)');
    expect(cand.params).toEqual([
      USER,
      180,
      WATCH_CANDIDATE_SOURCE,
      '기술/개발',
      WATCH_DAILY_VIDEOS,
    ]);
    expect(WATCH_CANDIDATE_SOURCE).toBe('review_v3');
    const insert = queries.find((q) => q.sql.includes('INSERT INTO public.morning_watch_batches'))!;
    expect(insert.sql).toContain('ON CONFLICT (user_id, day, cell) DO NOTHING');
    expect(insert.params).toEqual([
      USER,
      '2026-11-08',
      '기술/개발',
      ['bbbbbbbbbbb', 'aaaaaaaaaaa'],
    ]);
    expect(queries.filter((q) => isBatchRead(q.sql))).toHaveLength(2);
    const verdicts = queries.find((q) => isVerdicts(q.sql))!;
    expect(verdicts.sql).toContain('j.surface = $2');
    expect(verdicts.params).toEqual([USER, 'watch', ['bbbbbbbbbbb', 'aaaaaaaaaaa']]);
  });

  it('watch batch: an existing batch is returned as stored (no candidates read, no insert)', async () => {
    const { db, queries } = scriptedDb((sql, params) => {
      if (isBatchRead(sql)) return [{ video_ids: ['ccccccccccc', 'aaaaaaaaaaa'] }];
      if (isCards(sql)) return (params[0] as string[]).map((id) => row({ video_id: id }));
      return [];
    });
    const batch = await getOrCreateWatchBatch(db, USER, '비즈니스/커리어', LATE);
    expect(batch.items.map((c) => c.video_id)).toEqual(['ccccccccccc', 'aaaaaaaaaaa']);
    expect(batch.judged).toEqual({});
    expect(queries.some((q) => isCandidates(q.sql))).toBe(false);
    expect(queries.some((q) => q.sql.includes('INSERT'))).toBe(false);
    expect(queries[0]!.params).toEqual([USER, '2026-11-08', '비즈니스/커리어']);
  });

  it('watch batch race: a concurrent insert wins, the stored row is answered', async () => {
    let reads = 0;
    const { db, queries } = scriptedDb((sql, params) => {
      if (isBatchRead(sql)) {
        reads += 1;
        // first read: none yet; after our (no-op) insert: the other request's row
        return reads === 1 ? [] : [{ video_ids: ['ddddddddddd'] }];
      }
      if (isCandidates(sql)) return [{ video_id: 'aaaaaaaaaaa' }];
      if (isCards(sql)) return (params[0] as string[]).map((id) => row({ video_id: id }));
      return [];
    });
    (db.$executeRawUnsafe as jest.Mock).mockImplementation(
      async (sql: string, ...params: unknown[]) => {
        queries.push({ sql, params });
        return 0; // ON CONFLICT DO NOTHING: no row inserted
      }
    );
    const batch = await getOrCreateWatchBatch(db, USER, '비즈니스/커리어', LATE);
    expect(batch.items.map((c) => c.video_id)).toEqual(['ddddddddddd']);
  });

  it('watch batch: no candidates -> items [] and nothing stored; bad cell rejected', async () => {
    const { db, queries } = scriptedDb(() => []);
    const batch = await getOrCreateWatchBatch(db, USER, '창작/예술', LATE);
    expect(batch).toEqual({ cell: '창작/예술', day: '2026-11-08', items: [], judged: {} });
    expect(queries.some((q) => q.sql.includes('INSERT'))).toBe(false);
    await expect(getOrCreateWatchBatch(db, USER, '오늘 전체', LATE)).rejects.toBeInstanceOf(
      FeedValidationError
    );
  });

  it('POST /watch/batch: 200 with the batch, 400 for the centre or an unknown cell, gated', async () => {
    const { db } = scriptedDb((sql) =>
      isBatchRead(sql) ? [{ video_ids: ['aaaaaaaaaaa'] }] : isCards(sql) ? [row({})] : []
    );
    const app = await build(db);
    const ok = await app.inject({
      method: 'POST',
      url: `${BASE}/watch/batch`,
      payload: { cell: '비즈니스/커리어' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.items[0].video_id).toBe('aaaaaaaaaaa');
    for (const cell of ['오늘 전체', '없는칸', undefined, 3]) {
      const res = await app.inject({
        method: 'POST',
        url: `${BASE}/watch/batch`,
        payload: { cell },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('invalid_batch');
    }
    process.env['MORNING_CARDS_TEST_USER_IDS'] = '22222222-2222-4222-8222-222222222222';
    const forbidden = await app.inject({
      method: 'POST',
      url: `${BASE}/watch/batch`,
      payload: { cell: '기술/개발' },
    });
    expect(forbidden.statusCode).toBe(403);
    process.env['MOBILE_MORNING_CARDS'] = 'false';
    expect((await app.inject({ method: 'GET', url: `${BASE}/watch/today` })).statusCode).toBe(404);
    await app.close();
  });

  it("watch today: issued/judged from today's batches, available (capped) only where no batch", async () => {
    const { db, queries } = scriptedDb((sql) => {
      if (sql.includes('AS issued'))
        return [
          { cell: '기술/개발', issued: 5, judged: 5 },
          { cell: '학습/교육', issued: 3, judged: BigInt(1) },
        ];
      if (sql.includes('AS available'))
        return [
          { cell: '기술/개발', available: 9 },
          { cell: '재테크/투자', available: 12 },
          { cell: '건강/피트니스', available: 2 },
        ];
      return [];
    });
    const t = await fetchWatchTodayBatches(db, USER, LATE);
    expect(t.day).toBe('2026-11-08');
    expect(t.daily).toBe(WATCH_DAILY_VIDEOS);
    expect(Object.keys(t.today)).toHaveLength(8);
    expect('오늘 전체' in t.today).toBe(false);
    expect(t.today['기술/개발']).toEqual({ issued: 5, judged: 5, available: 0 });
    expect(t.today['학습/교육']).toEqual({ issued: 3, judged: 1, available: 0 });
    expect(t.today['재테크/투자']).toEqual({ issued: null, judged: 0, available: 5 });
    expect(t.today['건강/피트니스']).toEqual({ issued: null, judged: 0, available: 2 });
    expect(t.today['창작/예술']).toEqual({ issued: null, judged: 0, available: 0 });
    const issued = queries.find((q) => q.sql.includes('AS issued'))!;
    expect(issued.sql).toContain('j.surface = $3');
    expect(issued.sql).toContain('b.day = $2::date');
    expect(issued.params).toEqual([USER, '2026-11-08', 'watch']);
    const avail = queries.find((q) => q.sql.includes('AS available'))!;
    expect(avail.sql).toContain('a.source = $3');
    expect(avail.sql).toContain('a.cell = ANY($4::text[])');
    expect(avail.params.slice(0, 3)).toEqual([USER, 180, 'review_v3']);
    expect(avail.params[3]).toHaveLength(8);
    const app = await build(db);
    const res = await app.inject({ method: 'GET', url: `${BASE}/watch/today` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.today['재테크/투자'].available).toBe(5);
    await app.close();
  });

  it("watch insight: only today's batch and watch-surface judgments; received = batch size", async () => {
    const at = (m: number) => new Date(Date.UTC(2026, 10, 7, 21, m));
    const ids = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd', 'eeeeeeeeeee'];
    const judged = (video_id: string, verdict: string, m: number, watched: number | null) => ({
      video_id,
      verdict,
      cell: '기술/개발',
      created_at: at(m),
      title: video_id.slice(0, 1),
      duration_seconds: 600,
      watched_seconds: watched,
    });
    const { db, queries } = scriptedDb((sql) => {
      if (isBatchRead(sql)) return [{ video_ids: ids }];
      return [
        judged('aaaaaaaaaaa', 'useful', 1, 300),
        judged('bbbbbbbbbbb', 'pass', 2, 40),
        judged('ccccccccccc', 'skip', 3, null),
      ];
    });
    const res = await fetchWatchInsight(db, USER, '기술/개발', LATE);
    expect(res.received).toBe(5);
    expect(res).toMatchObject({ reacted: 2, liked: 1, disliked: 1, passed: 1 });
    // the passed video's 40 seconds are not counted
    expect(res.watched_seconds_total).toBe(300);
    const q = queries.find((x) => x.sql.includes('morning_feed_watch'))!;
    expect(q.sql).toContain('j.surface = $2');
    expect(q.sql).toContain('j.video_id = ANY($3::text[])');
    expect(q.sql).toContain('j.canceled_at IS NULL');
    expect(q.params).toEqual([USER, 'watch', ids]);
    expect(queries[0]!.params).toEqual([USER, '2026-11-08', '기술/개발']);
    // no batch today: all zero, no judgment read
    const none = scriptedDb(() => []);
    const empty = await fetchWatchInsight(none.db, USER, '기술/개발', LATE);
    expect(empty).toMatchObject({
      received: 0,
      reacted: 0,
      passed: 0,
      watched_seconds_total: null,
    });
    expect(none.queries).toHaveLength(1);
    await expect(fetchWatchInsight(none.db, USER, '오늘 전체', LATE)).rejects.toBeInstanceOf(
      FeedValidationError
    );
  });

  it('GET /watch/insight?cell=: 200 for a goal, 400 otherwise; the deck /insight is unchanged', async () => {
    const { db, queries } = scriptedDb(() => []);
    const app = await build(db);
    const ok = await app.inject({
      method: 'GET',
      url: `${BASE}/watch/insight?cell=${encodeURIComponent('기술/개발')}`,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.received).toBe(0);
    for (const bad of ['없는칸', '오늘 전체', '']) {
      const res = await app.inject({
        method: 'GET',
        url: `${BASE}/watch/insight?cell=${encodeURIComponent(bad)}`,
      });
      expect(res.statusCode).toBe(400);
    }
    const noCell = await app.inject({ method: 'GET', url: `${BASE}/watch/insight` });
    expect(noCell.statusCode).toBe(400);
    const before = queries.length;
    await app.inject({ method: 'GET', url: `${BASE}/insight` });
    const deck = queries[before]!;
    expect(deck.sql).not.toContain('surface');
    expect(deck.sql).not.toContain('morning_watch_batches');
    await app.close();
  });
});
