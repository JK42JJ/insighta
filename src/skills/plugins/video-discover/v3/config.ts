import { z } from 'zod';

import { DEFAULT_SEMANTIC_ALPHA, DEFAULT_SEMANTIC_BETA } from '@/modules/video-dictionary';

import { DEFAULT_RECENCY_HALF_LIFE_MONTHS, DEFAULT_RECENCY_WEIGHT } from './mandala-filter';

export const DEFAULT_PUBLISHED_AFTER_DAYS = 1095;

/**
 * Per-call timeout for YouTube search.list in v3 discovery.
 *
 * 1000ms is empirically below the p95 of normal YouTube Data API
 * latency from our EC2 region → any call exceeding this is on the
 * tail and would otherwise bottleneck the entire Promise.allSettled
 * fan-out (`v3/executor.ts:755`). Tail calls are cut and treated as
 * `partial` results (missing items, not a pipeline failure). See
 * Phase 1 slice 1 rationale in the PR description.
 */
export const DEFAULT_YOUTUBE_SEARCH_TIMEOUT_MS = 1000;

/**
 * Runtime ceiling for YouTube search queries issued per video-discover
 * call (rule-based + LLM combined). CP416 Phase 3 direction: with the
 * semantic center gate doing recall, 3-5 broad queries replace the
 * 20 narrow queries of the lexical-gate era. Default stays at 20 for
 * safety; flip `V3_MAX_QUERIES=5` in prod once semantic mode telemetry
 * looks healthy. Hard upper bound remains `MAX_QUERIES = 20` in
 * `v2/keyword-builder.ts` (this value is clamped to that ceiling).
 */
export const DEFAULT_MAX_QUERIES = 20;

/**
 * Center-gate matching mode (post-SGNL-parity carding-quality audit).
 *
 * - `'substring'` (pre-audit default): token-level substring overlap.
 *   Fast but fails for Korean composite words — `"모닝루틴"` does not
 *   contain `"루틴으로"` as a substring and vice versa, so legitimate
 *   videos titled `엄지원의 모닝루틴 7가지` are dropped from goals like
 *   `1달 일일 루틴으로 전문가되기`. Measured Recall 0% / 15 on a 20-item
 *   fixture — see `scripts/verify-mandala-filter-hypothesis.ts`.
 *
 * - `'subword'`: character 2-gram overlap between each center token and
 *   the title's combined 2-gram bag. A center token is considered
 *   matched when ≥ 30% of its 2-grams appear in the title. Catches the
 *   composite-word case without a morphological analyzer. Measured
 *   Recall 0.27 / Precision 1.00 on the same fixture (4 of 15 RELEVANT
 *   kept, 0 NOISE).
 *
 * - `'off'`: skip the center gate entirely, let the sub-goal jaccard
 *   stage (MIN_SUB_RELEVANCE) do the filtering alone. Widest net; use
 *   when the center phrase is highly specific and the sub-goals cover
 *   the semantic space.
 *
 * - `'semantic'` (CP416 Phase 3): cosine similarity between the center
 *   goal embedding and each candidate's title embedding (4096d qwen3-
 *   embedding:8b, same space as `mandala_embeddings`). A candidate
 *   passes when cosine ≥ `SEMANTIC_MIN_COSINE` (default 0.35). Intended
 *   to replace lexical gates: language-agnostic, catches paraphrases
 *   ("루틴으로 전문가되기" ↔ "하루 습관 형성하는 법"). Requires
 *   `centerEmbedding` + `candidateEmbeddings` on the filter input —
 *   callers that omit embeddings fall back to `'substring'` behavior
 *   for safety (mandala-filter.ts enforces).
 */
export type CenterGateMode = 'substring' | 'subword' | 'off' | 'semantic';
export const DEFAULT_CENTER_GATE_MODE: CenterGateMode = 'substring';

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

const semanticAlpha = z
  .preprocess(
    (v) => (v == null || v === '' ? undefined : Number(v)),
    z.number().finite().min(0).max(1).optional()
  )
  .transform((v) => v ?? DEFAULT_SEMANTIC_ALPHA);

const semanticBeta = z
  .preprocess(
    (v) => (v == null || v === '' ? undefined : Number(v)),
    z.number().finite().min(0).max(1).optional()
  )
  .transform((v) => v ?? DEFAULT_SEMANTIC_BETA);

const youtubeSearchTimeoutMs = z
  .preprocess(
    (v) => (v == null || v === '' ? undefined : Number(v)),
    z.number().finite().int().positive().optional()
  )
  .transform((v) => v ?? DEFAULT_YOUTUBE_SEARCH_TIMEOUT_MS);

const maxQueries = z
  .preprocess(
    (v) => (v == null || v === '' ? undefined : Number(v)),
    z.number().finite().int().positive().optional()
  )
  .transform((v) => v ?? DEFAULT_MAX_QUERIES);

const centerGateMode = z
  .preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
    z.enum(['substring', 'subword', 'off', 'semantic']).optional()
  )
  .transform((v) => v ?? DEFAULT_CENTER_GATE_MODE);

export const DEFAULT_MIN_VIEW_COUNT = 1000;
export const DEFAULT_MIN_VIEWS_PER_DAY = 10;

const minViewCount = z
  .preprocess(
    (v) => (v == null || v === '' ? undefined : Number(v)),
    z.number().finite().int().nonnegative().optional()
  )
  .transform((v) => v ?? DEFAULT_MIN_VIEW_COUNT);

const minViewsPerDay = z
  .preprocess(
    (v) => (v == null || v === '' ? undefined : Number(v)),
    z.number().finite().nonnegative().optional()
  )
  .transform((v) => v ?? DEFAULT_MIN_VIEWS_PER_DAY);

export const v3EnvSchema = z.object({
  V3_ENABLE_TIER1_CACHE: booleanFlag.optional().default(false as unknown as string),
  V3_RECENCY_WEIGHT: clampedUnit,
  V3_RECENCY_HALF_LIFE_MONTHS: positiveInt,
  V3_PUBLISHED_AFTER_DAYS: nonNegativeInt,
  V3_ENABLE_SEMANTIC_RERANK: booleanFlag.optional().default(false as unknown as string),
  V3_SEMANTIC_ALPHA: semanticAlpha,
  V3_SEMANTIC_BETA: semanticBeta,
  V3_ENABLE_WHITELIST_GATE: booleanFlag.optional().default(false as unknown as string),
  V3_YOUTUBE_SEARCH_TIMEOUT_MS: youtubeSearchTimeoutMs,
  V3_CENTER_GATE_MODE: centerGateMode,
  V3_MAX_QUERIES: maxQueries,
  V3_ENABLE_QUALITY_GATE: booleanFlag.optional().default(false as unknown as string),
  V3_MIN_VIEW_COUNT: minViewCount,
  V3_MIN_VIEWS_PER_DAY: minViewsPerDay,
});

export interface V3Config {
  enableTier1Cache: boolean;
  recencyWeight: number;
  recencyHalfLifeMonths: number;
  publishedAfterDays: number;
  enableSemanticRerank: boolean;
  semanticAlpha: number;
  semanticBeta: number;
  enableWhitelistGate: boolean;
  youtubeSearchTimeoutMs: number;
  centerGateMode: CenterGateMode;
  maxQueries: number;
  enableQualityGate: boolean;
  minViewCount: number;
  minViewsPerDay: number;
}

export function loadV3Config(env: V3EnvInput = process.env): V3Config {
  const parsed = v3EnvSchema.safeParse({
    V3_ENABLE_TIER1_CACHE: env['V3_ENABLE_TIER1_CACHE'],
    V3_RECENCY_WEIGHT: env['V3_RECENCY_WEIGHT'],
    V3_RECENCY_HALF_LIFE_MONTHS: env['V3_RECENCY_HALF_LIFE_MONTHS'],
    V3_PUBLISHED_AFTER_DAYS: env['V3_PUBLISHED_AFTER_DAYS'],
    V3_ENABLE_SEMANTIC_RERANK: env['V3_ENABLE_SEMANTIC_RERANK'],
    V3_SEMANTIC_ALPHA: env['V3_SEMANTIC_ALPHA'],
    V3_SEMANTIC_BETA: env['V3_SEMANTIC_BETA'],
    V3_ENABLE_WHITELIST_GATE: env['V3_ENABLE_WHITELIST_GATE'],
    V3_YOUTUBE_SEARCH_TIMEOUT_MS: env['V3_YOUTUBE_SEARCH_TIMEOUT_MS'],
    V3_CENTER_GATE_MODE: env['V3_CENTER_GATE_MODE'],
    V3_MAX_QUERIES: env['V3_MAX_QUERIES'],
    V3_ENABLE_QUALITY_GATE: env['V3_ENABLE_QUALITY_GATE'],
    V3_MIN_VIEW_COUNT: env['V3_MIN_VIEW_COUNT'],
    V3_MIN_VIEWS_PER_DAY: env['V3_MIN_VIEWS_PER_DAY'],
  });
  if (!parsed.success) {
    return {
      enableTier1Cache: false,
      recencyWeight: DEFAULT_RECENCY_WEIGHT,
      recencyHalfLifeMonths: DEFAULT_RECENCY_HALF_LIFE_MONTHS,
      publishedAfterDays: DEFAULT_PUBLISHED_AFTER_DAYS,
      enableSemanticRerank: false,
      semanticAlpha: DEFAULT_SEMANTIC_ALPHA,
      semanticBeta: DEFAULT_SEMANTIC_BETA,
      enableWhitelistGate: false,
      youtubeSearchTimeoutMs: DEFAULT_YOUTUBE_SEARCH_TIMEOUT_MS,
      centerGateMode: DEFAULT_CENTER_GATE_MODE,
      maxQueries: DEFAULT_MAX_QUERIES,
      enableQualityGate: false,
      minViewCount: DEFAULT_MIN_VIEW_COUNT,
      minViewsPerDay: DEFAULT_MIN_VIEWS_PER_DAY,
    };
  }
  return {
    enableTier1Cache: parsed.data.V3_ENABLE_TIER1_CACHE,
    recencyWeight: parsed.data.V3_RECENCY_WEIGHT,
    recencyHalfLifeMonths: parsed.data.V3_RECENCY_HALF_LIFE_MONTHS,
    publishedAfterDays: parsed.data.V3_PUBLISHED_AFTER_DAYS,
    enableSemanticRerank: parsed.data.V3_ENABLE_SEMANTIC_RERANK,
    semanticAlpha: parsed.data.V3_SEMANTIC_ALPHA,
    semanticBeta: parsed.data.V3_SEMANTIC_BETA,
    enableWhitelistGate: parsed.data.V3_ENABLE_WHITELIST_GATE,
    youtubeSearchTimeoutMs: parsed.data.V3_YOUTUBE_SEARCH_TIMEOUT_MS,
    centerGateMode: parsed.data.V3_CENTER_GATE_MODE,
    maxQueries: parsed.data.V3_MAX_QUERIES,
    enableQualityGate: parsed.data.V3_ENABLE_QUALITY_GATE,
    minViewCount: parsed.data.V3_MIN_VIEW_COUNT,
    minViewsPerDay: parsed.data.V3_MIN_VIEWS_PER_DAY,
  };
}

export const v3Config: V3Config = loadV3Config();
