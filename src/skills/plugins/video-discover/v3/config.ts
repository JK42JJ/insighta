import { z } from 'zod';

import { DEFAULT_RECENCY_HALF_LIFE_MONTHS, DEFAULT_RECENCY_WEIGHT } from './mandala-filter';

export const DEFAULT_PUBLISHED_AFTER_DAYS = 1095;

export type V3EnvInput = Record<string, string | undefined>;

const booleanFlag = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().toLowerCase() === 'true' : Boolean(v)),
  z.boolean()
);

const clampedUnit = z
  .preprocess(
    (v) => (v == null || v === '' ? undefined : Number(v)),
    z.number().finite().min(0).max(1).optional()
  )
  .transform((v) => v ?? DEFAULT_RECENCY_WEIGHT);

const positiveInt = z
  .preprocess(
    (v) => (v == null || v === '' ? undefined : Number(v)),
    z.number().finite().int().positive().optional()
  )
  .transform((v) => v ?? DEFAULT_RECENCY_HALF_LIFE_MONTHS);

const nonNegativeInt = z
  .preprocess(
    (v) => (v == null || v === '' ? undefined : Number(v)),
    z.number().finite().int().nonnegative().optional()
  )
  .transform((v) => v ?? DEFAULT_PUBLISHED_AFTER_DAYS);

export const v3EnvSchema = z.object({
  V3_ENABLE_TIER1_CACHE: booleanFlag.optional().default(false as unknown as string),
  V3_RECENCY_WEIGHT: clampedUnit,
  V3_RECENCY_HALF_LIFE_MONTHS: positiveInt,
  V3_PUBLISHED_AFTER_DAYS: nonNegativeInt,
});

export interface V3Config {
  enableTier1Cache: boolean;
  recencyWeight: number;
  recencyHalfLifeMonths: number;
  publishedAfterDays: number;
}

export function loadV3Config(env: V3EnvInput = process.env): V3Config {
  const parsed = v3EnvSchema.safeParse({
    V3_ENABLE_TIER1_CACHE: env['V3_ENABLE_TIER1_CACHE'],
    V3_RECENCY_WEIGHT: env['V3_RECENCY_WEIGHT'],
    V3_RECENCY_HALF_LIFE_MONTHS: env['V3_RECENCY_HALF_LIFE_MONTHS'],
    V3_PUBLISHED_AFTER_DAYS: env['V3_PUBLISHED_AFTER_DAYS'],
  });
  if (!parsed.success) {
    return {
      enableTier1Cache: false,
      recencyWeight: DEFAULT_RECENCY_WEIGHT,
      recencyHalfLifeMonths: DEFAULT_RECENCY_HALF_LIFE_MONTHS,
      publishedAfterDays: DEFAULT_PUBLISHED_AFTER_DAYS,
    };
  }
  return {
    enableTier1Cache: parsed.data.V3_ENABLE_TIER1_CACHE,
    recencyWeight: parsed.data.V3_RECENCY_WEIGHT,
    recencyHalfLifeMonths: parsed.data.V3_RECENCY_HALF_LIFE_MONTHS,
    publishedAfterDays: parsed.data.V3_PUBLISHED_AFTER_DAYS,
  };
}

export const v3Config: V3Config = loadV3Config();
