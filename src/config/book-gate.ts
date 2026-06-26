/**
 * Book-index selection gate (ARCHITECTURE-bookindex.md §1③ / §2 / §0.3 D3).
 *
 * fill-book sections a mandala's placed videos. This gate drops cards that do
 * NOT contribute to the book — scored-low (irrelevant) videos that would
 * otherwise be sectioned just because they have a v2 (defect 2: a rel=5 stock
 * video in an automation mandala). The gate filters the BOOK only; placement
 * (mandala data) is untouched.
 *
 * CP504 §0.3 D3 — two modes (BOOK_GATE_MODE):
 *   - 'absolute' (default, legacy): keep relevance >= minRelevance. Measured
 *     no-op (93% pass) because the absolute score clusters at ~71 fleet-wide.
 *   - 'relative': per-mandala median+ ∧ absolute floor. Validated (sim 1893
 *     cards / 70 mandalas): 60% pass, `>= median` tie-pass protects tight
 *     clusters (all-relevant mandalas keep ~all), floor drops the off-topic
 *     3.9%. Self-calibrating across mandalas whose mean ranges 60..84.
 *   Scoring is UNCHANGED — the relative gate consumes the same absolute scores.
 *
 * null relevance = the card was never scored (measured 2026-06-23: only ~21% of
 * placed cards carry relevance_pct). PASS_NULL=true (default) lets unevaluated
 * cards through so the gate does NOT over-exclude 79% of legitimate content; it
 * still removes the scored-low ones. The null-pass count is logged (not silent).
 * Flip PASS_NULL=false once relevance is backfilled (D4) to make the gate strict.
 *
 * All are tuning knobs (not secrets): code default + env override. unset = inert
 * (absolute legacy behavior).
 */

import { z } from 'zod';

export const BOOK_GATE_MODES = ['absolute', 'relative'] as const;
export type BookGateMode = (typeof BOOK_GATE_MODES)[number];

// 'false'/'0'/'no' → false, anything else truthy → true. (z.coerce.boolean
// treats the string 'false' as true, so parse explicitly.)
const boolFromEnv = z.preprocess((v) => {
  if (v == null) return true;
  const s = String(v).trim().toLowerCase();
  return !(s === 'false' || s === '0' || s === 'no' || s === '');
}, z.boolean());

export const bookGateEnvSchema = z.object({
  // A placed card needs relevance_pct >= this to be sectioned in ABSOLUTE mode
  // (also the relative-mode fallback for small/unscored mandalas). 0 disables.
  // Default 40: drops clearly-off-topic cards (rel=5 stock video, the defect-2
  // case) while keeping borderline-relevant ones — avoids over-exclusion.
  BOOK_GATE_MIN_RELEVANCE: z.coerce.number().min(0).max(100).default(40),
  // true ⇒ cards with null relevance_pct (unscored) pass; false ⇒ they are dropped.
  BOOK_GATE_PASS_NULL_RELEVANCE: boolFromEnv.default(true),
  // CP504 §0.3 D3 — gate mode. unset/'absolute' = inert legacy. 'relative' =
  // per-mandala median+ ∧ floor. Config-flip rollback = remove → 'absolute'.
  BOOK_GATE_MODE: z.enum(BOOK_GATE_MODES).default('absolute'),
  // Relative-mode absolute floor: a card below this is dropped even if it beats
  // the mandala median (blocks weak-mandala book pollution).
  BOOK_GATE_FLOOR_RELEVANCE: z.coerce.number().min(0).max(100).default(35),
  // Relative mode needs at least this many SCORED cards for a stable median;
  // below it the gate falls back to absolute (small-mandala guard).
  BOOK_GATE_MIN_SCORED_FOR_RELATIVE: z.coerce.number().int().min(1).default(5),
});

export interface BookGateConfig {
  mode: BookGateMode;
  minRelevance: number;
  floorRelevance: number;
  minScoredForRelative: number;
  passNull: boolean;
}

/** Per-mandala context for relative gating (computed once by the caller). */
export interface BookGateContext {
  /** Median relevance_pct over the mandala's SCORED placed cards; null if none. */
  median: number | null;
  /** Count of scored (non-null relevance) placed cards in the mandala. */
  scoredCount: number;
}

export function loadBookGateConfig(env: NodeJS.ProcessEnv = process.env): BookGateConfig {
  const parsed = bookGateEnvSchema.parse({
    BOOK_GATE_MIN_RELEVANCE: env['BOOK_GATE_MIN_RELEVANCE'],
    BOOK_GATE_PASS_NULL_RELEVANCE: env['BOOK_GATE_PASS_NULL_RELEVANCE'],
    BOOK_GATE_MODE: env['BOOK_GATE_MODE'],
    BOOK_GATE_FLOOR_RELEVANCE: env['BOOK_GATE_FLOOR_RELEVANCE'],
    BOOK_GATE_MIN_SCORED_FOR_RELATIVE: env['BOOK_GATE_MIN_SCORED_FOR_RELATIVE'],
  });
  return {
    mode: parsed.BOOK_GATE_MODE,
    minRelevance: parsed.BOOK_GATE_MIN_RELEVANCE,
    floorRelevance: parsed.BOOK_GATE_FLOOR_RELEVANCE,
    minScoredForRelative: parsed.BOOK_GATE_MIN_SCORED_FOR_RELATIVE,
    passNull: parsed.BOOK_GATE_PASS_NULL_RELEVANCE,
  };
}

/**
 * Compute the per-mandala median over SCORED relevance values (null-free).
 * Returns null when there are no scored cards. Tie-inclusive `>= median`
 * downstream is what protects tight clusters (all-relevant mandalas keep ~all).
 */
export function computeMandalaMedian(relevances: Array<number | null>): BookGateContext {
  const scored = relevances.filter((r): r is number => r != null).sort((a, b) => a - b);
  if (scored.length === 0) return { median: null, scoredCount: 0 };
  const mid = Math.floor(scored.length / 2);
  const median = scored.length % 2 === 1 ? scored[mid]! : (scored[mid - 1]! + scored[mid]!) / 2;
  return { median, scoredCount: scored.length };
}

/**
 * Gate decision for one placed card (pure). Returns true = keep in the book.
 *   - relevance == null            → passNull
 *   - relative mode (median present, enough sample):
 *       relevance >= floor ∧ relevance >= mandala median   (tie-pass)
 *   - absolute mode / fallback:    relevance >= minRelevance
 */
export function passesBookGate(
  relevance: number | null,
  ctx: BookGateContext,
  cfg: BookGateConfig
): boolean {
  if (relevance == null) return cfg.passNull;
  if (
    cfg.mode === 'relative' &&
    ctx.median != null &&
    ctx.scoredCount >= cfg.minScoredForRelative
  ) {
    return relevance >= cfg.floorRelevance && relevance >= ctx.median;
  }
  return relevance >= cfg.minRelevance;
}

/**
 * §1⑤ topic synthesis on/off. Default TRUE (verified §1⑤ Done — 942 clickbait 0,
 * drop 0, content-name topics). Every fill now synthesizes content topics (one
 * Haiku call per non-empty cell). Code-revert-free rollback = set
 * BOOK_TOPIC_SYNTHESIS_ENABLED=false (the only values that disable it).
 */
export function isBookTopicSynthesisEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env['BOOK_TOPIC_SYNTHESIS_ENABLED'] ?? '')
    .trim()
    .toLowerCase();
  return !(v === 'false' || v === '0' || v === 'no'); // unset ⇒ true (default on)
}
