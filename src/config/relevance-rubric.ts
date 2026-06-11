/**
 * Relevance rubric config (CP499+ diagnosis A score pipeline).
 *
 * Single feature flag gates the WHOLE new score pipeline as one unit:
 * - 3-axis rubric scoring (cell_fit / goal_contribution / actionability,
 *   composed in code — see src/modules/relevance/relevance-composition.ts)
 * - volatile-only recency bonus (needs user_mandalas.volatility)
 * - volatility persistence from merged-gen output
 *
 * Default: OFF (unset = legacy single-axis scoring, byte-identical prompt).
 * Rollback = flip env; no code revert.
 *
 * ⚠️ Deploy-order precondition: the `user_mandalas.volatility` column DDL
 * (prisma/migrations/score-pipeline/001) must be applied to an environment
 * BEFORE this flag is turned on there — the worker/persist paths select the
 * column only when enabled. Prod DDL execution is a separate per-step
 * approval (NOT automatic with the PR merge).
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
