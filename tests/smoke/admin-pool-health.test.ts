/**
 * Admin Pool Health — unit + threshold smoke tests.
 *
 * Verifies the health-band evaluation maths and the baseline thresholds
 * picked from the 2026-05-30 prod measurement. No DB, no network.
 */

import { POOL_HEALTH_THRESHOLDS, evaluateHealth, type HealthBand } from '@/config/pool-health';

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

describe('POOL_HEALTH_THRESHOLDS — baseline expectations', () => {
  it('rich-summary 33.3% (2026-05-30 prod) maps to critical', () => {
    expect(evaluateHealth(33.3, POOL_HEALTH_THRESHOLDS.richSummaryPct)).toBe('critical');
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
});
