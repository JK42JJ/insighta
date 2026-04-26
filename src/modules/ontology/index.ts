export { OntologyManager, getOntologyManager } from './manager';
export type {
  OntologyNode,
  OntologyEdge,
  CreateNodeInput,
  UpdateNodeInput,
  CreateEdgeInput,
  ListNodesFilter,
} from './manager';
export { getNeighbors, getSubgraph } from './graph';
export type { NeighborResult, SubgraphResult } from './graph';
export { searchByVector, searchByText } from './search';
export type { VectorSearchResult, TextSearchResult } from './search';
export { generateEmbedding, embedNode, batchEmbedNodes } from './embedding';
export { enrichResourceNode, batchEnrichResources, enrichBySourceRef } from './enrichment';
export { buildContext, buildNodeContext } from './context-builder';
export type { ContextOptions, ContextResult } from './context-builder';
export { chat } from './chat';
export type { ChatRequest, ChatResponse, ChatSource } from './chat';
export { generateKnowledgeSummary } from './report';
export type { KnowledgeSummary } from './report';
export { routeRequest } from './router';
export type { RouteRequest, RouteResult, IntentType } from './router';
export { bridgeRichSummaryToKG } from './kg-bridge';
export type { KGBridgeResult } from './kg-bridge';
