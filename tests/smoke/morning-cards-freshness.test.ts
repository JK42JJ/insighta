import {
  morningCardsConfig as cfg,
  parseMorningCardsConfig,
  FreshnessClass,
} from '../../src/modules/morning-cards/config';
import { isFresh } from '../../src/modules/morning-cards/freshness';

const NOW = new Date('2026-06-15T00:00:00+09:00');
const DAY = 86_400_000;
const ago = (days: number, extraMs = 0): string =>
  new Date(NOW.getTime() - days * DAY - extraMs).toISOString();

type Pub = string | null | undefined;
const fresh = (p: Pub, c: FreshnessClass, now = NOW, config = cfg) =>
  isFresh({ publishedAt: p, now, freshnessClass: c, config });

describe('isFresh', () => {
  it('fast 30 days and market 90 days, both sides', () => {
    expect(fresh(ago(30), 'fast').passed).toBe(true);
    expect(fresh(ago(30, 1000), 'fast')).toMatchObject({ passed: false, reason: 'outside_window' });
    expect(fresh(ago(89), 'market').passed).toBe(true);
    expect(fresh(ago(91), 'market').passed).toBe(false);
  });

  it('evergreen has no limit', () => {
    const r = fresh('2001-01-01T00:00:00Z', 'evergreen');
    expect(r).toMatchObject({ passed: true, windowStart: null });
  });

  it('time_bound KST boundary, both sides', () => {
    const on = fresh('2026-01-01T00:00:00+09:00', 'time_bound');
    expect(on.passed).toBe(true);
    expect(on.windowStart).toBe('2025-12-31T15:00:00.000Z');
    expect(fresh('2025-12-31T23:59:59+09:00', 'time_bound').passed).toBe(false);
  });

  it('Jan/Feb fallback: 0 is off, positive widens, March unaffected', () => {
    const pub = '2025-11-15T00:00:00+09:00';
    const jan = new Date('2026-01-20T12:00:00+09:00');
    const wide = parseMorningCardsConfig({ timeBoundFallbackMonths: 3 });
    expect(fresh(pub, 'time_bound', jan).passed).toBe(false);
    const r = fresh(pub, 'time_bound', jan, wide);
    expect(r).toMatchObject({ passed: true, windowStart: '2025-09-30T15:00:00.000Z' });
    expect(fresh(pub, 'time_bound', new Date('2026-02-10T00:00:00+09:00'), wide).passed).toBe(true);
    expect(fresh(pub, 'time_bound', new Date('2026-03-10T00:00:00+09:00'), wide).passed).toBe(
      false
    );
  });

  it('fails closed on invalid or missing publishedAt', () => {
    for (const v of [null, undefined, '', 'not-a-date']) {
      expect(fresh(v, 'evergreen')).toMatchObject({
        passed: false,
        reason: 'invalid_published_at',
      });
    }
  });
});
