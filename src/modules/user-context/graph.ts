/**
 * Pure graph helpers: ids, lookups, builders, typed accessors, snapshot.
 * No DB access here — everything is unit-testable in memory.
 */

import { createHash } from 'node:crypto';

import { DEFAULT_TARGET_LEVEL } from '@/modules/mandala/target-level';
import type { TargetLevel } from '@/modules/mandala/target-level';

import {
  SNAPSHOT_SCHEMA,
  SNAPSHOT_SCHEMA_VERSION,
  USER_CONTEXT_CONFIG as C,
  USER_CONTEXT_SOURCE_TABLE,
} from './config';
import { emptyDepthPref, toDeclaredLevel, toDepthBucket, DEPTH_BUCKETS } from './depth';
import {
  JUDGMENT_VERDICTS,
  type ConceptWeight,
  type ContextEdge,
  type ContextGraph,
  type ContextNode,
  type ContextNodeType,
  type ContextRelation,
  type DepthPref,
  type GraphSnapshot,
  type JsonObject,
  type JsonValue,
  type JudgedProps,
  type JudgmentVerdict,
  type UserContextProps,
} from './types';

export class UserContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserContextError';
  }
}

// ---------------------------------------------------------------------------
// ids & keys
// ---------------------------------------------------------------------------

/** RFC 4122 name-based (v5 layout) uuid built from sha1 — same input, same id. */
const UUID_HEX_LENGTH = 32;
const UUID_GROUP_ENDS = [8, 12, 16, 20, UUID_HEX_LENGTH] as const;
const UUID_VERSION_INDEX = 12;
const UUID_VERSION_NIBBLE = '5';
const UUID_VARIANT_INDEX = 16;
const UUID_VARIANT_MASK = 0x3;
const UUID_VARIANT_BITS = 0x8;
const HEX_RADIX = 16;
const DECIMAL_BASE = 10;

function nameBasedUuid(name: string): string {
  const hex = createHash('sha1').update(name).digest('hex').slice(0, UUID_HEX_LENGTH);
  const chars = hex.split('');
  chars[UUID_VERSION_INDEX] = UUID_VERSION_NIBBLE;
  const variant =
    (parseInt(chars[UUID_VARIANT_INDEX] ?? '0', HEX_RADIX) & UUID_VARIANT_MASK) | UUID_VARIANT_BITS;
  chars[UUID_VARIANT_INDEX] = variant.toString(HEX_RADIX);
  const out = chars.join('');
  const groups: string[] = [];
  let start = 0;
  for (const end of UUID_GROUP_ENDS) {
    groups.push(out.slice(start, end));
    start = end;
  }
  return groups.join('-');
}

/** Lower-cased, whitespace-collapsed lookup key (concept terms, format codes). */
export function normalizeKey(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Lookup key per type: concept / format are case-insensitive; ids (video, channel, sector) are kept verbatim. */
export function keyFor(type: ContextNodeType, raw: string): string {
  return type === 'concept' || type === 'format' ? normalizeKey(raw) : raw.trim();
}

/** Deterministic, user-scoped node id: the same user + type + key always yields the same node. */
export function nodeIdFor(userId: string, type: ContextNodeType, key: string): string {
  return nameBasedUuid(`${USER_CONTEXT_SOURCE_TABLE}\u0000${userId}\u0000${type}\u0000${key}`);
}

/** source_ref for nodes created here; user-scoped so it never hits another user's / v2-bridge row. */
export function sourceRefFor(userId: string, type: ContextNodeType, key: string): JsonObject {
  return { table: USER_CONTEXT_SOURCE_TABLE, id: `${userId}:${type}:${key}` };
}

export function edgeKey(sourceId: string, relation: ContextRelation, targetId: string): string {
  return `${sourceId}|${relation}|${targetId}`;
}

export function roundWeight(w: number): number {
  const f = DECIMAL_BASE ** C.WEIGHT_DECIMALS;
  return Math.round(w * f) / f;
}

/** Deterministic string compare (no locale dependency). */
export function cmpStr(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// lookups
// ---------------------------------------------------------------------------

export function getNode(graph: ContextGraph, id: string): ContextNode | undefined {
  return graph.nodes.get(id);
}

export function getEdge(
  graph: ContextGraph,
  sourceId: string,
  relation: ContextRelation,
  targetId: string
): ContextEdge | undefined {
  return graph.edges.get(edgeKey(sourceId, relation, targetId));
}

export function outEdges(
  graph: ContextGraph,
  sourceId: string,
  relation?: ContextRelation
): ContextEdge[] {
  const out: ContextEdge[] = [];
  for (const e of graph.edges.values()) {
    if (e.sourceId === sourceId && (relation === undefined || e.relation === relation)) out.push(e);
  }
  return out;
}

export function edgeWeight(
  graph: ContextGraph,
  sourceId: string,
  relation: ContextRelation,
  targetId: string
): number {
  return getEdge(graph, sourceId, relation, targetId)?.weight ?? 0;
}

function propString(props: JsonObject, key: string): string | null {
  const v = props[key];
  return typeof v === 'string' ? v : null;
}
function propNumber(props: JsonObject, key: string): number | null {
  const v = props[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Node of the given type whose properties.key equals the normalized key. */
export function findNodeByKey(
  graph: ContextGraph,
  type: ContextNodeType,
  rawKey: string
): ContextNode | undefined {
  const key = keyFor(type, rawKey);
  const byId = graph.nodes.get(nodeIdFor(graph.userId, type, key));
  if (byId && byId.type === type) return byId;
  for (const n of graph.nodes.values()) {
    if (n.type === type && propString(n.properties, 'key') === key) return n;
  }
  return undefined;
}

export function findVideoNode(graph: ContextGraph, videoId: string): ContextNode | undefined {
  return findNodeByKey(graph, 'video_resource', videoId);
}

/** mandala_sector reached from the context via CONTAINS, matched by id or title. */
export function findBranch(graph: ContextGraph, idOrTitle: string): ContextNode | undefined {
  for (const e of outEdges(graph, graph.contextId, 'CONTAINS')) {
    const n = graph.nodes.get(e.targetId);
    if (n && (n.id === idOrTitle || n.title === idOrTitle)) return n;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// typed accessors
// ---------------------------------------------------------------------------

function readDepthPref(raw: JsonValue | undefined): DepthPref {
  const out = emptyDepthPref();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const b of DEPTH_BUCKETS) {
    const v = raw[b];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[b] = {
        likes: typeof v['likes'] === 'number' ? v['likes'] : 0,
        dislikes: typeof v['dislikes'] === 'number' ? v['dislikes'] : 0,
      };
    }
  }
  return out;
}

export function depthPrefToJson(p: DepthPref): JsonObject {
  const out: JsonObject = {};
  for (const b of DEPTH_BUCKETS) out[b] = { likes: p[b].likes, dislikes: p[b].dislikes };
  return out;
}

export function contextNode(graph: ContextGraph): ContextNode {
  const n = graph.nodes.get(graph.contextId);
  if (!n || n.type !== 'user_context') {
    throw new UserContextError(`context node ${graph.contextId} missing from graph`);
  }
  return n;
}

export function contextProps(graph: ContextGraph): UserContextProps {
  const p = contextNode(graph).properties;
  return {
    goal_text: propString(p, 'goal_text') ?? '',
    why: propString(p, 'why') ?? '',
    level: toDeclaredLevel(p['level']),
    language: propString(p, 'language') === 'en' ? 'en' : 'ko',
    recency_days: propNumber(p, 'recency_days') ?? C.DEFAULT_RECENCY_DAYS,
    version: propNumber(p, 'version') ?? C.INITIAL_VERSION,
    depth_pref: readDepthPref(p['depth_pref']),
  };
}

function isVerdict(v: unknown): v is JudgmentVerdict {
  return typeof v === 'string' && (JUDGMENT_VERDICTS as readonly string[]).includes(v);
}

export function judgedProps(edge: ContextEdge): JudgedProps | null {
  const p = edge.properties;
  const verdict = p['verdict'];
  if (!isVerdict(verdict)) return null;
  return {
    verdict,
    watched_seconds: propNumber(p, 'watched_seconds'),
    day: propString(p, 'day') ?? '',
    batch_id: propString(p, 'batch_id'),
    arm: propString(p, 'arm'),
  };
}

/** videoId → verdict for every JUDGED edge out of the context. */
export function judgedVideos(graph: ContextGraph): Map<string, JudgmentVerdict> {
  const out = new Map<string, JudgmentVerdict>();
  for (const e of outEdges(graph, graph.contextId, 'JUDGED')) {
    const node = graph.nodes.get(e.targetId);
    const jp = judgedProps(e);
    const vid = node ? propString(node.properties, 'video_id') : null;
    if (vid && jp) out.set(vid, jp.verdict);
  }
  return out;
}

export function videoProps(node: ContextNode): {
  videoId: string | null;
  depth: TargetLevel | null;
  durationSeconds: number | null;
  branchId: string | null;
} {
  const p = node.properties;
  return {
    videoId: propString(p, 'video_id'),
    depth: toDepthBucket(propString(p, 'depth')),
    durationSeconds: propNumber(p, 'duration_seconds'),
    branchId: propString(p, 'branch_id'),
  };
}

// ---------------------------------------------------------------------------
// mutable working copy (used by the pure builders; never leaks a shared Map)
// ---------------------------------------------------------------------------

export interface MutableGraph {
  userId: string;
  contextId: string;
  nodes: Map<string, ContextNode>;
  edges: Map<string, ContextEdge>;
}

export function cloneGraph(graph: ContextGraph): MutableGraph {
  const nodes = new Map<string, ContextNode>();
  for (const [k, n] of graph.nodes) nodes.set(k, { ...n, properties: { ...n.properties } });
  const edges = new Map<string, ContextEdge>();
  for (const [k, e] of graph.edges) edges.set(k, { ...e, properties: { ...e.properties } });
  return { userId: graph.userId, contextId: graph.contextId, nodes, edges };
}

export function ensureNode(
  g: MutableGraph,
  type: ContextNodeType,
  rawKey: string,
  title: string,
  properties: JsonObject = {}
): ContextNode {
  const key = keyFor(type, rawKey);
  const id = nodeIdFor(g.userId, type, key);
  const existing = g.nodes.get(id);
  if (existing) {
    existing.properties = { ...existing.properties, ...properties, key };
    return existing;
  }
  const node: ContextNode = {
    id,
    userId: g.userId,
    type,
    title,
    properties: { ...properties, key },
    sourceRef: sourceRefFor(g.userId, type, key),
  };
  g.nodes.set(id, node);
  return node;
}

export function setEdge(
  g: MutableGraph,
  sourceId: string,
  relation: ContextRelation,
  targetId: string,
  weight: number,
  properties?: JsonObject
): ContextEdge {
  if (sourceId === targetId) throw new UserContextError('self edge is not allowed');
  const k = edgeKey(sourceId, relation, targetId);
  const prev = g.edges.get(k);
  const edge: ContextEdge = {
    userId: g.userId,
    sourceId,
    targetId,
    relation,
    weight: roundWeight(weight),
    properties: { ...(prev?.properties ?? {}), ...(properties ?? {}) },
  };
  g.edges.set(k, edge);
  return edge;
}

/** Removes the edge if present; returns whether it existed. */
export function removeEdge(
  g: MutableGraph,
  sourceId: string,
  relation: ContextRelation,
  targetId: string
): boolean {
  return g.edges.delete(edgeKey(sourceId, relation, targetId));
}

export function freeze(g: MutableGraph): ContextGraph {
  return { userId: g.userId, contextId: g.contextId, nodes: g.nodes, edges: g.edges };
}

// ---------------------------------------------------------------------------
// builders
// ---------------------------------------------------------------------------

export interface BranchInit {
  title: string;
  weight?: number;
  /** Existing mandala_sector node id owned by the same user; omit to create one. */
  nodeId?: string;
  /** Concept terms → mandala_sector RELEVANT_TO concept. */
  concepts?: string[];
}

export interface CreateContextInput {
  userId: string;
  /** Stable key for this context (e.g. the mandala id). */
  contextKey: string;
  goalText: string;
  why?: string;
  level?: string;
  language?: 'ko' | 'en';
  recencyDays?: number;
  branches?: BranchInit[];
  /** Initial WANTS concepts. */
  wants?: ConceptWeight[];
}

export function createContextGraph(input: CreateContextInput): ContextGraph {
  const contextId = nodeIdFor(input.userId, 'user_context', input.contextKey);
  const g: MutableGraph = { userId: input.userId, contextId, nodes: new Map(), edges: new Map() };
  const props: UserContextProps = {
    goal_text: input.goalText,
    why: input.why ?? '',
    level: input.level === undefined ? DEFAULT_TARGET_LEVEL : toDeclaredLevel(input.level),
    language: input.language ?? 'ko',
    recency_days: input.recencyDays ?? C.DEFAULT_RECENCY_DAYS,
    version: C.INITIAL_VERSION,
    depth_pref: emptyDepthPref(),
  };
  g.nodes.set(contextId, {
    id: contextId,
    userId: input.userId,
    type: 'user_context',
    title: input.goalText,
    properties: { ...props, depth_pref: depthPrefToJson(props.depth_pref), key: input.contextKey },
    sourceRef: sourceRefFor(input.userId, 'user_context', input.contextKey),
  });
  for (const b of input.branches ?? []) {
    let sector: ContextNode;
    if (b.nodeId) {
      sector = {
        id: b.nodeId,
        userId: input.userId,
        type: 'mandala_sector',
        title: b.title,
        properties: {},
        sourceRef: null,
      };
      g.nodes.set(sector.id, sector);
    } else {
      sector = ensureNode(g, 'mandala_sector', `${input.contextKey}:${b.title}`, b.title);
    }
    setEdge(g, contextId, 'CONTAINS', sector.id, b.weight ?? C.DEFAULT_BRANCH_WEIGHT);
    for (const term of b.concepts ?? []) {
      const concept = ensureNode(g, 'concept', term, term.trim());
      setEdge(g, sector.id, 'RELEVANT_TO', concept.id, C.RELEVANT_TO_WEIGHT);
    }
  }
  for (const w of input.wants ?? []) {
    const concept = ensureNode(g, 'concept', w.term, w.term.trim());
    setEdge(g, contextId, 'WANTS', concept.id, Math.max(C.WEIGHT_FLOOR, w.weight));
  }
  return freeze(g);
}

export interface VideoInit {
  videoId: string;
  title: string;
  concepts: ConceptWeight[];
  format?: string;
  channelId?: string;
  channelTitle?: string;
  depth?: string | null;
  durationSeconds?: number | null;
  language?: string | null;
  publishedAt?: string | null;
  /** mandala_sector node id the video was offered under. */
  branchId?: string | null;
}

/** Adds (or refreshes) a user-owned video_resource node with its COVERS / TAGGED_WITH edges. */
export function addVideoToGraph(graph: ContextGraph, v: VideoInit): ContextGraph {
  const g = cloneGraph(graph);
  const video = ensureNode(g, 'video_resource', v.videoId, v.title, {
    video_id: v.videoId.trim(),
    depth: toDepthBucket(v.depth ?? null),
    duration_seconds: v.durationSeconds ?? null,
    language: v.language ?? null,
    published_at: v.publishedAt ?? null,
    branch_id: v.branchId ?? null,
  });
  for (const c of v.concepts) {
    const concept = ensureNode(g, 'concept', c.term, c.term.trim());
    setEdge(g, video.id, 'COVERS', concept.id, c.weight);
  }
  if (v.format) {
    const fmt = ensureNode(g, 'format', v.format, v.format.trim());
    setEdge(g, video.id, 'TAGGED_WITH', fmt.id, C.TAGGED_WITH_WEIGHT);
  }
  if (v.channelId) {
    const ch = ensureNode(g, 'channel', v.channelId, v.channelTitle ?? v.channelId.trim(), {
      channel_id: v.channelId.trim(),
    });
    setEdge(g, video.id, 'TAGGED_WITH', ch.id, C.TAGGED_WITH_WEIGHT);
  }
  return freeze(g);
}

// ---------------------------------------------------------------------------
// snapshot
// ---------------------------------------------------------------------------

export function snapshotGraph(graph: ContextGraph): GraphSnapshot {
  const nodes = [...graph.nodes.values()]
    .map((n) => ({ ...n, properties: { ...n.properties } }))
    .sort((a, b) => cmpStr(a.id, b.id));
  const edges = [...graph.edges.values()]
    .map((e) => ({ ...e, properties: { ...e.properties } }))
    .sort((a, b) =>
      cmpStr(
        edgeKey(a.sourceId, a.relation, a.targetId),
        edgeKey(b.sourceId, b.relation, b.targetId)
      )
    );
  return {
    schema: SNAPSHOT_SCHEMA,
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    user_id: graph.userId,
    context_id: graph.contextId,
    nodes,
    edges,
  };
}

export function restoreGraph(snapshot: GraphSnapshot): ContextGraph {
  if (snapshot.schema !== SNAPSHOT_SCHEMA || snapshot.schema_version !== SNAPSHOT_SCHEMA_VERSION) {
    throw new UserContextError(
      `unsupported snapshot ${snapshot.schema}@${snapshot.schema_version}`
    );
  }
  const nodes = new Map<string, ContextNode>();
  for (const n of snapshot.nodes) nodes.set(n.id, { ...n, properties: { ...n.properties } });
  const edges = new Map<string, ContextEdge>();
  for (const e of snapshot.edges) {
    edges.set(edgeKey(e.sourceId, e.relation, e.targetId), {
      ...e,
      properties: { ...e.properties },
    });
  }
  return { userId: snapshot.user_id, contextId: snapshot.context_id, nodes, edges };
}
