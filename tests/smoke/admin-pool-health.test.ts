/**
 * Admin Pool Health — unit + threshold smoke tests.
 *
 * Verifies the health-band evaluation maths and the baseline thresholds
 * picked from the 2026-05-30 prod measurement. No DB, no network.
 */

import { Prisma } from '@prisma/client';
import { POOL_HEALTH_THRESHOLDS, evaluateHealth, type HealthBand } from '@/config/pool-health';
import { n } from '@/api/routes/admin/pool-health';

describe('evaluateHealth — higher_is_better', () => {
  const band: HealthBand = {
    ok: 80,
    warn: 50,
    direction: 'higher_is_better',
    unit: '%',
    label: 'demo',
  };

  it('returns ok at or above ok threshold', () => {
    expect(evaluateHealth(80, band)).toBe('ok');
    expect(evaluateHealth(100, band)).toBe('ok');
  });

  it('returns warn between warn and ok thresholds', () => {
    expect(evaluateHealth(50, band)).toBe('warn');
    expect(evaluateHealth(79.9, band)).toBe('warn');
  });

  it('returns critical below warn threshold', () => {
    expect(evaluateHealth(49.9, band)).toBe('critical');
    expect(evaluateHealth(0, band)).toBe('critical');
  });
});

describe('evaluateHealth — lower_is_better', () => {
  const band: HealthBand = {
    ok: 10,
    warn: 30,
    direction: 'lower_is_better',
    unit: '%',
    label: 'demo',
  };

  it('returns ok at or below ok threshold', () => {
    expect(evaluateHealth(10, band)).toBe('ok');
    expect(evaluateHealth(0, band)).toBe('ok');
  });

  it('returns warn between ok and warn thresholds', () => {
    expect(evaluateHealth(10.1, band)).toBe('warn');
    expect(evaluateHealth(30, band)).toBe('warn');
  });

  it('returns critical above warn threshold', () => {
    expect(evaluateHealth(30.1, band)).toBe('critical');
    expect(evaluateHealth(100, band)).toBe('critical');
  });
});

describe('evaluateHealth — invalid input', () => {
  const band: HealthBand = {
    ok: 80,
    warn: 50,
    direction: 'higher_is_better',
    unit: '%',
    label: 'demo',
  };

  it('treats NaN / Infinity as critical', () => {
    expect(evaluateHealth(Number.NaN, band)).toBe('critical');
    expect(evaluateHealth(Number.POSITIVE_INFINITY, band)).toBe('critical');
  });
});

describe('n() — Prisma raw-query numeric coercion', () => {
  // Root cause of the first-ship hotfix: PG `round(numeric, 1)` arrives
  // through Prisma's raw-query path as a `Prisma.Decimal` instance, not
  // a string. Fixture strings like '33.3' will not reproduce the bug —
  // the test MUST use the real Decimal class so a regression that drops
  // the valueOf-funnel re-zeros the metric.

  it('extracts the numeric value from a Prisma.Decimal instance', () => {
    const dec = new Prisma.Decimal('33.3');
    // Sanity: the instance carries the documented internal shape
    // (constructor + sign / exponent / digit-array). If Prisma drops
    // these, the test still asserts behaviour via Number().
    expect(typeof dec).toBe('object');
    expect(typeof dec.toString).toBe('function');
    expect(typeof dec.valueOf).toBe('function');
    expect(n(dec)).toBe(33.3);
  });

  it('extracts the numeric value from a fresh Decimal that round() would emit', () => {
    // Mirrors `round(100.0 * count(...) / nullif(count(*), 0), 1)` →
    // Decimal('96.8') in the embedding coverage path.
    expect(n(new Prisma.Decimal('96.8'))).toBe(96.8);
    expect(n(new Prisma.Decimal('1.21'))).toBe(1.21);
    expect(n(new Prisma.Decimal('90.6'))).toBe(90.6);
  });

  it('extracts the numeric value from a Decimal-shaped duck-typed object', () => {
    // Same internal shape Prisma.Decimal exposes ({s, e, d, valueOf,
    // toString}) — guards against a future Prisma rewrite that keeps
    // the contract but swaps the class.
    const duck = {
      s: 1,
      e: 1,
      d: [33, 3000000],
      toString(): string {
        return '33.3';
      },
      valueOf(): number {
        return 33.3;
      },
    };
    expect(n(duck)).toBe(33.3);
  });

  it('returns fallback for null / undefined / unparseable', () => {
    expect(n(null)).toBe(0);
    expect(n(undefined)).toBe(0);
    expect(n({ not: 'numeric' })).toBe(0);
    expect(n(null, 42)).toBe(42);
  });

  it('still handles the original number / string / bigint shapes', () => {
    expect(n(33.3)).toBe(33.3);
    expect(n('33.3')).toBe(33.3);
    expect(n(BigInt(12505))).toBe(12505);
  });
});

describe('POOL_HEALTH_THRESHOLDS — baseline expectations', () => {
  it('V1 rich-summary 33.3% (2026-05-30 prod) maps to warn — legacy band', () => {
    expect(evaluateHealth(33.3, POOL_HEALTH_THRESHOLDS.richSummaryV1Pct)).toBe('warn');
  });

  it('V1 LLM-only 0.4% (21 of 4,289 rows ran LLM) maps to critical', () => {
    expect(evaluateHealth(0.4, POOL_HEALTH_THRESHOLDS.richSummaryV1LlmPct)).toBe('critical');
  });

  it('V2 rich-summary 34.1% (2026-05-30 prod, real enrich) maps to critical', () => {
    expect(evaluateHealth(34.1, POOL_HEALTH_THRESHOLDS.richSummaryV2Pct)).toBe('critical');
  });

  it('caption fail rate 58% (2026-05-30 prod, awk + webshare mixed) maps to critical', () => {
    expect(evaluateHealth(58, POOL_HEALTH_THRESHOLDS.captionFailRate7d)).toBe('critical');
  });

  it('last bulk fire 0.5h ago maps to ok — pipeline alive', () => {
    expect(evaluateHealth(0.5, POOL_HEALTH_THRESHOLDS.lastBulkFireHours)).toBe('ok');
  });

  it('last bulk fire 8h ago maps to critical — scheduler likely stuck', () => {
    expect(evaluateHealth(8, POOL_HEALTH_THRESHOLDS.lastBulkFireHours)).toBe('critical');
  });

  it('embedding 96.8% (2026-05-30 prod) maps to ok', () => {
    expect(evaluateHealth(96.8, POOL_HEALTH_THRESHOLDS.embeddingPct)).toBe('ok');
  });

  it('user inflow 0.03% (2026-05-30 prod video_pool user share) maps to na — pre-launch kill-switch', () => {
    expect(POOL_HEALTH_THRESHOLDS.userInflowPct.enabled).toBe(false);
    expect(evaluateHealth(0.03, POOL_HEALTH_THRESHOLDS.userInflowPct)).toBe('na');
  });

  it('na kill-switch overrides numeric value — even a 100% inflow still na while disabled', () => {
    expect(evaluateHealth(100, POOL_HEALTH_THRESHOLDS.userInflowPct)).toBe('na');
  });

  it('avg reuse 1.21 (2026-05-30 prod) maps to ok', () => {
    expect(evaluateHealth(1.21, POOL_HEALTH_THRESHOLDS.avgReusePerVideo)).toBe('ok');
  });

  it('promote 90.6% (2026-05-30 prod) maps to ok', () => {
    expect(evaluateHealth(90.6, POOL_HEALTH_THRESHOLDS.promotePct)).toBe('ok');
  });

  it('NULL/legacy 43% (2026-05-30 prod youtube_videos.source) maps to critical', () => {
    expect(evaluateHealth(43, POOL_HEALTH_THRESHOLDS.nullSourcePct)).toBe('critical');
  });

  it('n() coerces Decimal from caption fail rate path (rounded pct)', () => {
    // Caption-fail-rate path uses round(..., 1) → Prisma.Decimal. This test
    // would have caught the original PR #807 Decimal bug if it had existed.
    const dec = new Prisma.Decimal('58.0');
    expect(n(dec)).toBe(58);
    expect(evaluateHealth(n(dec), POOL_HEALTH_THRESHOLDS.captionFailRate7d)).toBe('critical');
  });

  it('n() coerces hours_since (extract epoch / 3600) — float8 path', () => {
    // hours_since uses `extract(epoch FROM ...) / 3600.0` → numeric → Decimal.
    expect(n(new Prisma.Decimal('0.5'))).toBe(0.5);
    expect(n(new Prisma.Decimal('8.25'))).toBe(8.25);
  });
});
