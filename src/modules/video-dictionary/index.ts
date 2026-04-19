/**
 * video-dictionary — module barrel
 *
 * Consumer module for the external video-dictionary collector's
 * `video_chunk_embeddings` table (populated on mac mini via A1→A4 pipeline,
 * shipped as raw vectors only — no code dependency on that repo).
 *
 * Synthesis spec: /cursor/video-dictionary/docs/design/discovery-strategy.md
 */

export { getSemanticRank } from './semantic-rank';
export { applySemanticRerank } from './rerank';
export type { SemanticRankOptions, SemanticRankResult, RerankableSlot } from './types';
export type {
  ApplySemanticRerankOptions,
  SemanticRerankOutput,
  SemanticRerankTrace,
} from './rerank';
export {
  SEMANTIC_RERANK_TOP_N_PER_CELL,
  DEFAULT_SEMANTIC_ALPHA,
  DEFAULT_SEMANTIC_BETA,
} from './constants';
