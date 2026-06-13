/**
 * Relevance rubric config (CP499+ diagnosis A score pipeline).
 *
 * Single feature flag gates the new score pipeline as one unit:
 * - PURE 3-axis rubric scoring (cell_fit / goal_contribution / actionability,
 *   composed in code — see src/modules/relevance/relevance-composition.ts).
 *   CP500+ 축 분리 (James 2026-06-12): NO freshness term in the score —
 *   relevance ≠ recency; the volatile-only 70/30 recency QUOTA is a
 *   placement-layer follow-up (score-independent).
 * - volatility persistence from merged-gen output (STAYS — the placement-layer
 *   quota is its consumer).
 *
 * Default: OFF (unset = legacy single-axis scoring, byte-identical prompt).
 * Rollback = flip env; no code revert.
 */

import { z } from 'zod';

const boolFlag = z.preprocess((v) => {
  if (v == null || v === '') return false;
  const s = String(v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}, z.boolean());

export const relevanceRubricEnvSchema = z.object({
  RELEVANCE_RUBRIC_ENABLED: boolFlag.default(false as unknown as string),
  /** CP500+ R1 bundle — post-placement re-score prune (auto-inflow rows ONLY,
   *  James rule: the system may delete only what it inserted). Default OFF →
   *  canary → fleet. */
  BATCH_GATE_PRUNE: boolFlag.default(false as unknown as string),
  /** goal_contribution gate threshold (measured spec: 65). */
  BATCH_GATE_GC_MIN: z.coerce.number().int().min(0).max(100).default(65),
});

export interface RelevanceRubricConfig {
  enabled: boolean;
  prune: boolean;
  pruneGcMin: number;
}

export function loadRelevanceRubricConfig(
  env: NodeJS.ProcessEnv = process.env
): RelevanceRubricConfig {
  const parsed = relevanceRubricEnvSchema.safeParse({
    RELEVANCE_RUBRIC_ENABLED: env['RELEVANCE_RUBRIC_ENABLED'],
    BATCH_GATE_PRUNE: env['BATCH_GATE_PRUNE'],
    BATCH_GATE_GC_MIN: env['BATCH_GATE_GC_MIN'],
  });
  if (!parsed.success) {
    return { enabled: false, prune: false, pruneGcMin: 65 };
  }
  return {
    enabled: parsed.data.RELEVANCE_RUBRIC_ENABLED,
    prune: parsed.data.BATCH_GATE_PRUNE,
    pruneGcMin: parsed.data.BATCH_GATE_GC_MIN,
  };
}
