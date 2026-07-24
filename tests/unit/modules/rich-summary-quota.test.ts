/**
 * Rich Summary quota unit tests — CP423.
 *
 * Tests cover the TIER_LIMITS.richSummaries values + quota enforcement logic
 * with a mocked Prisma client (no DB). The in-module `countRichSummariesThisMonth`
 * and `getUserTier` are exercised indirectly via `assertRichSummaryQuota`.
 */

import {
  assertRichSummaryQuota,
  RichSummaryQuotaExceededError,
} from '../../../src/modules/skills/rich-summary-quota';
import { TIER_LIMITS } from '../../../src/config/quota';

type MockPrisma = {
  user_subscriptions: { findUnique: jest.Mock };
  video_rich_summaries: { count: jest.Mock };
};

function mockPrisma(opts: { tier?: string | null | undefined; usedThisMonth: number }): MockPrisma {
  return {
    user_subscriptions: {
      findUnique: jest.fn().mockResolvedValue(opts.tier === undefined ? null : { tier: opts.tier }),
    },
    video_rich_summaries: {
      count: jest.fn().mockResolvedValue(opts.usedThisMonth),
    },
  };
}

describe('TIER_LIMITS.richSummaries values (CP423 spec)', () => {
  it('free = 50', () => {
    expect(TIER_LIMITS.free.richSummaries).toBe(50);
  });
  it('pro = 1000', () => {
    expect(TIER_LIMITS.pro.richSummaries).toBe(1_000);
  });
  it('lifetime = unlimited (null)', () => {
    expect(TIER_LIMITS.lifetime.richSummaries).toBeNull();
  });
  it('admin = unlimited (null)', () => {
    expect(TIER_LIMITS.admin.richSummaries).toBeNull();
  });
});

describe('assertRichSummaryQuota', () => {
  const uid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  it('free tier: passes when used=49 (under limit 50)', async () => {
    const p = mockPrisma({ tier: 'free', usedThisMonth: 49 });
    const r = await assertRichSummaryQuota(p as any, uid);
    expect(r).toEqual({ tier: 'free', used: 49, limit: 50 });
  });

  it('free tier: throws at used=50 (at limit)', async () => {
    const p = mockPrisma({ tier: 'free', usedThisMonth: 50 });
    await expect(assertRichSummaryQuota(p as any, uid)).rejects.toThrow(
      RichSummaryQuotaExceededError
    );
  });

  it('pro tier: passes at used=999', async () => {
    const p = mockPrisma({ tier: 'pro', usedThisMonth: 999 });
    const r = await assertRichSummaryQuota(p as any, uid);
    expect(r).toEqual({ tier: 'pro', used: 999, limit: 1_000 });
  });

  it('pro tier: throws at used=1000', async () => {
    const p = mockPrisma({ tier: 'pro', usedThisMonth: 1_000 });
    await expect(assertRichSummaryQuota(p as any, uid)).rejects.toThrow(
      RichSummaryQuotaExceededError
    );
  });

  it('lifetime tier: never throws (unlimited), count not queried', async () => {
    const p = mockPrisma({ tier: 'lifetime', usedThisMonth: 99999 });
    const r = await assertRichSummaryQuota(p as any, uid);
    expect(r).toEqual({ tier: 'lifetime', used: 0, limit: null });
    // countRichSummariesThisMonth should NOT be called when limit=null
    expect(p.video_rich_summaries.count).not.toHaveBeenCalled();
  });

  it('admin tier: never throws (unlimited)', async () => {
    const p = mockPrisma({ tier: 'admin', usedThisMonth: 0 });
    const r = await assertRichSummaryQuota(p as any, uid);
    expect(r.limit).toBeNull();
  });

  it('defaults to free when subscription row missing', async () => {
    const p = mockPrisma({ tier: undefined, usedThisMonth: 5 });
    const r = await assertRichSummaryQuota(p as any, uid);
    expect(r.tier).toBe('free');
    expect(r.limit).toBe(50);
  });

  it('defaults to free when tier column is null', async () => {
    const p = mockPrisma({ tier: null, usedThisMonth: 5 });
    const r = await assertRichSummaryQuota(p as any, uid);
    expect(r.tier).toBe('free');
  });

  it('defaults to free when tier column is an unknown string', async () => {
    const p = mockPrisma({ tier: 'platinum' as any, usedThisMonth: 5 });
    const r = await assertRichSummaryQuota(p as any, uid);
    expect(r.tier).toBe('free');
  });

  it('thrown error carries tier/used/limit in details', async () => {
    const p = mockPrisma({ tier: 'free', usedThisMonth: 50 });
    try {
      await assertRichSummaryQuota(p as any, uid);
      fail('expected throw');
    } catch (err) {
      const e = err as RichSummaryQuotaExceededError;
      expect(e.code).toBe('RICH_SUMMARY_QUOTA_EXCEEDED');
      expect(e.statusCode).toBe(429);
      expect(e.details).toMatchObject({ userId: uid, tier: 'free', used: 50, limit: 50 });
    }
  });
});
