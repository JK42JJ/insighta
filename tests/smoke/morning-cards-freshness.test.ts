import {
  morningCardsConfig,
  parseMorningCardsConfig,
} from '../../src/modules/morning-cards/config';
import { isFresh } from '../../src/modules/morning-cards/freshness';

const cfg = morningCardsConfig;
const NOW = new Date('2026-06-15T00:00:00+09:00');
const DAY = 86_400_000;

describe('isFresh', () => {
  it('fast window is 30 days', () => {
    const edge = new Date(NOW.getTime() - 30 * DAY).toISOString();
    const old = new Date(NOW.getTime() - 30 * DAY - 1000).toISOString();
    expect(
      isFresh({ publishedAt: edge, now: NOW, freshnessClass: 'fast', config: cfg }).passed
    ).toBe(true);
    const r = isFresh({ publishedAt: old, now: NOW, freshnessClass: 'fast', config: cfg });
    expect(r.passed).toBe(false);
    expect(r.reason).toBe('outside_window');
  });

  it('market window is 90 days', () => {
    const ok = new Date(NOW.getTime() - 89 * DAY).toISOString();
    const bad = new Date(NOW.getTime() - 91 * DAY).toISOString();
    expect(
      isFresh({ publishedAt: ok, now: NOW, freshnessClass: 'market', config: cfg }).passed
    ).toBe(true);
    expect(
      isFresh({ publishedAt: bad, now: NOW, freshnessClass: 'market', config: cfg }).passed
    ).toBe(false);
  });

  it('evergreen has no limit and null windowStart', () => {
    const r = isFresh({
      publishedAt: '2001-01-01T00:00:00Z',
      now: NOW,
      freshnessClass: 'evergreen',
      config: cfg,
    });
    expect(r.passed).toBe(true);
    expect(r.windowStart).toBeNull();
  });

  it('time_bound KST year boundary, both sides', () => {
    const now = new Date('2026-06-15T00:00:00+09:00');
    const on = isFresh({
      publishedAt: '2026-01-01T00:00:00+09:00',
      now,
      freshnessClass: 'time_bound',
      config: cfg,
    });
    const before = isFresh({
      publishedAt: '2025-12-31T23:59:59+09:00',
      now,
      freshnessClass: 'time_bound',
      config: cfg,
    });
    expect(on.passed).toBe(true);
    expect(on.windowStart).toBe('2025-12-31T15:00:00.000Z');
    expect(before.passed).toBe(false);
  });

  it('uses the KST year, not UTC, for now', () => {
    // 2025-12-31T16:00Z is already 2026-01-01 01:00 KST
    const now = new Date('2025-12-31T16:00:00Z');
    const r = isFresh({
      publishedAt: '2025-12-31T14:00:00Z',
      now,
      freshnessClass: 'time_bound',
      config: cfg,
    });
    expect(r.windowStart).toBe('2025-12-31T15:00:00.000Z');
    expect(r.passed).toBe(false);
  });

  it('January fallback: 0 means none, positive widens', () => {
    const now = new Date('2026-01-20T12:00:00+09:00');
    const pub = '2025-11-15T00:00:00+09:00';
    expect(
      isFresh({ publishedAt: pub, now, freshnessClass: 'time_bound', config: cfg }).passed
    ).toBe(false);
    const wide = parseMorningCardsConfig({ timeBoundFallbackMonths: 3 });
    const r = isFresh({ publishedAt: pub, now, freshnessClass: 'time_bound', config: wide });
    expect(r.passed).toBe(true);
    expect(r.windowStart).toBe('2025-09-30T15:00:00.000Z');
  });

  it('February fallback applies, March does not', () => {
    const wide = parseMorningCardsConfig({ timeBoundFallbackMonths: 2 });
    const pub = '2025-11-15T00:00:00+09:00';
    const feb = new Date('2026-02-10T00:00:00+09:00');
    const mar = new Date('2026-03-10T00:00:00+09:00');
    expect(
      isFresh({ publishedAt: pub, now: feb, freshnessClass: 'time_bound', config: wide }).passed
    ).toBe(true);
    expect(
      isFresh({ publishedAt: pub, now: mar, freshnessClass: 'time_bound', config: wide }).passed
    ).toBe(false);
  });

  it('fails closed on invalid or missing publishedAt', () => {
    for (const v of [null, undefined, '', 'not-a-date']) {
      const r = isFresh({
        publishedAt: v,
        now: NOW,
        freshnessClass: 'evergreen',
        config: cfg,
      });
      expect(r.passed).toBe(false);
      expect(r.reason).toBe('invalid_published_at');
    }
  });
});
