import Fastify, { FastifyInstance } from 'fastify';
import { createMorningFeedRoutes } from '@/api/routes/morning-feed';
import { getMorningCardsConfig } from '@/config/morning-cards';
import {
  FEED_CELLS,
  fetchFeed,
  fetchHistory,
  fetchInsight,
  fetchWatchTodayBatches,
  goalCellLabels,
  isFeedCell,
  isShownCell,
  shownFeedCells,
  FeedValidationError,
  type FeedDb,
} from '@/modules/morning-feed/feed';
import { listPages, readHomePages, readPage, readPageCards } from '@/modules/morning-feed/pages';
import { saveBriefFeedback } from '@/modules/morning-feed/brief-usage';

export {};

/*
 * MORNING_HIDDEN_CELLS (usability test 2026-11-26): briefs exist for 5 domains only, so the other
 * three must not reach any reader. Unset = every cell, exactly as before.
 */

const ENV_KEYS = [
  'MOBILE_MORNING_CARDS',
  'MORNING_CARDS_TEST_USER_IDS',
  'MORNING_HIDDEN_CELLS',
  'MORNING_BRIEF_OWNER_ID',
] as const;
const BASE = '/api/v1/morning-feed';
const USER = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-14T03:00:00Z');
const VID = 'aaaaaaaaaaa';
const HIDDEN = ['인간관계/커뮤니티', '건강/피트니스', '학습/교육'];
const SHOWN = ['기술/개발', '비즈니스/커리어', '재테크/투자', '창작/예술', '라이프스타일/여행'];

function fakeDb(handler: (sql: string, params: unknown[]) => unknown[] = () => []) {
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
  core: [{ text: 'c', sources: [{ video_id: VID, t: 0 }] }],
  note: [],
  videos: [{ video_id: VID, title: 'T', channel: 'C', useful_for: '' }],
});

const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env['MOBILE_MORNING_CARDS'] = 'true';
  process.env['MORNING_CARDS_TEST_USER_IDS'] = USER;
  delete process.env['MORNING_BRIEF_OWNER_ID'];
  process.env['MORNING_HIDDEN_CELLS'] = HIDDEN.join(', ');
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('MORNING_HIDDEN_CELLS config', () => {
  it('parses a comma list; unset or empty = nothing hidden = FEED_CELLS', () => {
    expect(
      getMorningCardsConfig({ MORNING_HIDDEN_CELLS: ' 학습/교육 ,,건강/피트니스 ' }).hiddenCells
    ).toEqual(['학습/교육', '건강/피트니스']);
    expect(getMorningCardsConfig({}).hiddenCells).toEqual([]);
    expect(shownFeedCells({})).toEqual([...FEED_CELLS]);
    expect(shownFeedCells({ MORNING_HIDDEN_CELLS: '' })).toEqual([...FEED_CELLS]);
    expect(goalCellLabels({})).toHaveLength(8);
  });

  it('shown cells keep cell order and the centre cell; hidden cells stay known to writers', () => {
    expect(goalCellLabels()).toEqual(SHOWN);
    expect(shownFeedCells().map((c) => c.label)).toEqual([
      '기술/개발',
      '비즈니스/커리어',
      '재테크/투자',
      '오늘 전체',
      '창작/예술',
      '라이프스타일/여행',
    ]);
    for (const h of HIDDEN) {
      expect(isShownCell(h)).toBe(false);
      expect(isFeedCell(h)).toBe(true); // page import / hide scripts still accept it
    }
    expect(isShownCell('기술/개발')).toBe(true);
    expect(isShownCell('오늘 전체')).toBe(false);
  });
});

describe('page readers with hidden cells', () => {
  it('home: no hidden cell in cells, others or lastDomain; the query asks for shown cells only', async () => {
    const { db, queries } = fakeDb((sql) => {
      if (sql.includes('morning_card_judgments')) return [{ cell: '학습/교육' }];
      if (sql.includes('ontology.nodes')) return [];
      return [
        pageRow('기술/개발', '2026-11-13', 'tech'),
        pageRow('창작/예술', '2026-11-12', 'art'),
      ];
    });
    const home = await readHomePages(db, USER, NOW);
    for (const h of HIDDEN) expect(home.cells.some((c) => c.label === h)).toBe(false);
    expect(home.lastDomain).toBeNull();
    expect(home.current?.domain).toBe('기술/개발');
    expect(home.others.map((o) => o.domain)).toEqual(['창작/예술']);
    expect(queries[0]!.params[2]).toEqual(SHOWN);
    expect(queries[1]!.params[2]).toEqual(SHOWN);
  });

  it('page, list and cards of a hidden cell: nothing, without reading the table', async () => {
    const { db, queries } = fakeDb(() => [pageRow('학습/교육', '2026-11-13', 'learn')]);
    expect(await readPage(db, USER, '학습/교육', '2026-11-13', NOW)).toBeNull();
    expect(await listPages(db, USER, '건강/피트니스', NOW)).toEqual([]);
    expect(await readPageCards(db, USER, '인간관계/커뮤니티', '2026-11-13', NOW)).toBeNull();
    expect(queries).toHaveLength(0);
    // a shown cell still reads
    expect((await readPage(db, USER, '기술/개발', '2026-11-13', NOW))?.headline).toBe('learn');
  });

  it('feedback on a hidden brief is refused', async () => {
    const { db } = fakeDb(() => [{ one: 1 }]);
    await expect(
      saveBriefFeedback(
        db,
        USER,
        USER,
        { cell: '학습/교육', date: '2026-11-13', value: 'good' },
        NOW
      )
    ).rejects.toBeInstanceOf(FeedValidationError);
  });
});

describe('watch readers with hidden cells', () => {
  it('watch/today: cells and the per-cell map hold shown cells only', async () => {
    const { db, queries } = fakeDb((sql) =>
      sql.includes('GROUP BY a.cell')
        ? [
            { cell: '학습/교육', available: 9 },
            { cell: '기술/개발', available: 2 },
          ]
        : [{ cell: '건강/피트니스', issued: 5, judged: 1 }]
    );
    const t = await fetchWatchTodayBatches(db, USER, NOW);
    expect(Object.keys(t.today)).toEqual(SHOWN);
    expect(t.cells.some((c) => HIDDEN.includes(c.label))).toBe(false);
    expect(t.today['기술/개발']!.available).toBe(2);
    expect(queries[1]!.params[3]).toEqual(SHOWN);
  });

  it('history and insight leave hidden cells out; the swipe deck grid is unchanged', async () => {
    const hist = fakeDb(() => [
      { cell: '학습/교육', day: '2026-11-13', count: 5 },
      { cell: '기술/개발', day: '2026-11-12', count: 4 },
    ]);
    expect((await fetchHistory(hist.db, USER, NOW)).map((h) => h.cell)).toEqual(['기술/개발']);
    expect(hist.queries[0]!.params[1]).toEqual(SHOWN);

    // the swipe deck (test accounts only, 3x3 grid with the centre at index 4) keeps all nine
    const feed = fakeDb(() => []);
    const f = await fetchFeed(feed.db, USER, NOW);
    expect(f.cells).toEqual([...FEED_CELLS]);

    const ins = fakeDb(() => []);
    await fetchInsight(ins.db, USER, NOW);
    expect(ins.queries[0]!.sql).toContain('NOT (j.cell = ANY($4::text[]))');
    expect(ins.queries[0]!.params[3]).toEqual(HIDDEN);
    await expect(fetchInsight(ins.db, USER, NOW, { cell: '학습/교육' })).rejects.toBeInstanceOf(
      FeedValidationError
    );
  });
});

describe('routes with hidden cells', () => {
  async function build(db: FeedDb): Promise<FastifyInstance> {
    const app = Fastify();
    app.decorate('authenticate', async (request: any) => {
      request.user = { userId: USER };
    });
    await app.register(createMorningFeedRoutes({ getDb: () => db }), { prefix: BASE });
    return app;
  }

  it('a hidden cell is refused like an unknown one on every reader route', async () => {
    const { db, queries } = fakeDb(() => []);
    const app = await build(db);
    const c = encodeURIComponent('학습/교육');
    const gets = [
      `/pages?cell=${c}&date=2026-11-13`,
      `/pages/list?cell=${c}`,
      `/pages/cards?cell=${c}&date=2026-11-13`,
      `/watch/insight?cell=${c}`,
      `/insight?cell=${c}`,
    ];
    for (const url of gets) {
      const res = await app.inject({ method: 'GET', url: BASE + url });
      expect([url, res.statusCode]).toEqual([url, 400]);
    }
    const batch = await app.inject({
      method: 'POST',
      url: `${BASE}/watch/batch`,
      payload: { cell: '학습/교육' },
    });
    expect(batch.statusCode).toBe(400);
    expect(queries).toHaveLength(0);
    await app.close();
  });

  it('GET /pages/home sends no hidden domain anywhere in the body', async () => {
    const { db } = fakeDb((sql) =>
      sql.includes('morning_pages')
        ? [
            pageRow('재테크/투자', '2026-11-13', 'money'),
            pageRow('라이프스타일/여행', '2026-11-12', 'life'),
          ]
        : []
    );
    const app = await build(db);
    const res = await app.inject({ method: 'GET', url: `${BASE}/pages/home` });
    expect(res.statusCode).toBe(200);
    for (const h of HIDDEN) expect(res.body).not.toContain(h);
    await app.close();
  });

  it('unset: /pages/home lists all 8 goal cells as before', async () => {
    delete process.env['MORNING_HIDDEN_CELLS'];
    const app = await build(fakeDb(() => []).db);
    const res = await app.inject({ method: 'GET', url: `${BASE}/pages/home` });
    expect(res.json().data.cells).toEqual(JSON.parse(JSON.stringify(FEED_CELLS)));
    await app.close();
  });
});
