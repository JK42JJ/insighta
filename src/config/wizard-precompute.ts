/**
 * Wizard Precompute Pipeline config (CP424.2).
 *
 * Single feature flag gates the entire precompute path:
 * - /wizard-stream: when enabled + body.session_id present → fire-and-forget
 *   `startPrecompute(session_id)` via setImmediate.
 * - /create-with-data: when enabled + body.session_id present → lookup
 *   precompute row; if status=done, INSERT recommendation_cache + notify;
 *   else fall back to existing post-creation pipeline.
 *
 * Default: OFF. Turning on requires explicit compose env set; code revert
 * unnecessary for rollback.
 */

import { z } from 'zod';

const boolFlag = z.preprocess((v) => {
  if (v == null || v === '') return false;
  const s = String(v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}, z.boolean());

export const wizardPrecomputeEnvSchema = z.object({
  WIZARD_PRECOMPUTE_ENABLED: boolFlag.default(false as unknown as string),
});

export interface WizardPrecomputeConfig {
  enabled: boolean;
}

export function loadWizardPrecomputeConfig(
  env: NodeJS.ProcessEnv = process.env
): WizardPrecomputeConfig {
  const parsed = wizardPrecomputeEnvSchema.safeParse({
    WIZARD_PRECOMPUTE_ENABLED: env['WIZARD_PRECOMPUTE_ENABLED'],
  });
  if (!parsed.success) {
    return { enabled: false };
  }
  return { enabled: parsed.data.WIZARD_PRECOMPUTE_ENABLED };
}
