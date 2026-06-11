/**
 * Pool-serve config (CP499+ — UX 원칙 2 "빈 셀 = 풀 서빙으로 충당").
 *
 * Gates the ASYNC pool-serving consumer of the A-2 relevance gate cache
 * (`video_mandala_relevance`): empty/deficit cells are filled from the ko
 * pool, every candidate passing the SEMANTIC relevance judge
 * (computeCardRelevance) — this is the pool-side implementation of the
 * "v5 공통 관련성 게이트" precondition (CP494+1 incident: pool serving
 * without a judge is forbidden; lexical tsvector is candidate RECRUITMENT
 * only, never the verdict). The legacy no-judge V5_POOL_BACKFILL stays OFF.
 *
 * ⚠️ PROVISIONAL VALUES — canary-validation targets, NOT law (threshold,
 * floors, limits re-tuned on the K8s-mandala canary).
 *
 * Default: OFF. Rollback = flip env; no code revert.
 *
 * Zero-pass cells stay HONESTLY EMPTY (no irrelevant injection — 원칙 2).
 * RESERVED follow-up (James 2026-06-11, NOT in this scope): un-filled cells
 * → live ko re-search fallback (F3 family); canary measures 충당률 to judge
 * its urgency.
 */

import { z } from 'zod';

const boolFlag = z.preprocess((v) => {
  if (v == null || v === '') return false;
  const s = String(v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}, z.boolean());

export const poolServeEnvSchema = z.object({
  V5_POOL_SERVE: boolFlag.default(false as unknown as string),
  /** Relevance gate threshold (0-100) a pool candidate must reach. */
  V5_POOL_SERVE_RELEVANCE_MIN: z.coerce.number().int().min(0).max(100).default(60),
  /** A cell with fewer placed cards than this is a deficit cell. */
  V5_POOL_SERVE_MIN_PER_CELL: z.coerce.number().int().min(1).max(20).default(3),
  /** Max cards a single fill job may add to one cell. */
  V5_POOL_SERVE_MAX_FILL_PER_CELL: z.coerce.number().int().min(1).max(20).default(4),
  /** Pool candidates recruited per cell (scored until MAX_FILL pass or exhausted). */
  V5_POOL_SERVE_CANDIDATES_LIMIT: z.coerce.number().int().min(1).max(50).default(12),
  /** pg-boss worker teamSize (scoring shares the OpenRouter key — keep low). */
  V5_POOL_SERVE_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  /** 2차 live ko re-search fallback when the pool leaves a cell short.
   *  Default ON — same-bundle lever (James 2026-06-11: no partial-state
   *  exposure; per-cell ONE search.list call cap lives in the worker). */
  V5_POOL_SERVE_LIVE_FALLBACK: boolFlag.default(true as unknown as string),
});

export interface PoolServeConfig {
  enabled: boolean;
  relevanceMin: number;
  minPerCell: number;
  maxFillPerCell: number;
  candidatesLimit: number;
  concurrency: number;
  liveFallback: boolean;
}

const DEFAULTS: PoolServeConfig = {
  enabled: false,
  relevanceMin: 60,
  minPerCell: 3,
  maxFillPerCell: 4,
  candidatesLimit: 12,
  concurrency: 2,
  liveFallback: true,
};

export function loadPoolServeConfig(env: NodeJS.ProcessEnv = process.env): PoolServeConfig {
  const parsed = poolServeEnvSchema.safeParse({
    V5_POOL_SERVE: env['V5_POOL_SERVE'],
    V5_POOL_SERVE_RELEVANCE_MIN: env['V5_POOL_SERVE_RELEVANCE_MIN'],
    V5_POOL_SERVE_MIN_PER_CELL: env['V5_POOL_SERVE_MIN_PER_CELL'],
    V5_POOL_SERVE_MAX_FILL_PER_CELL: env['V5_POOL_SERVE_MAX_FILL_PER_CELL'],
    V5_POOL_SERVE_CANDIDATES_LIMIT: env['V5_POOL_SERVE_CANDIDATES_LIMIT'],
    V5_POOL_SERVE_CONCURRENCY: env['V5_POOL_SERVE_CONCURRENCY'],
    V5_POOL_SERVE_LIVE_FALLBACK: env['V5_POOL_SERVE_LIVE_FALLBACK'],
  });
  if (!parsed.success) return DEFAULTS;
  return {
    enabled: parsed.data.V5_POOL_SERVE,
    relevanceMin: parsed.data.V5_POOL_SERVE_RELEVANCE_MIN,
    minPerCell: parsed.data.V5_POOL_SERVE_MIN_PER_CELL,
    maxFillPerCell: parsed.data.V5_POOL_SERVE_MAX_FILL_PER_CELL,
    candidatesLimit: parsed.data.V5_POOL_SERVE_CANDIDATES_LIMIT,
    concurrency: parsed.data.V5_POOL_SERVE_CONCURRENCY,
    liveFallback: parsed.data.V5_POOL_SERVE_LIVE_FALLBACK,
  };
}
