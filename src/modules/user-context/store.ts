/**
 * DB boundary for the user context graph: read one context, write changed nodes/edges in one
 * transaction, and point user_mandalas.context at the context node.
 * Parameterised SQL only. Every row read or written is scoped to the context owner's user_id.
 */

import { USER_CONTEXT_DOMAIN } from './config';
import { UserContextError, cmpStr, contextProps, edgeKey } from './graph';
import {
  CONTEXT_NODE_TYPES,
  CONTEXT_RELATIONS,
  type ContextEdge,
  type ContextGraph,
  type ContextNode,
  type ContextNodeType,
  type ContextRelation,
  type JsonObject,
  type UserContextDb,
  type UserContextTx,
} from './types';

/** Relations read out of the context root. */
const ROOT_RELATIONS: readonly ContextRelation[] = ['CONTAINS', 'WANTS', 'AVOIDS', 'JUDGED'];
/** Relations read one hop further (sector → concept, video → concept / format / channel). */
const SECOND_HOP_RELATIONS: readonly ContextRelation[] = ['RELEVANT_TO', 'COVERS', 'TAGGED_WITH'];

export const SQL = Object.freeze({
  selectRoot: `SELECT id::text AS id, user_id::text AS user_id, type, title, properties, source_ref
  FROM ontology.nodes WHERE id = $1::uuid AND type = 'user_context'`,
  selectEdgesFrom: `SELECT user_id::text AS user_id, source_id::text AS source_id, target_id::text AS target_id,
  relation, weight, properties
  FROM ontology.edges
  WHERE source_id = ANY($1::text[]::uuid[]) AND user_id = $2::uuid AND relation = ANY($3::text[])`,
  selectNodes: `SELECT id::text AS id, user_id::text AS user_id, type, title, properties, source_ref
  FROM ontology.nodes WHERE id = ANY($1::text[]::uuid[]) AND user_id = $2::uuid`,
  selectForeignNodes: `SELECT id::text AS id FROM ontology.nodes
  WHERE id = ANY($1::text[]::uuid[]) AND user_id <> $2::uuid`,
  upsertNode: `INSERT INTO ontology.nodes (id, user_id, type, title, properties, source_ref, domain)
  VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb, $6::jsonb, $7)
  ON CONFLICT (id) DO UPDATE
    SET title = EXCLUDED.title,
        properties = ontology.nodes.properties || EXCLUDED.properties,
        updated_at = now()
    WHERE ontology.nodes.user_id = EXCLUDED.user_id`,
  upsertEdge: `INSERT INTO ontology.edges (user_id, source_id, target_id, relation, weight, properties, domain)
  VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::jsonb, $7)
  ON CONFLICT (source_id, target_id, relation) DO UPDATE
    SET weight = EXCLUDED.weight,
        properties = ontology.edges.properties || EXCLUDED.properties
    WHERE ontology.edges.user_id = EXCLUDED.user_id`,
  deleteEdge: `DELETE FROM ontology.edges
  WHERE user_id = $1::uuid AND source_id = $2::uuid AND target_id = $3::uuid AND relation = $4`,
  linkMandala: `UPDATE public.user_mandalas
  SET context = COALESCE(context, '{}'::jsonb) || jsonb_build_object('context_node_id', $1::text, 'version', $2::int)
  WHERE id = $3::uuid AND user_id = $4::uuid`,
});

interface NodeRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  properties: unknown;
  source_ref: unknown;
}
interface EdgeRow {
  user_id: string;
  source_id: string;
  target_id: string;
  relation: string;
  weight: number | string;
  properties: unknown;
}

function asJsonObject(v: unknown): JsonObject {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : {};
}
function isNodeType(t: string): t is ContextNodeType {
  return (CONTEXT_NODE_TYPES as readonly string[]).includes(t);
}
function isRelation(r: string): r is ContextRelation {
  return (CONTEXT_RELATIONS as readonly string[]).includes(r);
}
function toNode(r: NodeRow): ContextNode | null {
  if (!isNodeType(r.type)) return null;
  return {
    id: r.id,
    userId: r.user_id,
    type: r.type,
    title: r.title,
    properties: asJsonObject(r.properties),
    sourceRef:
      r.source_ref === null || r.source_ref === undefined ? null : asJsonObject(r.source_ref),
  };
}
function toEdge(r: EdgeRow): ContextEdge | null {
  if (!isRelation(r.relation)) return null;
  const weight = typeof r.weight === 'number' ? r.weight : Number(r.weight);
  return {
    userId: r.user_id,
    sourceId: r.source_id,
    targetId: r.target_id,
    relation: r.relation,
    weight: Number.isFinite(weight) ? weight : 0,
    properties: asJsonObject(r.properties),
  };
}

/** Loads the context root, its outgoing edges, and one further hop; all owned by the same user. */
export async function readContext(db: UserContextTx, contextId: string): Promise<ContextGraph> {
  const roots = await db.$queryRawUnsafe<NodeRow[]>(SQL.selectRoot, contextId);
  const first = roots[0];
  const root = first ? toNode(first) : null;
  if (!root) throw new UserContextError(`user_context ${contextId} not found`);
  const userId = root.userId;

  const rootEdges = (
    await db.$queryRawUnsafe<EdgeRow[]>(SQL.selectEdgesFrom, [contextId], userId, [
      ...ROOT_RELATIONS,
    ])
  )
    .map(toEdge)
    .filter((e): e is ContextEdge => e !== null);
  const hopSources = [...new Set(rootEdges.map((e) => e.targetId))];
  const hopEdges =
    hopSources.length === 0
      ? []
      : (
          await db.$queryRawUnsafe<EdgeRow[]>(SQL.selectEdgesFrom, hopSources, userId, [
            ...SECOND_HOP_RELATIONS,
          ])
        )
          .map(toEdge)
          .filter((e): e is ContextEdge => e !== null);

  const allEdges = [...rootEdges, ...hopEdges];
  const nodeIds = [...new Set(allEdges.flatMap((e) => [e.sourceId, e.targetId]))].filter(
    (id) => id !== contextId
  );
  const nodes = new Map<string, ContextNode>([[root.id, root]]);
  if (nodeIds.length > 0) {
    for (const r of await db.$queryRawUnsafe<NodeRow[]>(SQL.selectNodes, nodeIds, userId)) {
      const n = toNode(r);
      if (n) nodes.set(n.id, n);
    }
  }
  const edges = new Map<string, ContextEdge>();
  for (const e of allEdges) {
    // Drop edges whose endpoints were not loaded (other owner or unsupported type).
    if (nodes.has(e.sourceId) && nodes.has(e.targetId))
      edges.set(edgeKey(e.sourceId, e.relation, e.targetId), e);
  }
  return { userId, contextId, nodes, edges };
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort(cmpStr)
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(',')}}`;
}

/** Nodes/edges of `next` that are new or differ from `previous` (everything when previous is absent). */
export function changedElements(
  next: ContextGraph,
  previous?: ContextGraph
): { nodes: ContextNode[]; edges: ContextEdge[]; removedEdges: ContextEdge[] } {
  const nodes = [...next.nodes.values()].filter((n) => {
    const p = previous?.nodes.get(n.id);
    return (
      !p || p.title !== n.title || stableStringify(p.properties) !== stableStringify(n.properties)
    );
  });
  const edges = [...next.edges.entries()]
    .filter(([k, e]) => {
      const p = previous?.edges.get(k);
      return (
        !p ||
        p.weight !== e.weight ||
        stableStringify(p.properties) !== stableStringify(e.properties)
      );
    })
    .map(([, e]) => e);
  const removedEdges = previous
    ? [...previous.edges.entries()].filter(([k]) => !next.edges.has(k)).map(([, e]) => e)
    : [];
  const byKey = (a: ContextEdge, b: ContextEdge): number =>
    cmpStr(
      edgeKey(a.sourceId, a.relation, a.targetId),
      edgeKey(b.sourceId, b.relation, b.targetId)
    );
  nodes.sort((a, b) => cmpStr(a.id, b.id));
  edges.sort(byKey);
  removedEdges.sort(byKey);
  return { nodes, edges, removedEdges };
}

function assertOwnership(graph: ContextGraph): void {
  for (const n of graph.nodes.values()) {
    if (n.userId !== graph.userId)
      throw new UserContextError(`node ${n.id} belongs to another user`);
  }
  for (const e of graph.edges.values()) {
    if (e.userId !== graph.userId)
      throw new UserContextError(`edge ${e.sourceId}->${e.targetId} has another owner`);
    if (!graph.nodes.has(e.sourceId) || !graph.nodes.has(e.targetId)) {
      throw new UserContextError(`edge ${e.sourceId}->${e.targetId} points outside the graph`);
    }
  }
}

export interface LinkMandalaInput {
  mandalaId: string;
  userId: string;
  contextNodeId: string;
  version: number;
}

/** user_mandalas.context ← { context_node_id, version } (merged into any existing keys). */
export async function linkMandalaContext(
  db: UserContextTx,
  input: LinkMandalaInput
): Promise<number> {
  return db.$executeRawUnsafe(
    SQL.linkMandala,
    input.contextNodeId,
    input.version,
    input.mandalaId,
    input.userId
  );
}

export interface PersistOptions {
  /** Graph as last read/persisted; only differences are written. Omit to write everything. */
  previous?: ContextGraph;
  /** When given, user_mandalas.context is pointed at this context in the same transaction. */
  mandalaId?: string;
}

export interface PersistResult {
  nodesWritten: number;
  edgesWritten: number;
  /** Edges deleted because they are gone from the graph (an AVOIDS released). */
  edgesDeleted: number;
  mandalaLinked: boolean;
}

/** Writes changed nodes then edges (upsert, properties merge) in one transaction. */
export async function persistGraph(
  db: UserContextDb,
  graph: ContextGraph,
  opts: PersistOptions = {}
): Promise<PersistResult> {
  assertOwnership(graph);
  const { nodes, edges, removedEdges } = changedElements(graph, opts.previous);
  const touchedIds = [
    ...new Set([...nodes.map((n) => n.id), ...edges.flatMap((e) => [e.sourceId, e.targetId])]),
  ].sort(cmpStr);
  const version = contextProps(graph).version;

  return db.$transaction(async (tx) => {
    if (touchedIds.length > 0) {
      const foreign = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        SQL.selectForeignNodes,
        touchedIds,
        graph.userId
      );
      if (foreign.length > 0) {
        throw new UserContextError(
          `refusing to write: ${foreign.length} node(s) owned by another user`
        );
      }
    }
    for (const n of nodes) {
      await tx.$executeRawUnsafe(
        SQL.upsertNode,
        n.id,
        graph.userId,
        n.type,
        n.title,
        JSON.stringify(n.properties),
        n.sourceRef === null ? null : JSON.stringify(n.sourceRef),
        USER_CONTEXT_DOMAIN
      );
    }
    for (const e of edges) {
      await tx.$executeRawUnsafe(
        SQL.upsertEdge,
        graph.userId,
        e.sourceId,
        e.targetId,
        e.relation,
        e.weight,
        JSON.stringify(e.properties),
        USER_CONTEXT_DOMAIN
      );
    }
    for (const e of removedEdges) {
      await tx.$executeRawUnsafe(SQL.deleteEdge, graph.userId, e.sourceId, e.targetId, e.relation);
    }
    let mandalaLinked = false;
    if (opts.mandalaId) {
      const n = await linkMandalaContext(tx, {
        mandalaId: opts.mandalaId,
        userId: graph.userId,
        contextNodeId: graph.contextId,
        version,
      });
      mandalaLinked = n > 0;
    }
    return {
      nodesWritten: nodes.length,
      edgesWritten: edges.length,
      edgesDeleted: removedEdges.length,
      mandalaLinked,
    };
  });
}
