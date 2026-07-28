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
const USER_EDGE_CAP = 8000;

/**
 * User-wide knowledge graph (beta-day scope decision 2026-07-28: the graph
 * screen shows the user's ENTIRE assigned knowledge — every mandala's
 * structure plus every placed card — not a single mandala).
 *
 * The ontology edge graph alone is too sparse for most accounts (measured on
 * prod: mandala roots are edge-orphans everywhere; for v1-era accounts the
 * card nodes are orphans too). So this projects the missing links from the
 * public schema — the product source of truth:
 *   - mandala → sector CONTAINS from user_mandala_levels.mandala_id
 *   - sector(cell) → card PLACED_IN from the cards' level_id/cell_index
 *     (same mapping contract as the card-count endpoint in
 *     src/api/routes/mandalas.ts; scratchpad and archived cards excluded)
 *   - cards match their ontology node via source_ref in BOTH shapes seen on
 *     prod (v1: resource/user_video_states, v2: video_resource/
 *     youtube_videos); cards with no node get a synthetic one.
 * Real stored rows always win over derived ones, so an edge backfill retires
 * these projections transparently.
 *
 * `mandalaId` no longer scopes the result (kept for API compatibility; the
 * FE highlights the active mandala client-side).
 */
export async function getMandalaSubgraph(
  _mandalaId: string | null,
  userId: string,
  _depth: number = 4
): Promise<MandalaSubgraphResult> {
  const prisma = getPrismaClient();

  const rootRows = await prisma.$queryRaw<Array<{ id: string; mandala_id: string }>>`
    SELECT id, source_ref->>'id' AS mandala_id FROM ontology.nodes
    WHERE user_id = ${userId}::uuid
      AND source_ref->>'table' = 'user_mandalas'
  `;
  const rootIdByMandala = new Map(rootRows.map((r) => [r.mandala_id, r.id]));

  const sectorRows = await prisma.$queryRaw<
    Array<{ id: string; mandala_id: string; position: number | null }>
  >`
    SELECT n.id, l.mandala_id::text AS mandala_id, l.position
    FROM ontology.nodes n
    JOIN user_mandala_levels l ON l.id::text = n.source_ref->>'id'
    WHERE n.user_id = ${userId}::uuid
      AND n.type = 'mandala_sector'
      AND n.source_ref->>'table' = 'user_mandala_levels'
  `;
  const sectorIdByCell = new Map<string, string>();
  for (const s of sectorRows) {
    if (s.position !== null) {
      const key = `${s.mandala_id}:${s.position}`;
      if (!sectorIdByCell.has(key)) sectorIdByCell.set(key, s.id);
    }
  }

  // Every placed card, across all mandalas. state_id joins the v1 node shape.
  const cardRows = await prisma.$queryRaw<
    Array<{
      ytid: string;
      state_id: string | null;
      title: string | null;
      mandala_id: string;
      cell_pos: number | null;
    }>
  >`
    SELECT DISTINCT ON (ytid, mandala_id) ytid, state_id, title, mandala_id, cell_pos FROM (
      SELECT yv.youtube_video_id AS ytid, s.id::text AS state_id, yv.title AS title,
        s.mandala_id::text AS mandala_id,
        CASE
          WHEN s.level_id = 'root' THEN s.cell_index
          ELSE (SELECT position FROM user_mandala_levels WHERE level_key = s.level_id AND mandala_id = s.mandala_id LIMIT 1)
        END AS cell_pos
      FROM user_video_states s
      JOIN youtube_videos yv ON yv.id = s.video_id
      WHERE s.user_id = ${userId}::uuid AND s.mandala_id IS NOT NULL
        AND s.level_id IS NOT NULL AND s.level_id != 'scratchpad' AND s.level_id != ''
        AND NOT EXISTS (
          SELECT 1 FROM card_interactions ci
          WHERE ci.user_id = ${userId}::uuid AND ci.signal = 'archive'
            AND ci.mandala_id = s.mandala_id AND ci.video_id = yv.youtube_video_id
        )
      UNION ALL
      SELECT c.video_id AS ytid, NULL AS state_id, c.title AS title,
        c.mandala_id::text AS mandala_id,
        CASE
          WHEN c.level_id = 'root' THEN c.cell_index
          ELSE (SELECT position FROM user_mandala_levels WHERE level_key = c.level_id AND mandala_id = c.mandala_id LIMIT 1)
        END AS cell_pos
      FROM user_local_cards c
      WHERE c.user_id = ${userId}::uuid AND c.mandala_id IS NOT NULL
        AND c.video_id IS NOT NULL
        AND c.level_id IS NOT NULL AND c.level_id != 'scratchpad' AND c.level_id != ''
        AND NOT EXISTS (
          SELECT 1 FROM card_interactions ci
          WHERE ci.user_id = ${userId}::uuid AND ci.signal = 'archive'
            AND ci.mandala_id = c.mandala_id AND ci.video_id = c.video_id
        )
    ) cards
    WHERE ytid IS NOT NULL
  `;

  // Match cards to ontology nodes — both prod shapes in one query.
  const ytids = [...new Set(cardRows.map((c) => c.ytid))];
  const stateIds = [...new Set(cardRows.map((c) => c.state_id).filter((v): v is string => !!v))];
  const matchRows =
    ytids.length > 0 || stateIds.length > 0
      ? await prisma.$queryRaw<Array<{ id: string; ref_table: string; ref_id: string }>>`
          SELECT id, source_ref->>'table' AS ref_table, source_ref->>'id' AS ref_id
          FROM ontology.nodes
          WHERE user_id = ${userId}::uuid
            AND (
              (type = 'video_resource' AND source_ref->>'table' = 'youtube_videos'
                AND source_ref->>'id' = ANY(${ytids}::text[]))
              OR
              (type = 'resource' AND source_ref->>'table' = 'user_video_states'
                AND source_ref->>'id' = ANY(${stateIds}::text[]))
            )
        `
      : [];
  const nodeIdByYtid = new Map<string, string>();
  const nodeIdByStateId = new Map<string, string>();
  for (const m of matchRows) {
    if (m.ref_table === 'youtube_videos') nodeIdByYtid.set(m.ref_id, m.id);
    else nodeIdByStateId.set(m.ref_id, m.id);
  }

  // The user's real ontology edges (capped) — connected nodes ride along.
  const edgeRows = await prisma.$queryRaw<MandalaSubgraphEdge[]>`
    SELECT id, user_id, source_id, target_id, relation, weight, properties, created_at
    FROM ontology.edges
    WHERE user_id = ${userId}::uuid
    LIMIT ${USER_EDGE_CAP}
  `;
  const edgeTruncated = edgeRows.length >= USER_EDGE_CAP;

  // Node set priority when the cap bites: structure → matched cards → the
  // rest of the edge-connected graph.
  const orderedIds: string[] = [];
  const seen = new Set<string>();
  const push = (id: string) => {
    if (!seen.has(id)) {
      seen.add(id);
      orderedIds.push(id);
    }
  };
  rootRows.forEach((r) => push(r.id));
  sectorRows.forEach((s) => push(s.id));
  matchRows.forEach((m) => push(m.id));
  edgeRows.forEach((e) => {
    push(e.source_id);
    push(e.target_id);
  });
  const truncated = orderedIds.length > SUBGRAPH_NODE_CAP || edgeTruncated;
  const nodeIds = orderedIds.slice(0, SUBGRAPH_NODE_CAP);
  const kept = new Set(nodeIds);

  const nodes =
    nodeIds.length > 0
      ? await prisma.$queryRaw<MandalaSubgraphNode[]>`
          SELECT id, user_id, type, title, properties, source_ref, created_at, updated_at
          FROM ontology.nodes
          WHERE id = ANY(${nodeIds}::uuid[]) AND user_id = ${userId}::uuid
        `
      : [];
  const edges = edgeRows.filter((e) => kept.has(e.source_id) && kept.has(e.target_id));

  // ---- Derived projections (real rows always win) ----
  const stored = new Set(edges.map((e) => `${e.source_id}→${e.target_id}:${e.relation}`));
  const now = new Date();

  // 1) mandala → sector CONTAINS
  for (const s of sectorRows) {
    const rootId = rootIdByMandala.get(s.mandala_id);
    if (!rootId || !kept.has(rootId) || !kept.has(s.id)) continue;
    if (stored.has(`${rootId}→${s.id}:CONTAINS`)) continue;
    stored.add(`${rootId}→${s.id}:CONTAINS`);
    edges.push({
      id: `derived-contains-${s.id}`,
      user_id: userId,
      source_id: rootId,
      target_id: s.id,
      relation: 'CONTAINS',
      weight: 1,
      properties: { derived: 'user_mandala_levels.mandala_id' },
      created_at: now,
    });
  }

  // 2) cards → synthetic nodes where needed + cell placement edges.
  // Synthetic nodes respect the SAME total node cap — without this, a
  // card-heavy account ballooned to ~9k nodes and froze the tab's layout
  // thread (prod-measured on beta day). Overflow flips `truncated`.
  const presentNodeIds = new Set(nodes.map((n) => n.id));
  let syntheticOverflow = false;
  for (const card of cardRows) {
    const matchedId =
      (card.state_id ? nodeIdByStateId.get(card.state_id) : undefined) ??
      nodeIdByYtid.get(card.ytid);
    let videoNodeId: string;
    if (matchedId && presentNodeIds.has(matchedId)) {
      videoNodeId = matchedId;
    } else if (matchedId) {
      continue; // matched but dropped by the cap — do not re-attach
    } else {
      videoNodeId = `derived-video-${card.ytid}`;
      if (!presentNodeIds.has(videoNodeId)) {
        if (presentNodeIds.size >= SUBGRAPH_NODE_CAP) {
          syntheticOverflow = true;
          continue;
        }
        presentNodeIds.add(videoNodeId);
        nodes.push({
          id: videoNodeId,
          user_id: userId,
          type: 'video_resource',
          title: card.title ?? card.ytid,
          properties: { derived: 'user_video_states/user_local_cards' },
          source_ref: { table: 'youtube_videos', id: card.ytid },
          created_at: now,
          updated_at: now,
        });
      }
    }

    const anchorId =
      (card.cell_pos !== null
        ? sectorIdByCell.get(`${card.mandala_id}:${card.cell_pos}`)
        : undefined) ?? rootIdByMandala.get(card.mandala_id);
    if (!anchorId || !kept.has(anchorId) || anchorId === videoNodeId) continue;
    if (
      stored.has(`${anchorId}→${videoNodeId}:PLACED_IN`) ||
      stored.has(`${videoNodeId}→${anchorId}:PLACED_IN`) ||
      stored.has(`${anchorId}→${videoNodeId}:CONTAINS`)
    ) {
      continue;
    }
    stored.add(`${anchorId}→${videoNodeId}:PLACED_IN`);
    edges.push({
      id: `derived-placed-${card.mandala_id}-${card.ytid}`,
      user_id: userId,
      source_id: anchorId,
      target_id: videoNodeId,
      relation: 'PLACED_IN',
      weight: 1,
      properties: { derived: 'card cell placement' },
      created_at: now,
    });
  }

  return { nodes, edges, truncated: truncated || syntheticOverflow };
}
