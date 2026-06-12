/**
 * Relevance composition — code-side synthesis of the PURE 3-axis rubric
 * (cell_fit / goal_contribution / actionability — CP499+ score pipeline,
 * CP500+ 축 분리).
 *
 * Why code composes (not the LLM): a single LLM-emitted composite collapses
 * into round-number modes (72/78/85/92 measured fleet-wide 2026-06-11) and
 * compresses on abstract goals (sd 6.8). Axis-wise scores have independent
 * modes, so a weighted code-side sum spreads — that spread is the mechanism
 * the gate validates (abstract-goal sd ≥ 12, concrete-goal Spearman ≥ 0.8).
 *
 * 축 분리 (James 2026-06-12): freshness is NOT a score axis — relevance ≠
 * recency, and a freshness term would contaminate the R1 gate measurement.
 * The earlier volatile-only recency BONUS was removed from this module.
 * RESERVED placement-layer follow-up (separate PR, score-independent): a
 * volatile-only 70/30 recency QUOTA at card placement — volatility 분기
 * (volatile만 적용, evergreen/미분류 NULL 무적용) reads
 * user_mandalas.volatility, which the merged-gen path keeps persisting for
 * exactly that consumer.
 *
 * ⚠️ PROVISIONAL VALUES — gate-validation targets, NOT law. The weights
 * (0.4/0.4/0.2, 0.7/0.3) are starting points; the multi-mandala gate
 * (2-3 abstract + 2-3 concrete) re-tunes them on miss. Keep them HERE
 * (single home) so re-tuning is a 1-file change.
 *
 * Pure module — no config, no Prisma, no provider (config-free pure-helper
 * convention). Callers read flags and pass data in.
 */

/** Rubric weights when a cell goal is present (cell-fit AND center contribution). */
export const RUBRIC_WEIGHTS = {
  cellFit: 0.4,
  goalContribution: 0.4,
  actionability: 0.2,
} as const;

/** Rubric weights without a cell goal (Heart path / scratchpad rows). */
export const RUBRIC_WEIGHTS_NO_CELL = {
  goalContribution: 0.7,
  actionability: 0.3,
} as const;

export interface RubricAxes {
  /** null ⇒ no cell goal was given (weights fall back to NO_CELL). */
  cellFitPct: number | null;
  goalContributionPct: number;
  actionabilityPct: number;
}

/** Weighted composite, rounded and clamped to [0, 100]. */
export function composeRubricScore(axes: RubricAxes): number {
  const raw =
    axes.cellFitPct === null
      ? RUBRIC_WEIGHTS_NO_CELL.goalContribution * axes.goalContributionPct +
        RUBRIC_WEIGHTS_NO_CELL.actionability * axes.actionabilityPct
      : RUBRIC_WEIGHTS.cellFit * axes.cellFitPct +
        RUBRIC_WEIGHTS.goalContribution * axes.goalContributionPct +
        RUBRIC_WEIGHTS.actionability * axes.actionabilityPct;
  return Math.min(100, Math.max(0, Math.round(raw)));
}
