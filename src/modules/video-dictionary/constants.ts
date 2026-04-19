/**
 * video-dictionary — constants
 *
 * Named constants for semantic rerank. Source: synthesis spec §4.2
 * (/cursor/video-dictionary/docs/design/discovery-strategy.md).
 */

/** Per-cell cap for the pre-filter → rerank candidate set (§4.2). */
export const SEMANTIC_RERANK_TOP_N_PER_CELL = 50;

/** Blend weight on the linear pre-filter `rec_score` (§4.2 starting point). */
export const DEFAULT_SEMANTIC_ALPHA = 0.6;

/** Blend weight on the pgvector cosine term (§4.2 starting point). */
export const DEFAULT_SEMANTIC_BETA = 0.4;

/** Minimum cosine similarity admitted into the rerank (below = treat as null). */
export const SEMANTIC_COSINE_FLOOR = 0;

/** pgvector cosine distance operator → cosine similarity via `1 - dist`. */
export const COSINE_SIMILARITY_MAX = 1;
