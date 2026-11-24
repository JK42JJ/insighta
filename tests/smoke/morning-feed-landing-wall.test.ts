import Fastify, { FastifyInstance } from 'fastify';
import { createMorningFeedRoutes } from '@/api/routes/morning-feed';
import type { FeedDb } from '@/modules/morning-feed/feed';
import {
  LANDING_WALL_CACHE_MS,
  LANDING_WALL_HIGHLIGHT,
  LANDING_WALL_OTHERS,
  readLandingWall,
} from '@/modules/morning-feed/landing-wall';

export {};

/*
 * GET /morning-feed/public/wall (landing page, decision 2026-11-24): no sign-in, only video ids
 * with title and channel, hidden pages excluded, one brief's support videos as the highlight.
 */

const ENV_KEYS = [
  'MOBILE_MORNING_CARDS',
  'MORNING_BRIEF_OWNER_ID',
  'MORNING_HIDDEN_CELLS',
] as const;
const ALL_CELLS = [
  '기술/개발',
  '비즈니스/커리어',
  '재테크/투자',
  '학습/교육',
  '건강/피트니스',
  '인간관계/커뮤니티',
  '창작/예술',
  '라이프스타일/여행',
];
const TEST_HIDDEN = ['인간관계/커뮤니티', '건강/피트니스', '학습/교육'];
const BASE = '/api/v1/morning-feed';
const OWNER = '33333333-3333-4333-8333-333333333333';
// 2026-11-24 12:00 KST
const NOW = new Date('2026-11-24T03:00:00Z');

let seq = 0;
function vid(): string {
  seq += 1;
  return `v${String(seq).padStart(10, '0')}`;
}
function videos(n: number, role?: 'support' | 'other') {
  return Array.from({ length: n }, () => ({
    video_id: vid(),
    title: 'Title',
    channel: 'Channel',
    useful_for: 'reader note',
    ...(role ? { role } : {}),
  }));
}

interface FakePage {
  cell: string;
  seen_date: string;
  videos: unknown[];
  hidden?: boolean;
  user_id?: string;
}

/** Stand-in for morning_pages: honours the owner, the date window and `hidden_at IS NULL`. */
function fakeDb(pages: FakePage[]) {
  const sqls: string[] = [];
  const db: FeedDb = {
    $queryRawUnsafe: jest.fn(async (sql: string, ...params: unknown[]) => {
      sqls.push(sql);
      if (!sql.includes('FROM public.morning_pages')) return [] as never;
      const [owner, to, from, cells] = params as [string, string, string, string[]];
      return pages
        .filter((p) => (p.user_id ?? OWNER) === owner)
        .filter((p) => p.seen_date <= to && p.seen_date >= from && cells.includes(p.cell))
        .filter((p) => !(p.hidden && sql.includes('hidden_at IS NULL')))
        .sort((a, b) => (a.seen_date < b.seen_date ? 1 : -1))
        .map((p) => ({ cell: p.cell, seen_date: p.seen_date, videos: p.videos })) as never;
    }),
    $executeRawUnsafe: jest.fn(async () => 0),
  };
  return { db, sqls };
}

async function build(db: FeedDb, now: () => Date = () => NOW): Promise<FastifyInstance> {
  const app = Fastify();
  // any route that asks for authentication fails: the wall must not
  app.decorate('authenticate', async (_request: unknown, reply: any) => {
    reply.code(401).send({ status: 'error', error: 'unauthenticated' });
  });
  await app.register(createMorningFeedRoutes({ getDb: () => db, now }), { prefix: BASE });
  return app;
}

describe('landing wall', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    process.env['MOBILE_MORNING_CARDS'] = 'true';
    process.env['MORNING_BRIEF_OWNER_ID'] = OWNER;
    delete process.env['MORNING_HIDDEN_CELLS'];
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('answers without sign-in with the shape, and no personal fields', async () => {
    const tech = videos(6);
    const biz = videos(6);
    const { db } = fakeDb([
      { cell: '기술/개발', seen_date: '2026-11-24', videos: tech },
      { cell: '비즈니스/커리어', seen_date: '2026-11-24', videos: biz },
    ]);
    const app = await build(db);
    const res = await app.inject({ method: 'GET', url: `${BASE}/public/wall` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Record<string, unknown> };
    expect(Object.keys(body.data).sort()).toEqual([
      'cells',
      'date',
      'highlight',
      'items',
      'others',
    ]);
    // nothing hidden: every goal cell in cell order (the landing's domain list)
    expect(body.data['cells']).toEqual(ALL_CELLS);
    expect(body.data['date']).toBe('2026-11-24');
    // first cell in goal cell order with six videos: 기술/개발
    expect(body.data['highlight']).toEqual(tech.map((v) => v.video_id));
    expect(body.data['others']).toEqual(biz.map((v) => v.video_id));
    const items = body.data['items'] as Record<string, Record<string, unknown>>;
    for (const it of Object.values(items))
      expect(Object.keys(it).sort()).toEqual(['channel', 'title']);
    expect(res.body).not.toContain(OWNER);
    expect(res.body).not.toMatch(/user_id|email|useful_for/);
    await app.close();
  });

  it('is behind the morning cards flag like the other routes', async () => {
    process.env['MOBILE_MORNING_CARDS'] = 'false';
    const app = await build(fakeDb([]).db);
    expect((await app.inject({ method: 'GET', url: `${BASE}/public/wall` })).statusCode).toBe(404);
    await app.close();
  });

  it('skips hidden pages and pages of anyone but the brief owner', async () => {
    const hidden = videos(6);
    const other = videos(6);
    const shown = videos(6);
    const { db, sqls } = fakeDb([
      { cell: '기술/개발', seen_date: '2026-11-24', videos: hidden, hidden: true },
      {
        cell: '기술/개발',
        seen_date: '2026-11-24',
        videos: other,
        user_id: '44444444-4444-4444-8444-444444444444',
      },
      { cell: '재테크/투자', seen_date: '2026-11-24', videos: shown },
    ]);
    const wall = await readLandingWall(db, OWNER, NOW);
    expect(sqls.every((s) => s.includes('hidden_at IS NULL'))).toBe(true);
    expect(wall.highlight).toEqual(shown.map((v) => v.video_id));
    const all = [...wall.highlight, ...wall.others];
    for (const v of [...hidden, ...other]) expect(all).not.toContain(v.video_id);
  });

  it('highlights only support videos when the page has roles; others cap at 14, no repeats', async () => {
    const roled = [...videos(2, 'other'), ...videos(6, 'support')];
    const rest = [videos(6), videos(6), videos(6)];
    const { db } = fakeDb([
      { cell: '기술/개발', seen_date: '2026-11-24', videos: roled },
      { cell: '비즈니스/커리어', seen_date: '2026-11-24', videos: rest[0]! },
      { cell: '재테크/투자', seen_date: '2026-11-24', videos: rest[1]! },
      { cell: '학습/교육', seen_date: '2026-11-24', videos: rest[2]! },
    ]);
    const wall = await readLandingWall(db, OWNER, NOW);
    expect(wall.highlight).toEqual(roled.slice(2).map((v) => v.video_id));
    expect(wall.highlight).toHaveLength(LANDING_WALL_HIGHLIGHT);
    expect(wall.others).toHaveLength(LANDING_WALL_OTHERS);
    expect(new Set([...wall.highlight, ...wall.others]).size).toBe(
      LANDING_WALL_HIGHLIGHT + LANDING_WALL_OTHERS
    );
  });

  it('no brief with six: the highlight is filled from the day in cell order', async () => {
    const a = videos(4);
    const b = videos(4);
    const { db } = fakeDb([
      { cell: '기술/개발', seen_date: '2026-11-24', videos: a },
      { cell: '비즈니스/커리어', seen_date: '2026-11-24', videos: b },
    ]);
    const wall = await readLandingWall(db, OWNER, NOW);
    expect(wall.highlight).toEqual([...a, ...b.slice(0, 2)].map((v) => v.video_id));
    expect(wall.others).toEqual(b.slice(2).map((v) => v.video_id));
  });

  it('no page today: the newest day within three days, else empty', async () => {
    const old = videos(6);
    const recent = videos(6);
    const { db } = fakeDb([
      { cell: '기술/개발', seen_date: '2026-11-20', videos: old },
      { cell: '기술/개발', seen_date: '2026-11-22', videos: recent },
    ]);
    const wall = await readLandingWall(db, OWNER, NOW);
    expect(wall.date).toBe('2026-11-22');
    expect(wall.highlight).toEqual(recent.map((v) => v.video_id));

    const far = fakeDb([{ cell: '기술/개발', seen_date: '2026-11-20', videos: old }]);
    expect(await readLandingWall(far.db, OWNER, NOW)).toEqual({
      cells: ALL_CELLS,
      date: null,
      highlight: [],
      others: [],
      items: {},
    });
    // no brief owner configured: nothing to show, no query
    const none = fakeDb([]);
    expect((await readLandingWall(none.db, null, NOW)).highlight).toEqual([]);
    expect(none.sqls).toHaveLength(0);
  });

  it('MORNING_HIDDEN_CELLS: hidden cells are not queried, not on the wall, not in cells', async () => {
    process.env['MORNING_HIDDEN_CELLS'] = TEST_HIDDEN.join(',');
    const learn = videos(6, 'support');
    const health = videos(6);
    const tech = videos(3, 'support');
    const art = videos(4);
    const { db } = fakeDb([
      { cell: '학습/교육', seen_date: '2026-11-24', videos: learn },
      { cell: '건강/피트니스', seen_date: '2026-11-24', videos: health },
      { cell: '기술/개발', seen_date: '2026-11-24', videos: tech },
      { cell: '창작/예술', seen_date: '2026-11-24', videos: art },
    ]);
    const app = await build(db);
    const res = await app.inject({ method: 'GET', url: `${BASE}/public/wall` });
    const data = res.json().data as Record<string, unknown>;
    const shown = ALL_CELLS.filter((c) => !TEST_HIDDEN.includes(c));
    expect(data['cells']).toEqual(shown);
    // the query itself only asks for the shown cells
    expect((db.$queryRawUnsafe as jest.Mock).mock.calls[0]![4]).toEqual(shown);
    const ids = [...(data['highlight'] as string[]), ...(data['others'] as string[])];
    for (const v of [...learn, ...health]) expect(ids).not.toContain(v.video_id);
    expect(ids.sort()).toEqual([...tech, ...art].map((v) => v.video_id).sort());
    for (const h of TEST_HIDDEN) expect(res.body).not.toContain(h);
    // no owner: still the shown domain list, no hidden one
    expect((await readLandingWall(fakeDb([]).db, null, NOW)).cells).toEqual(shown);
    await app.close();
  });

  it('keeps one answer for ten minutes', async () => {
    const { db } = fakeDb([{ cell: '기술/개발', seen_date: '2026-11-24', videos: videos(6) }]);
    let t = NOW.getTime();
    const app = await build(db, () => new Date(t));
    await app.inject({ method: 'GET', url: `${BASE}/public/wall` });
    t += LANDING_WALL_CACHE_MS - 1;
    await app.inject({ method: 'GET', url: `${BASE}/public/wall` });
    expect(db.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    t += 1;
    await app.inject({ method: 'GET', url: `${BASE}/public/wall` });
    expect(db.$queryRawUnsafe).toHaveBeenCalledTimes(2);
    await app.close();
  });
});
