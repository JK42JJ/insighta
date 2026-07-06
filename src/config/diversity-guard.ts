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
  /**
   * CP511+1 — global (cross-cell) channel cap, closes the gap softChannelCap
   * cannot (a channel under-cap in every individual cell can still monopolize
   * the aggregate list). 0 = off (default; unset = 기존 동작). DEMOTE only —
   * never drops, so the 50~70 card-count floor is never at risk from this
   * knob alone. Measured rationale: mandala 7d5d759e (영어) add_cards trace
   * 42da98a6, 2026-07-06 — 말트영어 10/49 PLACED cards (top3 share 34.7%)
   * with soft-cap=2/cell already active; cap=3 GLOBAL demotes it to 3
   * primary + 7 tail (top3 share → 22%), count unchanged (49→49).
   */
  V5_CHANNEL_HARD_CAP: z.coerce.number().int().min(0).max(20).default(0),
  /** Hard cap only fires above this pool size (thin-supply skip, same principle as softChannelCap). */
  V5_CHANNEL_HARD_CAP_MIN_CANDIDATES: z.coerce.number().int().min(1).default(30),
  /**
   * CP511+1 — cross-channel (not same-channel-only like dedupeSeries) title
   * similarity dedup, DEMOTE only. Default off. Measured limitation (same
   * trace): 3 known near-duplicate "100문장/생활영어" titles from one channel
   * scored 0.12-0.17 token-Jaccard (stripEpisodeTokens) — well BELOW this
   * conservative default; SEO-padded titles dilute whole-title token overlap.
   * Ships as specified but does not (yet) catch that specific spam pattern —
   * see handoff report.
   */
  V5_CROSS_CHANNEL_TITLE_DEDUP: boolFlag.default(false as unknown as string),
  V5_CROSS_CHANNEL_DEDUP_SIM: z.coerce.number().min(0).max(1).default(0.65),
});

export interface DiversityGuardConfig {
  enabled: boolean;
  seriesSim: number;
  channelSoftCap: number;
  channelHardCap: number;
  channelHardCapMinCandidates: number;
  crossChannelDedupEnabled: boolean;
  crossChannelDedupSim: number;
}

const DEFAULTS: DiversityGuardConfig = {
  enabled: false,
  seriesSim: 0.8,
  channelSoftCap: 2,
  channelHardCap: 0,
  channelHardCapMinCandidates: 30,
  crossChannelDedupEnabled: false,
  crossChannelDedupSim: 0.65,
};

export function loadDiversityGuardConfig(
  env: NodeJS.ProcessEnv = process.env
): DiversityGuardConfig {
  const parsed = diversityGuardEnvSchema.safeParse({
    V5_DIVERSITY_GUARD: env['V5_DIVERSITY_GUARD'],
    V5_SERIES_DEDUP_SIM: env['V5_SERIES_DEDUP_SIM'],
    V5_CHANNEL_SOFT_CAP: env['V5_CHANNEL_SOFT_CAP'],
    V5_CHANNEL_HARD_CAP: env['V5_CHANNEL_HARD_CAP'],
    V5_CHANNEL_HARD_CAP_MIN_CANDIDATES: env['V5_CHANNEL_HARD_CAP_MIN_CANDIDATES'],
    V5_CROSS_CHANNEL_TITLE_DEDUP: env['V5_CROSS_CHANNEL_TITLE_DEDUP'],
    V5_CROSS_CHANNEL_DEDUP_SIM: env['V5_CROSS_CHANNEL_DEDUP_SIM'],
  });
  if (!parsed.success) return DEFAULTS;
  return {
    enabled: parsed.data.V5_DIVERSITY_GUARD,
    seriesSim: parsed.data.V5_SERIES_DEDUP_SIM,
    channelSoftCap: parsed.data.V5_CHANNEL_SOFT_CAP,
    channelHardCap: parsed.data.V5_CHANNEL_HARD_CAP,
    channelHardCapMinCandidates: parsed.data.V5_CHANNEL_HARD_CAP_MIN_CANDIDATES,
    crossChannelDedupEnabled: parsed.data.V5_CROSS_CHANNEL_TITLE_DEDUP,
    crossChannelDedupSim: parsed.data.V5_CROSS_CHANNEL_DEDUP_SIM,
  };
}
