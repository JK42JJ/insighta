import Fastify, { FastifyInstance } from 'fastify';
import { createMorningFeedRoutes } from '@/api/routes/morning-feed';
import { isVirtualDayUser } from '@/config/morning-cards';
import { kstDayString, type FeedDb } from '@/modules/morning-feed/feed';
import {
  effectiveNow,
  moveTestClock,
  nextDay,
  readTestClock,
  shiftToDay,
} from '@/modules/morning-feed/virtual-day';

export {};

const BASE = '/api/v1/morning-feed';
const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-11-14T03:00:00Z'); // 12:00 KST

const ENV = [
  'MOBILE_MORNING_CARDS',
  'MORNING_CARDS_TEST_USER_IDS',
  'MORNING_VIRTUAL_DAY_USER_IDS',
] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  process.env['MOBILE_MORNING_CARDS'] = 'true';
  process.env['MORNING_CARDS_TEST_USER_IDS'] = `${USER},${OTHER}`;
  process.env['MORNING_VIRTUAL_DAY_USER_IDS'] = USER;
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function fakeDb(virtualDay: string | null) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const writes: Array<{ sql: string; params: unknown[] }> = [];
  let day = virtualDay;
  const db: FeedDb = {
    $queryRawUnsafe: jest.fn(async (sql: string, ...params: unknown[]) => {
      queries.push({ sql, params });
      if (sql.includes('morning_virtual_day')) return (day ? [{ day }] : []) as never;
      return [] as never;
    }),
    $executeRawUnsafe: jest.fn(async (sql: string, ...params: unknown[]) => {
      writes.push({ sql, params });
      if (sql.startsWith('DELETE')) day = null;
      else day = params[1] as string;
      return 1;
    }),
  };
  return { db, queries, writes };
}

describe('virtual today (stg repeat tests)', () => {
  it('only with the flag on, on the test list and on the virtual-day list', () => {
    expect(isVirtualDayUser(USER)).toBe(true);
    expect(isVirtualDayUser(OTHER)).toBe(false);
    delete process.env['MORNING_VIRTUAL_DAY_USER_IDS']; // prod: the chart never sets it
    expect(isVirtualDayUser(USER)).toBe(false);
    process.env['MORNING_VIRTUAL_DAY_USER_IDS'] = USER;
    process.env['MOBILE_MORNING_CARDS'] = 'false';
    expect(isVirtualDayUser(USER)).toBe(false);
  });

  it('no value: effectiveNow is the clock itself, and other accounts never read the table', async () => {
    const none = fakeDb(null);
    expect(await effectiveNow(none.db, USER, NOW)).toBe(NOW);
    const other = fakeDb('2026-11-20');
    expect(await effectiveNow(other.db, OTHER, NOW)).toBe(NOW);
    expect(other.queries).toHaveLength(0);
    delete process.env['MORNING_VIRTUAL_DAY_USER_IDS'];
    const prod = fakeDb('2026-11-20');
    expect(await effectiveNow(prod.db, USER, NOW)).toBe(NOW);
    expect(prod.queries).toHaveLength(0);
  });

  it('a virtual day moves now to that KST day at the same time of day', async () => {
    const shifted = shiftToDay(NOW, '2026-11-16');
    expect(kstDayString(shifted)).toBe('2026-11-16');
    expect(shifted.getTime() - NOW.getTime()).toBe(2 * 24 * 3600 * 1000);
    const v = fakeDb('2026-11-15');
    expect(kstDayString(await effectiveNow(v.db, USER, NOW))).toBe('2026-11-15');
    expect(nextDay('2026-11-30')).toBe('2026-12-01');
  });

  it('next moves on from the real day, then from the virtual day; reset goes back', async () => {
    const f = fakeDb(null);
    expect((await moveTestClock(f.db, USER, 'next', NOW)).day).toBe('2026-11-15');
    expect((await moveTestClock(f.db, USER, 'next', NOW)).day).toBe('2026-11-16');
    const back = await moveTestClock(f.db, USER, 'reset', NOW);
    expect(back).toEqual({ enabled: true, day: null, real: '2026-11-14' });
    await expect(moveTestClock(f.db, OTHER, 'next', NOW)).rejects.toThrow();
    expect((await readTestClock(f.db, OTHER, NOW)).enabled).toBe(false);
  });
});

describe('routes follow the virtual day; without one nothing changes', () => {
  async function build(db: FeedDb, userId: string): Promise<FastifyInstance> {
    const app = Fastify();
    app.decorate('authenticate', async (request: any) => {
      request.user = { userId };
    });
    await app.register(createMorningFeedRoutes({ getDb: () => db }), { prefix: BASE });
    return app;
  }
  const listDay = (q: Array<{ sql: string; params: unknown[] }>) =>
    q.find((x) => x.sql.includes('FROM public.morning_pages'))?.params[3];

  it('GET /pages/list stops at the real day without a virtual day, at the virtual day with one', async () => {
    const real = fakeDb(null);
    const a = await build(real.db, USER);
    await a.inject({
      method: 'GET',
      url: `${BASE}/pages/list?cell=${encodeURIComponent('기술/개발')}`,
    });
    expect(listDay(real.queries)).toBe(kstDayString(new Date()));
    await a.close();
    const virt = fakeDb('2030-01-02');
    const b = await build(virt.db, USER);
    await b.inject({
      method: 'GET',
      url: `${BASE}/pages/list?cell=${encodeURIComponent('기술/개발')}`,
    });
    expect(listDay(virt.queries)).toBe('2030-01-02');
    await b.close();
  });

  it('/test-clock is 404 for an account off the list, works for the listed one', async () => {
    const f = fakeDb(null);
    const other = await build(f.db, OTHER);
    expect((await other.inject({ method: 'GET', url: `${BASE}/test-clock` })).statusCode).toBe(404);
    expect(
      (
        await other.inject({
          method: 'POST',
          url: `${BASE}/test-clock`,
          payload: { action: 'next' },
        })
      ).statusCode
    ).toBe(404);
    await other.close();
    const me = await build(f.db, USER);
    const next = await me.inject({
      method: 'POST',
      url: `${BASE}/test-clock`,
      payload: { action: 'next' },
    });
    expect(next.statusCode).toBe(200);
    expect(next.json().data.day).toBe(nextDay(kstDayString(new Date())));
    expect(
      (await me.inject({ method: 'POST', url: `${BASE}/test-clock`, payload: { action: 'x' } }))
        .statusCode
    ).toBe(400);
    await me.close();
  });
});
