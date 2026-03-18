// ============================================================================
// Knowledge Graph View — Type Definitions
// Based on MA-2 spec (docs/ma2-knowledge-graph-spec.md)
// ============================================================================

export type OntologyNodeType =
  | 'mandala'
  | 'mandala_sector'
  | 'goal'
  | 'topic'
  | 'resource'
  | 'note'
  | 'source'
  | 'source_segment'
  | 'insight';

export type NodeCategory = 'structure' | 'content' | 'derived';

export interface OntologyNode {
  id: string;
  user_id: string;
  type: OntologyNodeType;
  title: string;
  properties: Record<string, unknown>;
  source_ref: { table: string; id: string } | null;
  created_at: string;
  updated_at: string;
}

export interface OntologyEdge {
  id: string;
  user_id: string;
  source_id: string;
  target_id: string;
  relation: string;
  weight: number;
  properties: Record<string, unknown>;
  created_at: string;
}

export interface OntologyStats {
  nodes_by_type: { type: string; count: number }[];
  edges_by_relation: { relation: string; count: number }[];
  total_nodes: number;
  total_edges: number;
}

// -- Graph library types (react-force-graph-2d) --

export interface GraphNode {
  id: string;
  label: string;
  type: OntologyNodeType;
  category: NodeCategory;
  val: number;
}

export interface GraphLink {
  source: string;
  target: string;
  relation: string;
  isStructural: boolean;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

// -- Category classification --

const STRUCTURE_TYPES: OntologyNodeType[] = ['mandala', 'mandala_sector', 'goal'];
const DERIVED_TYPES: OntologyNodeType[] = ['insight', 'topic'];

export function getNodeCategory(type: OntologyNodeType): NodeCategory {
  if (STRUCTURE_TYPES.includes(type)) return 'structure';
  if (DERIVED_TYPES.includes(type)) return 'derived';
  return 'content';
}

// Structural edge relations (rendered with higher opacity)
export const STRUCTURAL_RELATIONS = new Set(['CONTAINS', 'PLACED_IN']);
