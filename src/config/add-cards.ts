/**
 * Add Cards feature config (CP466, 2026-05-18).
 *
 * Spec: docs/design/add-cards-2026-05-18.md §5 (Internal pipeline) +
 * §10 (Hard Rule — 하드코딩 금지: zod schema + env override).
 *
 * Constants:
 *   - Layer 4 feedback bias α-weights (channel match + embedding cosine)
 *   - Max boost cap (도배 회피, ≤ 20% per user directive 인용)
 *   - Drift guard cosine threshold (liked_centroid vs center_goal)
 *   - Result limit (cards per response)
 *   - Echo-chamber caps (channel + sub_goal)
 *   - Tier 1 KNN limit (video_pool_embeddings cosine search)
 *
 * All overridable via env at deploy time. Defaults match spec §4 +
 * card-refresh-strategy.md §4 (legacy doc, superseded).
 */

import { z } from 'zod';

const positiveNumber = z.preprocess(
  (v) => (v == null || v === '' ? undefined : Number(v)),
  z.number().finite().positive().optional()
);

const nonNegativeFloat = z.preprocess(
  (v) => (v == null || v === '' ? undefined : Number(v)),
  z.number().finite().nonnegative().optional()
);

const positiveInt = z.preprocess(
  (v) => (v == null || v === '' ? undefined : Number(v)),
  z.number().finite().int().positive().optional()
);

const cosineRange = z.preprocess(
  (v) => (v == null || v === '' ? undefined : Number(v)),
  z.number().finite().min(0).max(1).optional()
);

export const addCardsEnvSchema = z.object({
  // Layer 4 feedback bias weights.
  // α_channel: bonus applied when candidate's channel ∈ user's liked-channels.
  // α_embed: bonus applied to candidate's cosine vs liked_centroid embedding.
  ADD_CARDS_ALPHA_CHANNEL: nonNegativeFloat.transform((v) => v ?? 0.08),
  ADD_CARDS_ALPHA_EMBED: nonNegativeFloat.transform((v) => v ?? 0.1),

  // Hard cap on the cumulative feedback boost (spec §5 step 8).
  // Per user directive (인용): "유튜브처럼 도배하면 안 되. 일부 가중치만 조금 더."
  ADD_CARDS_MAX_FEEDBACK_BOOST: nonNegativeFloat.transform((v) => v ?? 0.2),

  // Drift guard cosine threshold. If cosine(liked_centroid,
  // mandala.center_goal_embedding) < DRIFT_GUARD_COSINE, Layer 4 is
  // disabled for the session (feedback has drifted off mandala intent).
  ADD_CARDS_DRIFT_GUARD_COSINE: cosineRange.transform((v) => v ?? 0.5),

  // Response card limit (panel viewport size).
  ADD_CARDS_LIMIT_DEFAULT: positiveInt.transform((v) => v ?? 40),

  // Echo-chamber caps (CP466 decision C9 — channel + sub_goal only, cluster v2+).
  ADD_CARDS_CHANNEL_CAP: positiveInt.transform((v) => v ?? 2),
  ADD_CARDS_SUBGOAL_CAP: positiveInt.transform((v) => v ?? 4),

  // Tier 1 video_pool_embeddings KNN candidate pool size (before mandala-filter).
  // Per spec §5 step 5: 9 cells × 60 buffer = 540 default.
  ADD_CARDS_TIER1_KNN_LIMIT: positiveInt.transform((v) => v ?? 540),

  // Semantic cosine floor for video_pool match. Spec §4 (realtime-search-pipeline
  // ref) default 0.45.
  ADD_CARDS_SEMANTIC_THRESHOLD: cosineRange.transform((v) => v ?? 0.45),

  // Liked-history window for feedback bias centroid computation.
  // Most recent N signals (signal='like'). Spec §5 step 8.
  ADD_CARDS_LIKED_HISTORY_LIMIT: positiveInt.transform((v) => v ?? 100),

  // Time-decay half-life (days) applied to liked centroid weight.
  // Older likes contribute less. Aligned with card-refresh-strategy.md §3
  // "Explicit Like → 14 days (exp)".
  ADD_CARDS_LIKED_DECAY_HALF_LIFE_DAYS: positiveNumber.transform((v) => v ?? 14),

  // CP489 Phase 2+3 — reuse boost for previously surfaced (shown-but-not-picked)
  // cards in the same mandala. Multiplies candidate score by (1 + boost) when
  // candidate.videoId is in the surfacedSet. Default 0.05 (+5%) — small enough
  // that fresh high-cosine matches still win, large enough that a borderline
  // candidate surfaces back into the cumulative response across search rounds.
  ADD_CARDS_SURFACE_BOOST: cosineRange.transform((v) => v ?? 0.05),
});

export interface AddCardsConfig {
  alphaChannel: number;
  alphaEmbed: number;
  maxFeedbackBoost: number;
  driftGuardCosine: number;
  limitDefault: number;
  channelCap: number;
  subgoalCap: number;
  tier1KnnLimit: number;
  semanticThreshold: number;
  likedHistoryLimit: number;
  likedDecayHalfLifeDays: number;
  surfaceBoost: number;
}

const FALLBACK_CONFIG: AddCardsConfig = {
  alphaChannel: 0.08,
  alphaEmbed: 0.1,
  maxFeedbackBoost: 0.2,
  driftGuardCosine: 0.5,
  limitDefault: 40,
  channelCap: 2,
  subgoalCap: 4,
  tier1KnnLimit: 540,
  semanticThreshold: 0.45,
  likedHistoryLimit: 100,
  likedDecayHalfLifeDays: 14,
  surfaceBoost: 0.05,
};

let cached: AddCardsConfig | null = null;

export function getAddCardsConfig(env: NodeJS.ProcessEnv = process.env): AddCardsConfig {
  if (cached) return cached;
  try {
    const parsed = addCardsEnvSchema.parse(env);
    cached = {
      alphaChannel: parsed.ADD_CARDS_ALPHA_CHANNEL,
      alphaEmbed: parsed.ADD_CARDS_ALPHA_EMBED,
      maxFeedbackBoost: parsed.ADD_CARDS_MAX_FEEDBACK_BOOST,
      driftGuardCosine: parsed.ADD_CARDS_DRIFT_GUARD_COSINE,
      limitDefault: parsed.ADD_CARDS_LIMIT_DEFAULT,
      channelCap: parsed.ADD_CARDS_CHANNEL_CAP,
      subgoalCap: parsed.ADD_CARDS_SUBGOAL_CAP,
      tier1KnnLimit: parsed.ADD_CARDS_TIER1_KNN_LIMIT,
      semanticThreshold: parsed.ADD_CARDS_SEMANTIC_THRESHOLD,
      likedHistoryLimit: parsed.ADD_CARDS_LIKED_HISTORY_LIMIT,
      likedDecayHalfLifeDays: parsed.ADD_CARDS_LIKED_DECAY_HALF_LIFE_DAYS,
      surfaceBoost: parsed.ADD_CARDS_SURFACE_BOOST,
    };
  } catch {
    cached = FALLBACK_CONFIG;
  }
  return cached;
}

/** Reset cached config (test-only). */
export function resetAddCardsConfigCache(): void {
  cached = null;
}
