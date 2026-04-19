/**
 * video-dictionary — types
 *
 * Public contracts for the semantic rerank consumer.
 * Source: synthesis spec §6.2.
 */

export interface SemanticRankOptions {
  mandalaId: string;
  videoIds: ReadonlyArray<string>;
  /**
   * Optional per-video cell assignment. When provided, cosine is computed
   * against the specified cell's embedding only (spec-accurate per §4.2).
   * When omitted, cosine is max-pooled across all 8 sub_goal cells.
   */
  cellAssignments?: ReadonlyMap<string, number>;
}

/**
 * Per-video rank result. `null` means "no embedding row for this video" —
 * caller should fall back to pre-filter `rec_score` with no penalty (§4.3).
 */
export type SemanticRankResult = Map<string, number | null>;

/** Minimal slot shape consumed by `applySemanticRerank`. */
export interface RerankableSlot {
  videoId: string;
  cellIndex: number;
  score: number;
}
