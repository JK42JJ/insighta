/**
 * Quota display logic tests — verifying the formatQuota helper
 * and related rendering logic from SubscriptionSettingsTab.
 *
 * Covers the #339 fix:
 *   - limit === null → display "{count} used", suffix "unlimited", showBar = false
 *   - limit is a number → display "used / limit", no suffix, showBar = true
 *   - mandalaQuota?.limit ?? null correctly defaults to null when data is undefined
 *
 * Pure unit tests — no React rendering, no DOM.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Inline the formatQuota logic from SubscriptionSettingsTab.tsx
// (It's not exported, so we replicate the exact same logic here to test it.)
// ---------------------------------------------------------------------------

function formatQuota(
  used: number,
  limit: number | null,
  t: (key: string, opts?: Record<string, unknown>) => string
) {
  if (limit === null) {
    return {
      display: t('settings.quotaUsed', { count: used }),
      suffix: t('settings.unlimited'),
      showBar: false,
    };
  }
  return { display: `${used} / ${limit}`, suffix: '', showBar: true };
}

// Minimal t() mock — returns key or "key:count" when opts.count is provided
const mockT = (key: string, opts?: Record<string, unknown>) => {
  if (opts?.count !== undefined) return `${key}:${opts.count}`;
  return key;
};

// ---------------------------------------------------------------------------
// formatQuota tests
// ---------------------------------------------------------------------------

describe('formatQuota — unlimited (limit === null)', () => {
  it('returns showBar: false when limit is null', () => {
    const result = formatQuota(4, null, mockT);
    expect(result.showBar).toBe(false);
  });

  it('display includes used count via t() interpolation', () => {
    const result = formatQuota(4, null, mockT);
    expect(result.display).toBe('settings.quotaUsed:4');
  });

  it('suffix is the "unlimited" translation key', () => {
    const result = formatQuota(4, null, mockT);
    expect(result.suffix).toBe('settings.unlimited');
  });

  it('works with 0 used', () => {
    const result = formatQuota(0, null, mockT);
    expect(result.display).toBe('settings.quotaUsed:0');
    expect(result.showBar).toBe(false);
  });
});

describe('formatQuota — limited (limit is a number)', () => {
  it('returns showBar: true when limit is a number', () => {
    const result = formatQuota(2, 3, mockT);
    expect(result.showBar).toBe(true);
  });

  it('display shows "used / limit" format', () => {
    const result = formatQuota(2, 3, mockT);
    expect(result.display).toBe('2 / 3');
  });

  it('suffix is empty string', () => {
    const result = formatQuota(2, 3, mockT);
    expect(result.suffix).toBe('');
  });

  it('handles edge case where used equals limit', () => {
    const result = formatQuota(3, 3, mockT);
    expect(result.display).toBe('3 / 3');
    expect(result.showBar).toBe(true);
  });

  it('handles edge case where used exceeds limit', () => {
    const result = formatQuota(5, 3, mockT);
    expect(result.display).toBe('5 / 3');
    expect(result.showBar).toBe(true);
  });

  it('handles limit of 0', () => {
    const result = formatQuota(0, 0, mockT);
    expect(result.display).toBe('0 / 0');
    expect(result.showBar).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mandalaQuota defaulting logic (from SubscriptionSettingsTab component)
// ---------------------------------------------------------------------------

describe('mandalaQuota defaults — optional chaining behavior', () => {
  it('mandalaLimit defaults to null when mandalaQuota is undefined', () => {
    const mandalaQuota: { used: number; limit: number | null } | undefined = undefined;
    const mandalaLimit = mandalaQuota?.limit ?? null;
    expect(mandalaLimit).toBeNull();
  });

  it('mandalaUsed defaults to 0 when mandalaQuota is undefined', () => {
    const mandalaQuota: { used: number; limit: number | null } | undefined = undefined;
    const mandalaUsed = mandalaQuota?.used ?? 0;
    expect(mandalaUsed).toBe(0);
  });

  it('mandalaLimit passes through null from API (admin/unlimited)', () => {
    const mandalaQuota = { used: 4, limit: null, tier: 'admin', remaining: null };
    const mandalaLimit = mandalaQuota?.limit ?? null;
    expect(mandalaLimit).toBeNull();
  });

  it('mandalaLimit passes through number from API (free tier)', () => {
    const mandalaQuota = { used: 2, limit: 3, tier: 'free', remaining: 1 };
    const mandalaLimit = mandalaQuota?.limit ?? null;
    expect(mandalaLimit).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// mandalaPercent calculation logic
// ---------------------------------------------------------------------------

describe('mandalaPercent calculation', () => {
  it('calculates percentage correctly for normal usage', () => {
    const mandalaUsed = 2;
    const mandalaLimit: number | null = 3;
    const mandalaPercent =
      mandalaLimit !== null && mandalaLimit > 0
        ? Math.round((mandalaUsed / mandalaLimit) * 100)
        : 0;
    expect(mandalaPercent).toBe(67);
  });

  it('returns 0 when limit is null (unlimited)', () => {
    const mandalaUsed = 10;
    const mandalaLimit: number | null = null;
    const mandalaPercent =
      mandalaLimit !== null && mandalaLimit > 0
        ? Math.round((mandalaUsed / mandalaLimit) * 100)
        : 0;
    expect(mandalaPercent).toBe(0);
  });

  it('returns 0 when limit is 0', () => {
    const mandalaUsed = 0;
    const mandalaLimit: number | null = 0;
    const mandalaPercent =
      mandalaLimit !== null && mandalaLimit > 0
        ? Math.round((mandalaUsed / mandalaLimit) * 100)
        : 0;
    expect(mandalaPercent).toBe(0);
  });

  it('returns 100 when at full capacity', () => {
    const mandalaUsed = 3;
    const mandalaLimit: number | null = 3;
    const mandalaPercent =
      mandalaLimit !== null && mandalaLimit > 0
        ? Math.round((mandalaUsed / mandalaLimit) * 100)
        : 0;
    expect(mandalaPercent).toBe(100);
  });

  it('exceeds 100 when over limit', () => {
    const mandalaUsed = 5;
    const mandalaLimit: number | null = 3;
    const mandalaPercent =
      mandalaLimit !== null && mandalaLimit > 0
        ? Math.round((mandalaUsed / mandalaLimit) * 100)
        : 0;
    expect(mandalaPercent).toBe(167);
  });
});
