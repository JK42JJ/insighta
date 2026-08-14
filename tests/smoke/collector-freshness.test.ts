/**
 * Collector freshness window — publishedAfter + order on search.list.
 *
 * Every collector run before 2026-08-11 sent neither parameter, and the pool
 * shows what that cost: of the rows still active, 94 were published in the
 * last 30 days and 316 are more than a year old. A weekly deck that promises
 * "this week" had nothing recent to pick from and surfaced videos four to
 * nine years old. The 2026-08-04 pilot stored 121 videos, none from the last
 * 30 days.
 *
 * Both knobs default to the old behaviour, so an unconfigured deploy collects
 * exactly what it collected before and the rollback is `unset`, not a revert.
 * That default is the case worth pinning — it is what prod runs with until the
 * compose variable lands.
 */
export {};

// Same stub as collector-domain-scope.test.ts: the real config parses env at
// import time and there is no env setup file, so unknown branches answer with
// an empty object rather than throwing.
jest.mock('../../src/config/index', () => {
  const known: Record<string, unknown> = {
    paths: { logs: '/tmp' },
    app: { isProduction: false },
  };
  return {
    config: new Proxy(known, {
      get: (target, key: string) => (key in target ? target[key] : {}),
    }),
  };
});

import {
  normalizeFreshDays,
  normalizeSearchOrder,
  freshWindowStart,
} from '../../src/skills/plugins/batch-video-collector/executor';
import {
  BATCH_COLLECTOR_FRESH_DAYS_MAX,
  BATCH_COLLECTOR_SEARCH_ORDER_DEFAULT,
} from '../../src/skills/plugins/batch-video-collector/manifest';

const DAY = 86_400_000;

describe('window is off unless someone turns it on', () => {
  it('reads every non-positive input as "no window"', () => {
    for (const raw of [undefined, null, '', '0', '-3', 'abc', NaN]) {
      expect(normalizeFreshDays(raw)).toBe(0);
    }
  });

  it('omits publishedAfter entirely when off, rather than sending an epoch', () => {
    // undefined lets the caller spread the key away; a far-past timestamp
    // would look like a filter while filtering nothing.
    expect(freshWindowStart(Date.now(), 0)).toBeUndefined();
    expect(freshWindowStart(Date.now(), -1)).toBeUndefined();
  });

  it('defaults order to relevance, which the client drops', () => {
    for (const raw of [undefined, '', 'DATE', 'newest', 42]) {
      expect(normalizeSearchOrder(raw)).toBe(BATCH_COLLECTOR_SEARCH_ORDER_DEFAULT);
    }
    expect(BATCH_COLLECTOR_SEARCH_ORDER_DEFAULT).toBe('relevance');
  });
});

describe('window when it is on', () => {
  const now = Date.UTC(2026, 7, 11, 12, 0, 0);

  it('accepts integers and strings alike', () => {
    expect(normalizeFreshDays(30)).toBe(30);
    expect(normalizeFreshDays('30')).toBe(30);
    expect(normalizeFreshDays('7.9')).toBe(7);
  });

  it('clamps an absurd value instead of disabling the filter', () => {
    // Turning the filter off on bad input would be invisible in the logs —
    // the run would look normal and collect the same stale pool.
    expect(normalizeFreshDays(3650)).toBe(BATCH_COLLECTOR_FRESH_DAYS_MAX);
  });

  it('produces the RFC3339 shape search.list requires', () => {
    const iso = freshWindowStart(now, 30);
    expect(iso).toBe(new Date(now - 30 * DAY).toISOString());
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('moves the boundary with the clock', () => {
    const a = freshWindowStart(now, 30)!;
    const b = freshWindowStart(now + DAY, 30)!;
    expect(new Date(b).getTime() - new Date(a).getTime()).toBe(DAY);
  });

  it('passes the three orders YouTube accepts', () => {
    expect(normalizeSearchOrder('date')).toBe('date');
    expect(normalizeSearchOrder('viewCount')).toBe('viewCount');
    expect(normalizeSearchOrder('relevance')).toBe('relevance');
  });
});
