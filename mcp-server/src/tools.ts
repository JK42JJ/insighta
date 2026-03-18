import { query } from './db.js';

// ============================================================================
// MCP Tool Handlers — Ontology Knowledge Graph Queries
// ============================================================================

const DEFAULT_USER_ID = '0192fedf-85f4-47ab-a652-7fdd116e2b39';

interface NodeRow {
  id: string;
  type: string;
  title: string;
  properties: Record<string, unknown>;
  source_ref: Record<string, string> | null;
  created_at: string;
  similarity?: number;
}

interface NeighborRow {
  node_id: string;
  node_type: string;
  title: string;
  properties: Record<string, unknown>;
  relation: string;
  direction: string;
  depth: number;
}

// ============================================================================
// Tool: context_for_task
// ============================================================================

export async function contextForTask(
  taskDescription: string,
  limit: number = 10,
  embedding?: number[]
): Promise<{ nodes: NodeRow[]; total_nodes: number; total_embeddings: number }> {
  let nodes: NodeRow[];

  if (embedding && embedding.length > 0) {
    const embStr = `[${embedding.join(',')}]`;
    nodes = await query<NodeRow>(
      `SELECT n.id, n.type, n.title, n.properties, n.source_ref, n.created_at,
              1 - (e.embedding <=> $1::vector) AS similarity
       FROM ontology.embeddings e
       JOIN ontology.nodes n ON n.id = e.node_id
       JOIN ontology.object_types ot ON n.type = ot.code
       WHERE n.user_id = $2::uuid
         AND ot.domain = 'system'
       ORDER BY e.embedding <=> $1::vector
       LIMIT $3`,
      [embStr, DEFAULT_USER_ID, limit]
    );
  } else {
    // Fallback: full-text search on title
    nodes = await query<NodeRow>(
      `SELECT n.id, n.type, n.title, n.properties, n.source_ref, n.created_at,
              ts_rank(to_tsvector('english', n.title), plainto_tsquery('english', $1)) AS similarity
       FROM ontology.nodes n
       JOIN ontology.object_types ot ON n.type = ot.code
       WHERE n.user_id = $2::uuid
         AND ot.domain = 'system'
         AND to_tsvector('english', n.title) @@ plainto_tsquery('english', $1)
       ORDER BY similarity DESC
       LIMIT $3`,
      [taskDescription, DEFAULT_USER_ID, limit]
    );
  }

  const [stats] = await query<{ total_nodes: string; total_embeddings: string }>(
    `SELECT
       (SELECT count(*) FROM ontology.nodes n JOIN ontology.object_types ot ON n.type = ot.code WHERE n.user_id = $1::uuid AND ot.domain = 'system') AS total_nodes,
       (SELECT count(*) FROM ontology.embeddings e JOIN ontology.nodes n ON n.id = e.node_id JOIN ontology.object_types ot ON n.type = ot.code WHERE n.user_id = $1::uuid AND ot.domain = 'system') AS total_embeddings`,
    [DEFAULT_USER_ID]
  );

  return {
    nodes,
    total_nodes: parseInt(stats?.total_nodes ?? '0'),
    total_embeddings: parseInt(stats?.total_embeddings ?? '0'),
  };
}

// ============================================================================
// Tool: similar_problems
// ============================================================================

export async function similarProblems(
  problemDescription: string,
  limit: number = 5,
  embedding?: number[]
): Promise<NodeRow[]> {
  if (embedding && embedding.length > 0) {
    const embStr = `[${embedding.join(',')}]`;
    return query<NodeRow>(
      `SELECT n.id, n.type, n.title, n.properties, n.source_ref, n.created_at,
              1 - (e.embedding <=> $1::vector) AS similarity
       FROM ontology.embeddings e
       JOIN ontology.nodes n ON n.id = e.node_id
       JOIN ontology.object_types ot ON n.type = ot.code
       WHERE n.user_id = $2::uuid AND n.type IN ('problem', 'pattern') AND ot.domain = 'system'
       ORDER BY e.embedding <=> $1::vector
       LIMIT $3`,
      [embStr, DEFAULT_USER_ID, limit]
    );
  }

  // Fallback: text search filtered to problem/pattern types
  return query<NodeRow>(
    `SELECT n.id, n.type, n.title, n.properties, n.source_ref, n.created_at,
            ts_rank(to_tsvector('english', n.title), plainto_tsquery('english', $1)) AS similarity
     FROM ontology.nodes n
     JOIN ontology.object_types ot ON n.type = ot.code
     WHERE n.user_id = $2::uuid
       AND n.type IN ('problem', 'pattern') AND ot.domain = 'system'
       AND to_tsvector('english', n.title) @@ plainto_tsquery('english', $1)
     ORDER BY similarity DESC
     LIMIT $3`,
    [problemDescription, DEFAULT_USER_ID, limit]
  );
}

// ============================================================================
// Tool: graph_neighbors
// ============================================================================

export async function graphNeighbors(
  nodeId: string,
  depth: number = 1,
  relation?: string
): Promise<NeighborRow[]> {
  return query<NeighborRow>(
    `SELECT node_id, node_type, title, properties, relation, direction, depth
     FROM ontology.get_neighbors($1::uuid, $2::uuid, $3, $4)`,
    [nodeId, DEFAULT_USER_ID, relation ?? null, Math.min(depth, 5)]
  );
}

// ============================================================================
// Tool: recent_nodes
// ============================================================================

export async function recentNodes(
  days: number = 7,
  type?: string,
  limit: number = 20
): Promise<NodeRow[]> {
  if (type) {
    return query<NodeRow>(
      `SELECT n.id, n.type, n.title, n.properties, n.source_ref, n.created_at
       FROM ontology.nodes n
       JOIN ontology.object_types ot ON n.type = ot.code
       WHERE n.user_id = $1::uuid
         AND n.type = $2
         AND ot.domain = 'system'
         AND n.created_at >= now() - ($3 || ' days')::interval
       ORDER BY n.created_at DESC
       LIMIT $4`,
      [DEFAULT_USER_ID, type, days.toString(), limit]
    );
  }

  return query<NodeRow>(
    `SELECT n.id, n.type, n.title, n.properties, n.source_ref, n.created_at
     FROM ontology.nodes n
     JOIN ontology.object_types ot ON n.type = ot.code
     WHERE n.user_id = $1::uuid
       AND ot.domain = 'system'
       AND n.created_at >= now() - ($2 || ' days')::interval
     ORDER BY n.created_at DESC
     LIMIT $3`,
    [DEFAULT_USER_ID, days.toString(), limit]
  );
}

// ============================================================================
// Tool: graph_stats
// ============================================================================

export async function graphStats(): Promise<{
  nodes_by_type: { type: string; count: number }[];
  edges_by_relation: { relation: string; count: number }[];
  total_nodes: number;
  total_edges: number;
  total_embeddings: number;
  embedding_coverage: string;
}> {
  const nodesByType = await query<{ type: string; count: string }>(
    `SELECT n.type, count(*)::text
     FROM ontology.nodes n
     JOIN ontology.object_types ot ON n.type = ot.code
     WHERE n.user_id = $1::uuid AND ot.domain = 'system'
     GROUP BY n.type ORDER BY count DESC`,
    [DEFAULT_USER_ID]
  );

  const edgesByRelation = await query<{ relation: string; count: string }>(
    `SELECT e.relation, count(*)::text
     FROM ontology.edges e
     JOIN ontology.nodes s ON e.source_id = s.id
     JOIN ontology.object_types ot ON s.type = ot.code
     WHERE e.user_id = $1::uuid AND ot.domain = 'system'
     GROUP BY e.relation ORDER BY count DESC`,
    [DEFAULT_USER_ID]
  );

  const [counts] = await query<{ total_nodes: string; total_edges: string; total_embeddings: string }>(
    `SELECT
       (SELECT count(*) FROM ontology.nodes n JOIN ontology.object_types ot ON n.type = ot.code WHERE n.user_id = $1::uuid AND ot.domain = 'system')::text AS total_nodes,
       (SELECT count(*) FROM ontology.edges e JOIN ontology.nodes s ON e.source_id = s.id JOIN ontology.object_types ot ON s.type = ot.code WHERE e.user_id = $1::uuid AND ot.domain = 'system')::text AS total_edges,
       (SELECT count(*) FROM ontology.embeddings em JOIN ontology.nodes n ON n.id = em.node_id JOIN ontology.object_types ot ON n.type = ot.code WHERE n.user_id = $1::uuid AND ot.domain = 'system')::text AS total_embeddings`,
    [DEFAULT_USER_ID]
  );

  const totalNodes = parseInt(counts?.total_nodes ?? '0');
  const totalEmbeddings = parseInt(counts?.total_embeddings ?? '0');

  return {
    nodes_by_type: nodesByType.map(r => ({ type: r.type, count: parseInt(r.count) })),
    edges_by_relation: edgesByRelation.map(r => ({ relation: r.relation, count: parseInt(r.count) })),
    total_nodes: totalNodes,
    total_edges: parseInt(counts?.total_edges ?? '0'),
    total_embeddings: totalEmbeddings,
    embedding_coverage: totalNodes > 0 ? `${(totalEmbeddings / totalNodes * 100).toFixed(1)}%` : '0%',
  };
}
