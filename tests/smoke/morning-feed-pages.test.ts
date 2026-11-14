import Fastify, { FastifyInstance } from 'fastify';
import { createMorningFeedRoutes } from '@/api/routes/morning-feed';
import { listPages, readHomePages, readPage, validatePage } from '@/modules/morning-feed/pages';
import { FeedValidationError, type FeedDb } from '@/modules/morning-feed/feed';

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
    $executeRawUnsafe: jest.fn(async () => 0),
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
      data: { current: null, lastDomain: null, others: [] },
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

  it('guards: unauthenticated 401, flag off 404, unlisted account 403', async () => {
    const { db } = fakeDb(() => []);
    const anon = await build(db, false);
    for (const u of ['/pages/home', '/pages?cell=x&date=2026-11-13', '/pages/list?cell=x']) {
      expect((await anon.inject({ method: 'GET', url: `${BASE}${u}` })).statusCode).toBe(401);
    }
    await anon.close();
    const app = await build(db);
    process.env['MORNING_CARDS_TEST_USER_IDS'] = '22222222-2222-4222-8222-222222222222';
    expect((await app.inject({ method: 'GET', url: `${BASE}/pages/home` })).statusCode).toBe(403);
    process.env['MOBILE_MORNING_CARDS'] = 'false';
    expect((await app.inject({ method: 'GET', url: `${BASE}/pages/home` })).statusCode).toBe(404);
    await app.close();
  });
});
