/**
 * Lexical qualifier-conflict deboost (R22-1 — search redesign).
 *
 * Pure string matching, zero LLM calls. Sits ON TOP of the frozen T3
 * domain-fit classifier (client.ts, untouched by this file) as a
 * post-processing SIGNAL: if the mandala goal and a candidate title both
 * name a value in the same qualifier category (language / cloud vendor /
 * instrument — see qualifier-vocab.ts) and those values DIFFER, apply a
 * deboost multiplier to the candidate's score. This is designed to catch the
 * "generic activity-noun with a dilutable domain qualifier" over-pass pattern
 * quantified in docs/qa/domain-fit-r20-polysemy-overpass-n-expansion.md
 * (회화 40%, 코드 25% LLM over-pass) and the R20-1 WRITE-edge cloud-vendor
 * collision (KT vs Oracle).
 *
 * Design invariants (do not weaken without a fresh measurement round):
 *   - CONFLICT only: goal and title both name a DIFFERENT value in the same
 *     category. Deboost.
 *   - ABSENCE never deboosts: if either side has no vocab hit in a category,
 *     that category is silently skipped — protects legit niche content that
 *     simply doesn't happen to restate the qualifier (see R22-2 legit
 *     false-deboost measurement, target 0).
 *   - Signal, not a hard cut: returns a multiplier (default
 *     DEFAULT_QUALIFIER_CONFLICT_MULTIPLIER), never a boolean pass/fail.
 *     Callers decide whether/how to apply it to a score.
 */

import { QUALIFIER_VOCAB_BY_CATEGORY, type QualifierCategory } from './qualifier-vocab';

/** Deboost multiplier applied when >=1 category conflicts. Named constant — no magic number at call sites. */
export const DEFAULT_QUALIFIER_CONFLICT_MULTIPLIER = 0.2;

export interface QualifierConflict {
  category: QualifierCategory;
  /** canonical values found in the goal text for this category (non-empty). */
  goalValues: string[];
  /** canonical values found in the title text for this category (non-empty, disjoint from goalValues). */
  titleValues: string[];
}

export interface QualifierConflictResult {
  /** true iff >=1 category has a goal/title value conflict. */
  hasConflict: boolean;
  conflicts: QualifierConflict[];
  /** DEFAULT_QUALIFIER_CONFLICT_MULTIPLIER when hasConflict, else 1 (no-op). */
  multiplier: number;
}

/**
 * Extract the set of canonical vocab values a text hits within one category.
 * Case-insensitive; matches on raw substring presence (vocab terms are short,
 * closed-list tokens — see qualifier-vocab.ts header for the word-boundary
 * caveat on `기타`).
 */
export function extractQualifierValues(text: string, category: QualifierCategory): Set<string> {
  const vocab = QUALIFIER_VOCAB_BY_CATEGORY[category];
  const haystack = text.toLowerCase();
  const found = new Set<string>();
  for (const [surface, canonical] of Object.entries(vocab)) {
    if (haystack.includes(surface.toLowerCase())) {
      found.add(canonical);
    }
  }
  return found;
}

/**
 * Detect qualifier conflicts between a goal and a candidate title across all
 * known categories. ABSENCE (either side has zero hits in a category) is
 * never a conflict — only genuine cross-value collisions count.
 */
export function detectQualifierConflicts(goal: string, title: string): QualifierConflictResult {
  const conflicts: QualifierConflict[] = [];

  for (const category of Object.keys(QUALIFIER_VOCAB_BY_CATEGORY) as QualifierCategory[]) {
    const goalValues = extractQualifierValues(goal, category);
    const titleValues = extractQualifierValues(title, category);
    if (goalValues.size === 0 || titleValues.size === 0) continue; // absence -> no-op

    const disjoint = [...goalValues].every((v) => !titleValues.has(v));
    if (disjoint) {
      conflicts.push({
        category,
        goalValues: [...goalValues],
        titleValues: [...titleValues],
      });
    }
  }

  return {
    hasConflict: conflicts.length > 0,
    conflicts,
    multiplier: conflicts.length > 0 ? DEFAULT_QUALIFIER_CONFLICT_MULTIPLIER : 1,
  };
}

/** Convenience: apply the lexical deboost multiplier to a base score. */
export function applyQualifierDeboost(baseScore: number, goal: string, title: string): number {
  const { multiplier } = detectQualifierConflicts(goal, title);
  return baseScore * multiplier;
}
