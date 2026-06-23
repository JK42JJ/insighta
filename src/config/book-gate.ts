/**
 * Book-index selection gate (ARCHITECTURE-bookindex.md §1③ / §2).
 *
 * fill-book sections a mandala's placed videos. This gate drops cards that do
 * NOT contribute to the book — scored-low (irrelevant) videos that would
 * otherwise be sectioned just because they have a v2 (defect 2: a rel=5 stock
 * video in an automation mandala). The gate filters the BOOK only; placement
 * (mandala data) is untouched.
 *
 * null relevance = the card was never scored (measured 2026-06-23: only ~21% of
 * placed cards carry relevance_pct). PASS_NULL=true (default) lets unevaluated
 * cards through so the gate does NOT over-exclude 79% of legitimate content; it
 * still removes the scored-low ones. The null-pass count is logged (not silent).
 * Flip PASS_NULL=false once relevance is backfilled to make the gate strict.
 *
 * Both are tuning knobs (not secrets): code default + env override.
 */

import { z } from 'zod';

// 'false'/'0'/'no' → false, anything else truthy → true. (z.coerce.boolean
// treats the string 'false' as true, so parse explicitly.)
const boolFromEnv = z.preprocess((v) => {
  if (v == null) return true;
  const s = String(v).trim().toLowerCase();
  return !(s === 'false' || s === '0' || s === 'no' || s === '');
}, z.boolean());

export const bookGateEnvSchema = z.object({
  // A placed card needs relevance_pct >= this to be sectioned. 0 disables the
  // gate. Default 40: drops clearly-off-topic cards (rel=5 stock video, the
  // defect-2 case) while keeping borderline-relevant ones (e.g. rel=45 marketing
  // automation in an automation mandala) — avoids over-exclusion.
  BOOK_GATE_MIN_RELEVANCE: z.coerce.number().min(0).max(100).default(40),
  // true ⇒ cards with null relevance_pct (unscored) pass; false ⇒ they are dropped.
  BOOK_GATE_PASS_NULL_RELEVANCE: boolFromEnv.default(true),
});

export interface BookGateConfig {
  minRelevance: number;
  passNull: boolean;
}

export function loadBookGateConfig(env: NodeJS.ProcessEnv = process.env): BookGateConfig {
  const parsed = bookGateEnvSchema.parse({
    BOOK_GATE_MIN_RELEVANCE: env['BOOK_GATE_MIN_RELEVANCE'],
    BOOK_GATE_PASS_NULL_RELEVANCE: env['BOOK_GATE_PASS_NULL_RELEVANCE'],
  });
  return {
    minRelevance: parsed.BOOK_GATE_MIN_RELEVANCE,
    passNull: parsed.BOOK_GATE_PASS_NULL_RELEVANCE,
  };
}

/**
 * Gate decision for one placed card (pure). Returns true = keep in the book.
 *   - relevance >= minRelevance  → keep
 *   - relevance <  minRelevance  → drop (scored-low, the defect-2 case)
 *   - relevance == null          → passNull
 */
export function passesBookGate(relevance: number | null, cfg: BookGateConfig): boolean {
  if (relevance == null) return cfg.passNull;
  return relevance >= cfg.minRelevance;
}

/**
 * §1⑤ topic synthesis on/off. Default FALSE (unset = legacy one-section-per-video,
 * no LLM cost, byte-identical books) per the "new env default = prior behavior"
 * rule. Flip to 'true' to make fill-book synthesize content topics (adds one
 * Haiku call per non-empty cell). Code-revert-free rollback = flag off.
 */
export function isBookTopicSynthesisEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env['BOOK_TOPIC_SYNTHESIS_ENABLED'] ?? '')
    .trim()
    .toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}
