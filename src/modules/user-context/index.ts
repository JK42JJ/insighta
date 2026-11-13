/**
 * User context — per-user learning context stored in the ontology schema (nodes/edges).
 * Pure graph functions (search input, scoring, judgments, diff, snapshot) + a thin DB boundary.
 */

export { USER_CONTEXT_CONFIG, EXCLUDE_JUDGED_VERDICTS } from './config';
export * from './types';
export { DEPTH_BUCKETS, emptyDepthPref, toDeclaredLevel, toDepthBucket } from './depth';
export {
  UserContextError,
  addVideoToGraph,
  contextProps,
  createContextGraph,
  edgeKey,
  findNodeByKey,
  findVideoNode,
  judgedVideos,
  nodeIdFor,
  restoreGraph,
  snapshotGraph,
  type BranchInit,
  type CreateContextInput,
  type VideoInit,
} from './graph';
export { branchOrder, buildSearchInput } from './search';
export { levelFit, levelFitTerm, scoreCandidate, selectTop } from './score';
export { applyJudgments, diffGraphs } from './judgments';
export { WEIGHT_RULE, ratioWeight, recomputeWeights, tallyHistory } from './recompute';
export {
  changedElements,
  linkMandalaContext,
  persistGraph,
  readContext,
  type LinkMandalaInput,
  type PersistOptions,
  type PersistResult,
} from './store';
