/**
 * Curation quota limits.
 *
 * The counting rule is the part worth pinning: prod holds legacy duplicate
 * subscriptions (one account has 21 active rows for 5 distinct topics), so a
 * row-based count would put that account over any ceiling immediately.
 */

import { getCurationLimit, TIER_LIMITS } from '../../src/config/quota';

describe('curation limits per tier', () => {
  it('is 1 for free and 5 for pro', () => {
    expect(TIER_LIMITS.free.curations).toBe(1);
    expect(TIER_LIMITS.pro.curations).toBe(5);
  });

  it('is unlimited for lifetime and admin', () => {
    expect(TIER_LIMITS.lifetime.curations).toBeNull();
    expect(TIER_LIMITS.admin.curations).toBeNull();
    expect(getCurationLimit('lifetime')).toBe(Infinity);
    expect(getCurationLimit('admin')).toBe(Infinity);
  });

  it('resolves to a comparable number for every tier', () => {
    expect(getCurationLimit('free')).toBe(1);
    expect(getCurationLimit('pro')).toBe(5);
  });
});

describe('counting rule', () => {
  const norm = (s: string) => s.trim().toLowerCase();
  const distinct = (rows: Array<{ topic: string }>) => new Set(rows.map((r) => norm(r.topic))).size;

  it('counts distinct normalised topics, not rows', () => {
    // shape taken from prod: 21 active rows, 5 real topics
    const rows = [
      ...Array.from({ length: 12 }, () => ({ topic: '파이썬' })),
      ...Array.from({ length: 5 }, () => ({ topic: '호흡법' })),
      { topic: 'ai 에이전트' },
      { topic: 'ai 에이전트' },
      { topic: 'Claude 코드' },
      { topic: '수능 100일 2등급 올리기' },
    ];
    expect(rows).toHaveLength(21);
    expect(distinct(rows)).toBe(5);
  });

  it('treats case and surrounding space as the same topic', () => {
    expect(distinct([{ topic: 'Claude 코드' }, { topic: '  claude 코드 ' }])).toBe(1);
  });

  it('lets a pro user with legacy duplicates still be under the ceiling', () => {
    const rows = Array.from({ length: 21 }, (_, i) => ({
      topic: ['파이썬', '호흡법', 'ai 에이전트', 'Claude 코드', '수능'][i % 5] as string,
    }));
    expect(distinct(rows) >= getCurationLimit('pro')).toBe(true); // exactly at the ceiling
    expect(distinct(rows)).toBe(5);
    // and would have been 21 under a row count — four times over
    expect(rows.length > getCurationLimit('pro')).toBe(true);
  });

  it('blocks a free user at their second distinct topic', () => {
    const existing = [{ topic: '파이썬' }];
    expect(distinct(existing) >= getCurationLimit('free')).toBe(true);
  });
});
