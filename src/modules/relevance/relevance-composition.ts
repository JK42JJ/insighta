/**
 * Relevance composition — code-side synthesis of the 3-axis rubric + the
 * volatile-only recency bonus (CP499+ diagnosis A score pipeline).
 *
 * Why code composes (not the LLM): a single LLM-emitted composite collapses
 * into round-number modes (72/78/85/92 measured fleet-wide 2026-06-11) and
 * compresses on abstract goals (sd 6.8). Axis-wise scores have independent
 * modes, so a weighted code-side sum spreads — that spread is the mechanism
 * the gate validates (abstract-goal sd ≥ 12, concrete-goal Spearman ≥ 0.8).
 *
 * ⚠️ PROVISIONAL VALUES — gate-validation targets, NOT law. The weights
 * (0.4/0.4/0.2, 0.7/0.3) and recency table (+5 <6m, +2 6-12m) are starting
 * points; the multi-mandala gate (2-3 abstract + 2-3 concrete) re-tunes them
 * on miss. Keep them HERE (single home) so re-tuning is a 1-file change.
 *
 * Pure module — no config, no Prisma, no provider (config-free pure-helper
 * convention). Callers read flags and pass data in.
 */

import { MS_PER_MONTH_AVG } from '@/utils/time-constants';

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

/** Recency bonus table — applies ONLY to volatile-domain mandalas. */
export const RECENCY_FRESH_MONTHS = 6;
export const RECENCY_MID_MONTHS = 12;
export const RECENCY_FRESH_BONUS = 5;
export const RECENCY_MID_BONUS = 2;

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

/**
 * Recency bonus for a card. Non-zero ONLY when the mandala is volatile AND
 * published_at is known — evergreen, NULL volatility (pre-existing mandalas)
 * and NULL published_at (3.7% of placed cards) are all 0 = unchanged behavior.
 * Additive (never a penalty): a misclassified evergreen mandala can never be
 * demoted, only a fresh-volatile card rewarded (James decision 2026-06-11).
 */
export function recencyBonus(
  publishedAt: Date | null | undefined,
  volatility: string | null | undefined,
  now: Date = new Date()
): number {
  if (volatility !== 'volatile' || !publishedAt) return 0;
  const ageMs = now.getTime() - publishedAt.getTime();
  if (ageMs < 0) return RECENCY_FRESH_BONUS; // future-dated (premiere) = fresh
  const months = ageMs / MS_PER_MONTH_AVG;
  if (months < RECENCY_FRESH_MONTHS) return RECENCY_FRESH_BONUS;
  if (months < RECENCY_MID_MONTHS) return RECENCY_MID_BONUS;
  return 0;
}

/** Final score = base + bonus, capped at 100. */
export function applyRecency(basePct: number, bonus: number): number {
  return Math.min(100, basePct + bonus);
}
