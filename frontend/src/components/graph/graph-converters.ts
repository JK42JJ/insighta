// ============================================================================
// Ontology → Graph Data Converters (L3)
// Transforms API response into react-force-graph-2d format.
// ============================================================================

import type {
  OntologyNode,
  OntologyEdge,
  GraphNode,
  GraphLink,
  GraphData,
} from './types';
import { getNodeCategory, STRUCTURAL_RELATIONS } from './types';

const MAX_LABEL_LENGTH = 30;

function truncateLabel(title: string): string {
  if (title.length <= MAX_LABEL_LENGTH) return title;
  return title.slice(0, MAX_LABEL_LENGTH - 1) + '…';
}

export function convertNode(
  node: OntologyNode,
  edgeCountMap: Map<string, number>
): GraphNode {
  const edgeCount = edgeCountMap.get(node.id) ?? 0;
  return {
    id: node.id,
    label: truncateLabel(node.title),
    fullTitle: node.title,
    type: node.type,
    category: getNodeCategory(node.type),
    val: Math.max(1, Math.min(edgeCount + 1, 10)),
    properties: node.properties,
  };
}

export function convertEdge(edge: OntologyEdge): GraphLink {
  return {
    source: edge.source_id,
    target: edge.target_id,
    relation: edge.relation,
    isStructural: STRUCTURAL_RELATIONS.has(edge.relation),
  };
}

export function buildGraphData(
  nodes: OntologyNode[],
  edges: OntologyEdge[]
): GraphData {
  // Build edge count map for node sizing
  const edgeCountMap = new Map<string, number>();
  for (const edge of edges) {
    edgeCountMap.set(edge.source_id, (edgeCountMap.get(edge.source_id) ?? 0) + 1);
    edgeCountMap.set(edge.target_id, (edgeCountMap.get(edge.target_id) ?? 0) + 1);
  }

  // Filter edges to only include those where both endpoints exist
  const nodeIdSet = new Set(nodes.map((n) => n.id));
  const validEdges = edges.filter(
    (e) => nodeIdSet.has(e.source_id) && nodeIdSet.has(e.target_id)
  );

  return {
    nodes: nodes.map((n) => convertNode(n, edgeCountMap)),
    links: validEdges.map(convertEdge),
  };
}
