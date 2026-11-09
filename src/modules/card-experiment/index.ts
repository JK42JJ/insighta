export * from './types';
export { capPerCellChannel, computeMargins, evaluateCandidate, sheetAssertions } from './gates';
export {
  buildRelevanceText,
  relevanceBestCells,
  relevanceScores,
  type RelevanceDeps,
} from './relevance';
export { buildFunnel, runCardExperiment, type RunDeps, type RunInput } from './run';
