/**
 * Wizard merged-generation config (CP493).
 *
 * Single feature flag gates the merged structure+queries generation path:
 * - /wizard-stream: when enabled → ONE Haiku call produces the mandala
 *   structure AND the per-cell YouTube search queries in a single continuous
 *   context, instead of the two disconnected calls (structure-gen at creation
 *   + query-gen at fanout). The merged queries are forwarded to precompute as
 *   `precomputedQueries`, so fanout skips its own query-gen.
 *
 * Why: measured (CP492/CP493) the two-call split re-interprets bare cell
 * labels with no goal-structure reasoning → near-duplicate clustering noise
 * (e.g. a cell filled with 6 same-brand videos). A merged single call keeps
 * the center-goal context continuous → diverse, non-clustered queries.
 *
 * Default: OFF (unset = legacy two-call behavior). Rollback = flip env; no
 * code revert. On merged failure the route falls back to the legacy
 * generateMandalaStructure + fanout query-gen path (graceful degrade).
 */

import { z } from 'zod';

const boolFlag = z.preprocess((v) => {
  if (v == null || v === '') return false;
  const s = String(v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}, z.boolean());

export const wizardMergedGenEnvSchema = z.object({
  WIZARD_MERGED_GEN: boolFlag.default(false as unknown as string),
});

export interface WizardMergedGenConfig {
  enabled: boolean;
}

export function loadWizardMergedGenConfig(
  env: NodeJS.ProcessEnv = process.env
): WizardMergedGenConfig {
  const parsed = wizardMergedGenEnvSchema.safeParse({
    WIZARD_MERGED_GEN: env['WIZARD_MERGED_GEN'],
  });
  if (!parsed.success) {
    return { enabled: false };
  }
  return { enabled: parsed.data.WIZARD_MERGED_GEN };
}
