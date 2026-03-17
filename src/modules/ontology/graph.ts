import { getPrismaClient } from '../database/client';

// ============================================================================
// Graph traversal using get_neighbors() SQL function
// ============================================================================

export interface NeighborResult {
  node_id: string;
  node_type: string;
  title: string;
  properties: Record<string, unknown>;
  relation: string;
  direction: string;
  depth: number;
}

export async function getNeighbors(
  nodeId: string,
  userId: string,
  relation?: string,
  depth: number = 1
): Promise<NeighborResult[]> {
  const prisma = getPrismaClient();
  const maxDepth = Math.min(depth, 5); // Cap at 5 to prevent excessive recursion

  return prisma.$queryRaw<NeighborResult[]>`
    SELECT node_id, node_type, title, properties, relation, direction, depth
    FROM ontology.get_neighbors(
      ${nodeId}::uuid,
      ${userId}::uuid,
      ${relation ?? null},
      ${maxDepth}
    )
  `;
}

export interface SubgraphResult {
  nodes: Array<{
    id: string;
    type: string;
    title: string;
    properties: Record<string, unknown>;
  }>;
  edges: Array<{
    id: string;
    source_id: string;
    target_id: string;
    relation: string;
    weight: number;
  }>;
}

export async function getSubgraph(
  nodeId: string,
  userId: string,
  depth: number = 2
): Promise<SubgraphResult> {
  const prisma = getPrismaClient();
  const maxDepth = Math.min(depth, 3);

  // Get all reachable node IDs via neighbors
  const neighbors = await getNeighbors(nodeId, userId, undefined, maxDepth);
  const nodeIds = [nodeId, ...neighbors.map(n => n.node_id)];

  if (nodeIds.length === 0) {
    return { nodes: [], edges: [] };
  }

  // Fetch full node data
  const nodes = await prisma.$queryRaw<SubgraphResult['nodes']>`
    SELECT id, type, title, properties
    FROM ontology.nodes
    WHERE id = ANY(${nodeIds}::uuid[]) AND user_id = ${userId}::uuid
  `;

  // Fetch edges between these nodes
  const edges = await prisma.$queryRaw<SubgraphResult['edges']>`
    SELECT id, source_id, target_id, relation, weight
    FROM ontology.edges
    WHERE user_id = ${userId}::uuid
      AND source_id = ANY(${nodeIds}::uuid[])
      AND target_id = ANY(${nodeIds}::uuid[])
  `;

  return { nodes, edges };
}
