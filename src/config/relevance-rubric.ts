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
});

export interface RelevanceRubricConfig {
  enabled: boolean;
}

export function loadRelevanceRubricConfig(
  env: NodeJS.ProcessEnv = process.env
): RelevanceRubricConfig {
  const parsed = relevanceRubricEnvSchema.safeParse({
    RELEVANCE_RUBRIC_ENABLED: env['RELEVANCE_RUBRIC_ENABLED'],
  });
  if (!parsed.success) {
    return { enabled: false };
  }
  return { enabled: parsed.data.RELEVANCE_RUBRIC_ENABLED };
}
