/**
 * Diversity guard config (CP500+ — UX 원칙 2 "다양성" 축).
 *
 * Gates the series-dedup + soft channel cap on the v5 placement, pool-serve
 * and live-fallback paths (src/skills/plugins/video-discover/diversity-guard.ts).
 *
 * Default OFF per the hard rule (unset = 기존 동작); activation lives in
 * docker-compose.prod.yml (`V5_DIVERSITY_GUARD=true`). Rollback = delete the
 * compose line + redeploy, no code revert.
 *
 * ⚠️ PROVISIONAL VALUES — threshold/cap are canary-tuned settings, not law.
 */

import { z } from 'zod';

const boolFlag = z.preprocess((v) => {
  if (v == null || v === '') return false;
  const s = String(v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}, z.boolean());

export const diversityGuardEnvSchema = z.object({
  V5_DIVERSITY_GUARD: boolFlag.default(false as unknown as string),
  /** Episode-stripped title similarity (token Jaccard) to call two uploads one series. */
  V5_SERIES_DEDUP_SIM: z.coerce.number().min(0).max(1).default(0.8),
  /** Cards one channel keeps at priority per cell; the (n+1)-th onward is demoted (soft). */
  V5_CHANNEL_SOFT_CAP: z.coerce.number().int().min(1).max(10).default(2),
});

export interface DiversityGuardConfig {
  enabled: boolean;
  seriesSim: number;
  channelSoftCap: number;
}

const DEFAULTS: DiversityGuardConfig = {
  enabled: false,
  seriesSim: 0.8,
  channelSoftCap: 2,
};

export function loadDiversityGuardConfig(
  env: NodeJS.ProcessEnv = process.env
): DiversityGuardConfig {
  const parsed = diversityGuardEnvSchema.safeParse({
    V5_DIVERSITY_GUARD: env['V5_DIVERSITY_GUARD'],
    V5_SERIES_DEDUP_SIM: env['V5_SERIES_DEDUP_SIM'],
    V5_CHANNEL_SOFT_CAP: env['V5_CHANNEL_SOFT_CAP'],
  });
  if (!parsed.success) return DEFAULTS;
  return {
    enabled: parsed.data.V5_DIVERSITY_GUARD,
    seriesSim: parsed.data.V5_SERIES_DEDUP_SIM,
    channelSoftCap: parsed.data.V5_CHANNEL_SOFT_CAP,
  };
}
