/**
 * video-dictionary — semantic rerank blend
 *
 * Applies α·rec_score + β·cosine to slots using a SemanticRankResult map.
 *
 * Contract (synthesis spec §4.2, §4.3):
 *   - When cosine is `null` (no embedding rows): pass through unchanged
 *   - When α=1, β=0: identity (emergency rollback path)
 *   - Scores stay clamped to [0, 1]
 *
 * Pure function: no I/O, no mutation of input array. Re-sorts descending.
 */

import type { RerankableSlot, SemanticRankResult } from './types';

export interface ApplySemanticRerankOptions {
  alpha: number;
  beta: number;
}

export interface SemanticRerankTrace {
  /** Input slot count. */
  candidatesIn: number;
  /** Slots that had a non-null cosine and were blended. */
  candidatesScored: number;
  /** Mean cosine of scored slots, or 0 if none. */
  avgCosine: number;
}

export interface SemanticRerankOutput<S extends RerankableSlot> {
  slots: S[];
  trace: SemanticRerankTrace;
}

/**
 * Blend linear pre-filter score with pgvector cosine.
 *   blended = α·score + β·cosine    (when cosine present)
 *   blended = score                  (when cosine null)
 *
 * Returns a new array sorted by blended score desc. Input not mutated.
 */
export function applySemanticRerank<S extends RerankableSlot>(
  slots: ReadonlyArray<S>,
  ranks: SemanticRankResult,
  opts: ApplySemanticRerankOptions
): SemanticRerankOutput<S> {
  const { alpha, beta } = opts;
  const out: S[] = [];
  let scored = 0;
  let cosineSum = 0;

  for (const slot of slots) {
    const cosine = ranks.get(slot.videoId);
    if (cosine == null) {
      out.push(slot);
      continue;
    }
    const blended = clampUnit(alpha * slot.score + beta * cosine);
    scored += 1;
    cosineSum += cosine;
    out.push({ ...slot, score: blended });
  }

  out.sort((a, b) => b.score - a.score);

  return {
    slots: out,
    trace: {
      candidatesIn: slots.length,
      candidatesScored: scored,
      avgCosine: scored > 0 ? cosineSum / scored : 0,
    },
  };
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
