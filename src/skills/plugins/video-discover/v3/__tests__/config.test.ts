import { DEFAULT_PUBLISHED_AFTER_DAYS, loadV3Config } from '../config';
import { DEFAULT_RECENCY_HALF_LIFE_MONTHS, DEFAULT_RECENCY_WEIGHT } from '../mandala-filter';

describe('loadV3Config', () => {
  test('empty env → activated defaults (Tier 1 off, recency on, 3yr cutoff)', () => {
    expect(loadV3Config({})).toEqual({
      enableTier1Cache: false,
      recencyWeight: DEFAULT_RECENCY_WEIGHT,
      recencyHalfLifeMonths: DEFAULT_RECENCY_HALF_LIFE_MONTHS,
      publishedAfterDays: DEFAULT_PUBLISHED_AFTER_DAYS,
    });
  });

  test('V3_ENABLE_TIER1_CACHE="true" → enabled (case-insensitive, trimmed)', () => {
    expect(loadV3Config({ V3_ENABLE_TIER1_CACHE: 'true' }).enableTier1Cache).toBe(true);
    expect(loadV3Config({ V3_ENABLE_TIER1_CACHE: '  TRUE  ' }).enableTier1Cache).toBe(true);
    expect(loadV3Config({ V3_ENABLE_TIER1_CACHE: 'false' }).enableTier1Cache).toBe(false);
    expect(loadV3Config({ V3_ENABLE_TIER1_CACHE: '' }).enableTier1Cache).toBe(false);
  });

  test('V3_RECENCY_WEIGHT parses valid [0,1] values', () => {
    expect(loadV3Config({ V3_RECENCY_WEIGHT: '0.15' }).recencyWeight).toBeCloseTo(0.15, 6);
    expect(loadV3Config({ V3_RECENCY_WEIGHT: '0' }).recencyWeight).toBe(0);
    expect(loadV3Config({ V3_RECENCY_WEIGHT: '1' }).recencyWeight).toBe(1);
  });

  test('invalid V3_RECENCY_WEIGHT → baseline (entire config falls back)', () => {
    // Out of range: zod rejects, loadV3Config returns baseline
    expect(loadV3Config({ V3_RECENCY_WEIGHT: '1.5' }).recencyWeight).toBe(DEFAULT_RECENCY_WEIGHT);
    expect(loadV3Config({ V3_RECENCY_WEIGHT: '-0.1' }).recencyWeight).toBe(DEFAULT_RECENCY_WEIGHT);
    expect(loadV3Config({ V3_RECENCY_WEIGHT: 'NaN' }).recencyWeight).toBe(DEFAULT_RECENCY_WEIGHT);
  });

  test('V3_RECENCY_HALF_LIFE_MONTHS requires positive integer', () => {
    expect(loadV3Config({ V3_RECENCY_HALF_LIFE_MONTHS: '24' }).recencyHalfLifeMonths).toBe(24);
    // negative / zero / non-int → baseline
    expect(loadV3Config({ V3_RECENCY_HALF_LIFE_MONTHS: '0' }).recencyHalfLifeMonths).toBe(
      DEFAULT_RECENCY_HALF_LIFE_MONTHS
    );
    expect(loadV3Config({ V3_RECENCY_HALF_LIFE_MONTHS: '-3' }).recencyHalfLifeMonths).toBe(
      DEFAULT_RECENCY_HALF_LIFE_MONTHS
    );
  });

  test('V3_PUBLISHED_AFTER_DAYS accepts non-negative integer', () => {
    expect(loadV3Config({ V3_PUBLISHED_AFTER_DAYS: '1095' }).publishedAfterDays).toBe(1095);
    expect(loadV3Config({ V3_PUBLISHED_AFTER_DAYS: '0' }).publishedAfterDays).toBe(0);
    // invalid → entire schema fails → error fallback returns the activated default
    expect(loadV3Config({ V3_PUBLISHED_AFTER_DAYS: '-5' }).publishedAfterDays).toBe(
      DEFAULT_PUBLISHED_AFTER_DAYS
    );
    expect(loadV3Config({ V3_PUBLISHED_AFTER_DAYS: 'garbage' }).publishedAfterDays).toBe(
      DEFAULT_PUBLISHED_AFTER_DAYS
    );
  });

  test('combined: realistic CP391 rollout config', () => {
    expect(
      loadV3Config({
        V3_RECENCY_WEIGHT: '0.15',
        V3_RECENCY_HALF_LIFE_MONTHS: '18',
        V3_PUBLISHED_AFTER_DAYS: '1095',
      })
    ).toEqual({
      enableTier1Cache: false,
      recencyWeight: 0.15,
      recencyHalfLifeMonths: 18,
      publishedAfterDays: 1095,
    });
  });
});
