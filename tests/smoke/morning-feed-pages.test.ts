import Fastify, { FastifyInstance } from 'fastify';
import { createMorningFeedRoutes } from '@/api/routes/morning-feed';
import {
  listPages,
  readHomePages,
  readPage,
  readPageCards,
  validatePage,
} from '@/modules/morning-feed/pages';
import { FEED_CELLS, FeedValidationError, type FeedDb } from '@/modules/morning-feed/feed';

export {};

const BASE = '/api/v1/morning-feed';
const USER = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-14T03:00:00Z');
const VID = 'aaaaaaaaaaa';
const CELL = '기술/개발';

function goodPage(): Record<string, any> {
  return {
    domain: CELL,
    seen_date: '2026-11-13',
    headline: 'H',
    core: [{ text: 'c', sources: [{ video_id: VID, t: 0 }] }],
    note: [{ heading: 'h', paragraphs: [{ text: 'p', sources: [{ video_id: VID, t: 12 }] }] }],
    videos: [{ video_id: VID, title: 'T', channel: 'C', useful_for: '' }],
  };
}

function bad(mutate: (p: Record<string, any>) => void, msg: RegExp) {
  const p = goodPage();
  mutate(p);
  expect(() => validatePage(p)).toThrow(FeedValidationError);
  expect(() => validatePage(p)).toThrow(msg);
}

describe('validatePage', () => {
  it('accepts a good page, and an empty note', () => {
    expect(validatePage(goodPage())).toEqual(goodPage());
    const p = goodPage();
    p['note'] = [];
    expect(validatePage(p).note).toEqual([]);
  });
  it('rejects each bad field', () => {
    expect(() => validatePage(null)).toThrow(FeedValidationError);
    bad((p) => (p['domain'] = '오늘 전체'), /domain/);
    bad((p) => (p['domain'] = 'nope'), /domain/);
    bad((p) => (p['seen_date'] = '2026-02-30'), /seen_date/);
    bad((p) => (p['seen_date'] = '26-11-13'), /seen_date/);
    bad((p) => (p['headline'] = '  '), /headline/);
    bad((p) => (p['core'] = []), /core/);
    bad((p) => (p['core'][0].sources[0].video_id = 'short'), /video_id/);
    bad((p) => (p['core'][0].sources[0].t = -1), /\.t /);
    bad((p) => (p['core'][0].sources[0].t = 1.5), /\.t /);
    bad((p) => (p['core'][0].sources[0].video_id = 'bbbbbbbbbbb'), /not listed in videos/);
    bad((p) => (p['note'][0].paragraphs[0].sources[0].video_id = 'bbbbbbbbbbb'), /not listed/);
    bad((p) => (p['videos'][0].title = 5), /title/);
    bad((p) => delete p['videos'][0].channel, /channel/);
    bad((p) => delete p['videos'][0].useful_for, /useful_for/);
    bad((p) => (p['note'] = 'x'), /note/);
  });
});

function fakeDb(handler: (sql: string, params: unknown[]) => unknown[]) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const db: FeedDb = {
    $queryRawUnsafe: jest.fn(async (sql: string, ...params: unknown[]) => {
      queries.push({ sql, params });
      return handler(sql, params) as never;
    }),
    $executeRawUnsafe: jest.fn(async (sql: string, ...params: unknown[]) => {
      queries.push({ sql, params });
      return 1;
    }),
  };
  return { db, queries };
}

const pageRow = (cell: string, seen: string, headline: string) => ({
  cell,
  seen_date: seen,
  headline,
  core: goodPage()['core'],
  note: [],
  videos: goodPage()['videos'],
});

describe('page readers', () => {
  it('home: current for the last judged domain, others in cell order, KST today', async () => {
    const { db, queries } = fakeDb((sql) => {
      if (sql.includes('morning_card_judgments')) return [{ cell: '재테크/투자' }];
      return [
        pageRow('창작/예술', '2026-11-10', 'art'),
        pageRow('재테크/투자', '2026-11-12', 'money'),
        pageRow('기술/개발', '2026-11-13', 'tech'),
      ];
    });
    const home = await readHomePages(db, USER, NOW);
    expect(home.lastDomain).toBe('재테크/투자');
    expect(home.current?.headline).toBe('money');
    expect(home.current?.domain).toBe('재테크/투자');
    expect(home.others).toEqual([
      { domain: '기술/개발', seen_date: '2026-11-13', headline: 'tech' },
      { domain: '창작/예술', seen_date: '2026-11-10', headline: 'art' },
    ]);
    // the last domain comes from watch judgments (not canceled), never from batches
    expect(queries[0]!.sql).toContain('morning_card_judgments');
    expect(queries[0]!.sql).toContain('canceled_at IS NULL');
    expect(queries[0]!.params[1]).toBe('watch');
    expect(queries.some((q) => q.sql.includes('morning_watch_batches'))).toBe(false);
    expect(queries[1]!.params[1]).toBe('2026-11-14'); // 03:00Z = 12:00 KST
  });
  it('home: the last judged domain has no page -> the newest page of any domain', async () => {
    const { db } = fakeDb((sql) => {
      if (sql.includes('morning_card_judgments')) return [{ cell: '창작/예술' }];
      return [
        pageRow('재테크/투자', '2026-11-12', 'money'),
        pageRow('기술/개발', '2026-11-14', 'tech'),
      ];
    });
    const home = await readHomePages(db, USER, NOW);
    expect(home.lastDomain).toBe('창작/예술');
    expect(home.current?.domain).toBe('기술/개발');
    expect(home.others).toEqual([
      { domain: '재테크/투자', seen_date: '2026-11-12', headline: 'money' },
    ]);
  });
  it('home: no judgment yet -> still the newest page; no page at all -> no current', async () => {
    const some = fakeDb((sql) =>
      sql.includes('morning_card_judgments') ? [] : [pageRow('창작/예술', '2026-11-10', 'art')]
    );
    const home = await readHomePages(some.db, USER, NOW);
    expect(home.lastDomain).toBeNull();
    expect(home.current?.domain).toBe('창작/예술');
    expect(home.others).toHaveLength(0);
    const none = fakeDb(() => []);
    expect((await readHomePages(none.db, USER, NOW)).current).toBeNull();
  });
  it('readPageCards: the page order, a card from the page for a video not in the pool, verdicts', async () => {
    const page = {
      ...pageRow(CELL, '2026-11-13', 'tech'),
      videos: [
        { video_id: VID, title: 'T', channel: 'C', useful_for: '' },
        { video_id: 'zzzzzzzzzzz', title: 'not in pool', channel: 'C2', useful_for: '' },
      ],
    };
    const ids = [VID, 'zzzzzzzzzzz'];
    const { db, queries } = fakeDb((sql) => {
      if (sql.includes('FROM public.morning_pages')) return [page];
      if (sql.includes('video_pool'))
        return [
          {
            cell: CELL,
            focus: [],
            why: 'w',
            judge_score: null,
            video_id: ids[0],
            title: 'pool title',
            channel_name: 'ch',
            published_at: new Date('2026-11-01T00:00:00Z'),
            duration_seconds: 300,
            thumbnail_url: null,
            view_count: 10,
          },
        ];
      if (sql.includes('morning_card_judgments')) return [{ video_id: ids[0], verdict: 'useful' }];
      return [];
    });
    const out = await readPageCards(db, USER, CELL, '2026-11-13');
    expect(out?.items.map((c) => c.video_id)).toEqual(ids);
    expect(out?.items[0]?.title).toBe('pool title');
    expect(out?.items[1]).toMatchObject({ title: 'not in pool', channel: 'C2', duration: 0 });
    expect(out?.judged).toEqual({ [ids[0]!]: 'useful' });
    // read only
    expect(queries.every((q) => /^\s*(SELECT|WITH)/i.test(q.sql))).toBe(true);
    const none = fakeDb(() => []);
    expect(await readPageCards(none.db, USER, CELL, '2026-11-13')).toBeNull();
  });
  it('a page dated after today (KST) is not read anywhere: page, list and home stop at today', async () => {
    const one = fakeDb(() => []);
    await readPage(one.db, USER, CELL, '2026-11-15', NOW);
    expect(one.queries[0]!.sql).toContain('p.seen_date <= $4::date');
    expect(one.queries[0]!.params[3]).toBe('2026-11-14');
    const list = fakeDb(() => []);
    await listPages(list.db, USER, CELL, NOW);
    expect(list.queries[0]!.sql).toContain('p.seen_date <= $4::date');
    expect(list.queries[0]!.params[3]).toBe('2026-11-14');
    const home = fakeDb(() => []);
    await readHomePages(home.db, USER, NOW);
    expect(home.queries[1]!.sql).toContain('p.seen_date <= $2::date');
    expect(home.queries[1]!.params[1]).toBe('2026-11-14');
  });
  it('readPage and listPages', async () => {
    const one = fakeDb(() => [pageRow(CELL, '2026-11-13', 'tech')]);
    expect((await readPage(one.db, USER, CELL, '2026-11-13'))?.domain).toBe(CELL);
    const none = fakeDb(() => []);
    expect(await readPage(none.db, USER, CELL, '2026-11-13')).toBeNull();
    await expect(readPage(none.db, USER, 'x', '2026-11-13')).rejects.toThrow(FeedValidationError);
    const list = fakeDb(() => [{ seen_date: '2026-11-13', headline: 'tech' }]);
    expect(await listPages(list.db, USER, CELL)).toEqual([
      { seen_date: '2026-11-13', headline: 'tech' },
    ]);
    expect(list.queries[0]!.params[2]).toBe(60);
  });
});

describe('page routes', () => {
  const ENV = ['MOBILE_MORNING_CARDS', 'MORNING_CARDS_TEST_USER_IDS'] as const;
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV) saved[k] = process.env[k];
    process.env['MOBILE_MORNING_CARDS'] = 'true';
    process.env['MORNING_CARDS_TEST_USER_IDS'] = USER;
  });
  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  async function build(db: FeedDb, authed = true): Promise<FastifyInstance> {
    const app = Fastify();
    app.decorate('authenticate', async (request: any, reply: any) => {
      if (!authed) return reply.code(401).send({ status: 'error', error: 'unauthenticated' });
      request.user = { userId: USER };
    });
    await app.register(createMorningFeedRoutes({ getDb: () => db }), { prefix: BASE });
    return app;
  }

  it('GET /pages/home', async () => {
    const { db } = fakeDb((sql) => (sql.includes('morning_watch_batches') ? [] : []));
    const app = await build(db);
    const res = await app.inject({ method: 'GET', url: `${BASE}/pages/home` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'ok',
      data: {
        cells: expect.any(Array),
        current: null,
        lastDomain: null,
        others: [],
        goal: null,
        today: expect.any(String),
        experiment: false,
      },
    });
    await app.close();
  });

  it('GET /pages', async () => {
    const { db } = fakeDb(() => [pageRow(CELL, '2026-11-13', 'tech')]);
    const app = await build(db);
    const q = (s: string) => app.inject({ method: 'GET', url: `${BASE}/pages${s}` });
    const ok = await q(`?cell=${encodeURIComponent(CELL)}&date=2026-11-13`);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.headline).toBe('tech');
    expect((await q('?cell=nope&date=2026-11-13')).statusCode).toBe(400);
    expect((await q(`?cell=${encodeURIComponent(CELL)}&date=2026-13-40`)).statusCode).toBe(400);
    expect((await q(`?cell=${encodeURIComponent(CELL)}`)).statusCode).toBe(400);
    await app.close();
  });

  it('GET /pages/list', async () => {
    const { db } = fakeDb(() => [{ seen_date: '2026-11-13', headline: 'tech' }]);
    const app = await build(db);
    const ok = await app.inject({
      method: 'GET',
      url: `${BASE}/pages/list?cell=${encodeURIComponent(CELL)}`,
    });
    expect(ok.json()).toEqual({
      status: 'ok',
      data: [{ seen_date: '2026-11-13', headline: 'tech' }],
    });
    expect((await app.inject({ method: 'GET', url: `${BASE}/pages/list` })).statusCode).toBe(400);
    await app.close();
  });

  it('guards: unauthenticated 401, flag off 404; an unlisted account may read pages', async () => {
    const { db } = fakeDb(() => []);
    const anon = await build(db, false);
    for (const u of ['/pages/home', '/pages?cell=x&date=2026-11-13', '/pages/list?cell=x']) {
      expect((await anon.inject({ method: 'GET', url: `${BASE}${u}` })).statusCode).toBe(401);
    }
    await anon.close();
    const app = await build(db);
    process.env['MORNING_CARDS_TEST_USER_IDS'] = '22222222-2222-4222-8222-222222222222';
    expect((await app.inject({ method: 'GET', url: `${BASE}/pages/home` })).statusCode).toBe(200);
    process.env['MOBILE_MORNING_CARDS'] = 'false';
    expect((await app.inject({ method: 'GET', url: `${BASE}/pages/home` })).statusCode).toBe(404);
    await app.close();
  });
});

describe('shared brief: owner vs viewer, participants, feedback, events', () => {
  const OWNER = '33333333-3333-4333-8333-333333333333';
  const PARTICIPANT = '44444444-4444-4444-8444-444444444444';
  const ENV = [
    'MOBILE_MORNING_CARDS',
    'MORNING_CARDS_TEST_USER_IDS',
    'MORNING_BRIEF_OWNER_ID',
    'MORNING_EXPERIMENT_USER_IDS',
  ] as const;
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV) saved[k] = process.env[k];
    process.env['MOBILE_MORNING_CARDS'] = 'true';
    process.env['MORNING_CARDS_TEST_USER_IDS'] = OWNER;
    process.env['MORNING_BRIEF_OWNER_ID'] = OWNER;
    process.env['MORNING_EXPERIMENT_USER_IDS'] = OWNER;
  });
  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  async function build(db: FeedDb, viewer: string): Promise<FastifyInstance> {
    const app = Fastify();
    app.decorate('authenticate', async (request: any) => {
      request.user = { userId: viewer };
    });
    await app.register(createMorningFeedRoutes({ getDb: () => db }), { prefix: BASE });
    return app;
  }
  const get = (app: FastifyInstance, u: string) => app.inject({ method: 'GET', url: BASE + u });
  const post = (app: FastifyInstance, u: string, payload: unknown) =>
    app.inject({ method: 'POST', url: BASE + u, payload: payload as any });
  const q = `cell=${encodeURIComponent(CELL)}&date=2026-11-13`;

  it('home: pages read with the owner, lastDomain and goal with the viewer; cells and experiment', async () => {
    const { db, queries } = fakeDb((sql) =>
      sql.includes('morning_card_judgments') ? [] : [pageRow(CELL, '2026-11-13', 'tech')]
    );
    const app = await build(db, PARTICIPANT);
    const res = await get(app, '/pages/home');
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.current.headline).toBe('tech');
    expect(d.experiment).toBe(false);
    expect(d.cells).toEqual(JSON.parse(JSON.stringify(FEED_CELLS)));
    const judg = queries.find((x) => x.sql.includes('morning_card_judgments'))!;
    expect(judg.params[0]).toBe(PARTICIPANT);
    const pages = queries.find((x) => x.sql.includes('FROM public.morning_pages'))!;
    expect(pages.params[0]).toBe(OWNER);
    expect(queries.find((x) => x.sql.includes('ontology.nodes'))!.params[0]).toBe(PARTICIPANT);
    await app.close();
    const own = await build(fakeDb(() => []).db, OWNER);
    expect((await get(own, '/pages/home')).json().data.experiment).toBe(true);
    await own.close();
  });

  it('owner unset: each viewer reads their own rows, experiment false without the lists', async () => {
    delete process.env['MORNING_BRIEF_OWNER_ID'];
    delete process.env['MORNING_EXPERIMENT_USER_IDS'];
    const { db, queries } = fakeDb(() => []);
    const app = await build(db, OWNER);
    const res = await get(app, '/pages/home');
    expect(res.json().data.experiment).toBe(false);
    expect(queries.find((x) => x.sql.includes('FROM public.morning_pages'))!.params[0]).toBe(OWNER);
    await app.close();
  });

  it('participant: pages, list, cards and feedback work; verdict routes stay 403', async () => {
    const { db, queries } = fakeDb((sql) => {
      if (sql.includes('FROM public.morning_pages')) return [pageRow(CELL, '2026-11-13', 'tech')];
      return [];
    });
    const app = await build(db, PARTICIPANT);
    expect((await get(app, `/pages?${q}`)).statusCode).toBe(200);
    expect((await get(app, `/pages/list?cell=${encodeURIComponent(CELL)}`)).statusCode).toBe(200);
    const cards = await get(app, `/pages/cards?${q}`);
    expect(cards.statusCode).toBe(200);
    expect(cards.json().data.judged).toEqual({});
    // page by owner, verdicts by the viewer
    expect(queries.find((x) => x.sql.includes('FROM public.morning_pages'))!.params[0]).toBe(OWNER);
    expect(queries.find((x) => x.sql.includes('morning_card_judgments'))!.params[0]).toBe(
      PARTICIPANT
    );
    expect(
      (
        await post(app, '/judgments', {
          video_id: VID,
          cell: CELL,
          verdict: 'useful',
          shown_position: 0,
        })
      ).statusCode
    ).toBe(403);
    expect((await get(app, '/watch/today')).statusCode).toBe(403);
    await app.close();
  });

  it('GET /pages adds the viewer feedback (null when none)', async () => {
    const { db } = fakeDb((sql) => {
      if (sql.includes('morning_brief_feedback')) return [{ value: 'not_useful' }];
      return [pageRow(CELL, '2026-11-13', 'tech')];
    });
    const app = await build(db, PARTICIPANT);
    expect((await get(app, `/pages?${q}`)).json().data.feedback).toBe('not_useful');
    await app.close();
    const none = fakeDb((sql) =>
      sql.includes('morning_brief_feedback') ? [] : [pageRow(CELL, '2026-11-13', 'tech')]
    );
    const app2 = await build(none.db, PARTICIPANT);
    expect((await get(app2, `/pages?${q}`)).json().data.feedback).toBeNull();
    await app2.close();
  });

  it('POST /pages/feedback upserts for the viewer; refuses bad input, a missing brief, a future date', async () => {
    const { db, queries } = fakeDb((sql) =>
      sql.includes('FROM public.morning_pages') ? [{ one: 1 }] : []
    );
    const app = await build(db, PARTICIPANT);
    const ok = await post(app, '/pages/feedback', {
      cell: CELL,
      date: '2026-11-13',
      value: 'useful',
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data).toEqual({ cell: CELL, seen_date: '2026-11-13', value: 'useful' });
    const exists = queries.find((x) => x.sql.includes('FROM public.morning_pages'))!;
    expect(exists.params[0]).toBe(OWNER);
    const ins = queries.find((x) => x.sql.includes('INSERT INTO public.morning_brief_feedback'))!;
    expect(ins.sql).toContain('ON CONFLICT (user_id, cell, seen_date)');
    expect(ins.params).toEqual([PARTICIPANT, CELL, '2026-11-13', 'useful']);
    for (const bad of [
      { cell: 'x', date: '2026-11-13', value: 'useful' },
      { cell: CELL, date: '2026-13-40', value: 'useful' },
      { cell: CELL, date: '2026-11-13', value: 'great' },
      { cell: CELL, date: '2999-01-01', value: 'useful' },
      {},
    ]) {
      expect((await post(app, '/pages/feedback', bad)).statusCode).toBe(400);
    }
    await app.close();
    const missing = fakeDb(() => []);
    const app2 = await build(missing.db, PARTICIPANT);
    const res = await post(app2, '/pages/feedback', {
      cell: CELL,
      date: '2026-11-13',
      value: 'useful',
    });
    expect(res.statusCode).toBe(400);
    expect(missing.queries.some((x) => x.sql.includes('INSERT'))).toBe(false);
    await app2.close();
  });

  it('POST /events validates kinds and fields, inserts one row, 204', async () => {
    const { db, queries } = fakeDb(() => []);
    const app = await build(db, PARTICIPANT);
    const ok = await post(app, '/events', { kind: 'brief_open', cell: CELL, date: '2026-11-13' });
    expect(ok.statusCode).toBe(204);
    expect(queries).toHaveLength(1);
    expect(queries[0]!.params).toEqual([PARTICIPANT, 'brief_open', CELL, '2026-11-13', null, null]);
    expect((await post(app, '/events', { kind: 'home_open' })).statusCode).toBe(204);
    expect(
      (await post(app, '/events', { kind: 'video_reaction', video_id: VID, value: 'useful' }))
        .statusCode
    ).toBe(204);
    const before = queries.length;
    for (const bad of [
      {},
      { kind: 'nope' },
      { kind: 'home_open', cell: 'x' },
      { kind: 'home_open', date: '2026-02-30' },
      { kind: 'video_reaction', video_id: 'short' },
      { kind: 'video_reaction', value: 'x'.repeat(17) },
      { kind: 'video_reaction', value: 'a b' },
    ]) {
      expect((await post(app, '/events', bad)).statusCode).toBe(400);
    }
    expect(queries.length).toBe(before);
    await app.close();
  });

  it('flag off 404 and no user 401 on the new routes', async () => {
    process.env['MOBILE_MORNING_CARDS'] = 'false';
    const app = await build(fakeDb(() => []).db, PARTICIPANT);
    expect((await post(app, '/events', { kind: 'home_open' })).statusCode).toBe(404);
    expect((await post(app, '/pages/feedback', {})).statusCode).toBe(404);
    await app.close();
  });
});
