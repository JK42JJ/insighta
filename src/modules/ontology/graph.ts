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

  // Explicit casts are REQUIRED: with a null relation Prisma binds the
  // parameter as `unknown` (and the depth as bigint), and Postgres cannot
  // resolve get_neighbors(uuid, uuid, unknown, bigint) — error 42883.
  // Callers that always passed a relation string never hit this.
  return prisma.$queryRaw<NeighborResult[]>`
    SELECT node_id, node_type, title, properties, relation, direction, depth
    FROM ontology.get_neighbors(
      ${nodeId}::uuid,
      ${userId}::uuid,
      ${relation ?? null}::text,
      ${maxDepth}::int
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
  const nodeIds = [nodeId, ...neighbors.map((n) => n.node_id)];

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

// ============================================================================
// Mandala-scoped subgraph (MA-2 server scoping, 2026-07-27)
//
// The graph view previously fetched the user's first 1000 nodes flat — an
// arbitrary slice once a user's graph outgrows the cap (prod: 210k nodes /
// 16 users). This resolves the mandala's ontology root via source_ref
// ({table:'user_mandalas', id:<mandalaId>}, prod-verified) and expands with
// the existing ontology.get_neighbors() SQL function: depth 4 covers
// mandala → sector → goal/topic → video_resource → concept/atom/section.
// Closest-first cap keeps the payload bounded.
// ============================================================================

export interface MandalaSubgraphNode {
  id: string;
  user_id: string;
  type: string;
  title: string;
  properties: Record<string, unknown>;
  source_ref: { table: string; id: string } | null;
  created_at: Date;
  updated_at: Date;
}

export interface MandalaSubgraphEdge {
  id: string;
  user_id: string;
  source_id: string;
  target_id: string;
  relation: string;
  weight: number;
  properties: Record<string, unknown>;
  created_at: Date;
}

export interface MandalaSubgraphResult {
  nodes: MandalaSubgraphNode[];
  edges: MandalaSubgraphEdge[];
  /** True when the closest-first cap dropped nodes (FE shows a hint). */
  truncated: boolean;
}

const SUBGRAPH_NODE_CAP = 4000;

export async function getMandalaSubgraph(
  mandalaId: string,
  userId: string,
  depth: number = 4
): Promise<MandalaSubgraphResult> {
  const prisma = getPrismaClient();
  const maxDepth = Math.min(Math.max(depth, 1), 5);

  const roots = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM ontology.nodes
    WHERE user_id = ${userId}::uuid
      AND source_ref->>'table' = 'user_mandalas'
      AND source_ref->>'id' = ${mandalaId}
    LIMIT 1
  `;
  const root = roots[0];
  const rootId = root?.id ?? null;

  // The write pipeline has never linked mandala roots into the edge graph
  // (measured 2026-07-28: prod 210k-node graph has ZERO mandala→sector
  // CONTAINS rows; local likewise), so a root-only BFS returns one orphan
  // node. Sectors ARE in the graph (sector→topic/goal CONTAINS) and their
  // membership is guaranteed by public.user_mandala_levels.mandala_id — seed
  // the expansion from the sectors as well, and derive the mandala→sector
  // CONTAINS edges from that same table (projection of a public-schema fact,
  // not fabrication; real edges win once a backfill lands, see dedupe below).
  const sectorRows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT n.id FROM ontology.nodes n
    WHERE n.user_id = ${userId}::uuid
      AND n.type = 'mandala_sector'
      AND n.source_ref->>'table' = 'user_mandala_levels'
      AND n.source_ref->>'id' IN (
        SELECT l.id::text FROM user_mandala_levels l WHERE l.mandala_id = ${mandalaId}::uuid
      )
  `;
  const sectorIds = sectorRows.map((r) => r.id);

  const seedIds = [...(rootId ? [rootId] : []), ...sectorIds];
  if (seedIds.length === 0) return { nodes: [], edges: [], truncated: false };

  // Sector seeds sit one level below the root, so depth-1 keeps the reach
  // equivalent to the root-based depth.
  const seedResults = await Promise.all(
    seedIds.map((seed) =>
      getNeighbors(seed, userId, undefined, seed === rootId ? maxDepth : Math.max(1, maxDepth - 1))
    )
  );

  // Merge, keeping each node's SHALLOWEST depth (relative to any seed).
  const depthById = new Map<string, number>();
  for (const result of seedResults) {
    for (const n of result) {
      const previous = depthById.get(n.node_id);
      if (previous === undefined || n.depth < previous) depthById.set(n.node_id, n.depth);
    }
  }
  seedIds.forEach((seed) => depthById.delete(seed));

  // Closest-first cap keeps the structural core when a giant mandala
  // overflows the cap.
  const sorted = [...depthById.entries()].sort((a, b) => a[1] - b[1]);
  const truncated = seedIds.length + sorted.length > SUBGRAPH_NODE_CAP;
  const nodeIds = [
    ...seedIds,
    ...sorted.slice(0, Math.max(0, SUBGRAPH_NODE_CAP - seedIds.length)).map(([id]) => id),
  ];

  const nodes = await prisma.$queryRaw<MandalaSubgraphNode[]>`
    SELECT id, user_id, type, title, properties, source_ref, created_at, updated_at
    FROM ontology.nodes
    WHERE id = ANY(${nodeIds}::uuid[]) AND user_id = ${userId}::uuid
  `;

  const edges = await prisma.$queryRaw<MandalaSubgraphEdge[]>`
    SELECT id, user_id, source_id, target_id, relation, weight, properties, created_at
    FROM ontology.edges
    WHERE user_id = ${userId}::uuid
      AND source_id = ANY(${nodeIds}::uuid[])
      AND target_id = ANY(${nodeIds}::uuid[])
  `;

  // Derived mandala→sector CONTAINS (see the seeding comment above). Skipped
  // for any pair that already has a real stored edge, so a future backfill
  // supersedes these transparently.
  if (rootId) {
    const stored = new Set(edges.map((e) => `${e.source_id}→${e.target_id}:${e.relation}`));
    const now = new Date();
    for (const sectorId of sectorIds) {
      if (stored.has(`${rootId}→${sectorId}:CONTAINS`)) continue;
      edges.push({
        id: `derived-contains-${sectorId}`,
        user_id: userId,
        source_id: rootId,
        target_id: sectorId,
        relation: 'CONTAINS',
        weight: 1,
        properties: { derived: 'user_mandala_levels.mandala_id' },
        created_at: now,
      });
    }
  }

  return { nodes, edges, truncated };
}
