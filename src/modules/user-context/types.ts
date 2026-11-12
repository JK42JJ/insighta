/**
 * User context graph — in-memory shape of one user's context in the ontology schema.
 *
 *   user_context ─CONTAINS(w=branch pref)→ mandala_sector ─RELEVANT_TO→ concept
 *   user_context ─WANTS/AVOIDS(w≥0)→ concept | format | channel
 *   user_context ─JUDGED{verdict,watched_seconds,day,batch_id,arm}→ video_resource
 *   video_resource ─COVERS(w)→ concept
 *   video_resource ─TAGGED_WITH→ format | channel
 */

import type { TargetLevel } from '@/modules/mandala/target-level';
import type { KeywordBuilderInput } from '@/skills/plugins/video-discover/v2/keyword-builder';

export const CONTEXT_NODE_TYPES = [
  'user_context',
  'mandala_sector',
  'concept',
  'format',
  'channel',
  'video_resource',
] as const;
export type ContextNodeType = (typeof CONTEXT_NODE_TYPES)[number];

export const CONTEXT_RELATIONS = [
  'CONTAINS',
  'RELEVANT_TO',
  'WANTS',
  'AVOIDS',
  'JUDGED',
  'COVERS',
  'TAGGED_WITH',
] as const;
export type ContextRelation = (typeof CONTEXT_RELATIONS)[number];

export const JUDGMENT_VERDICTS = ['useful', 'skip', 'pass'] as const;
export type JudgmentVerdict = (typeof JUDGMENT_VERDICTS)[number];

/** Depth buckets = the mandala target levels. */
export type DepthBucket = TargetLevel;

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
export type JsonObject = { [k: string]: JsonValue };

export interface ContextNode {
  id: string;
  userId: string;
  type: ContextNodeType;
  title: string;
  properties: JsonObject;
  sourceRef: JsonObject | null;
}

export interface ContextEdge {
  userId: string;
  sourceId: string;
  targetId: string;
  relation: ContextRelation;
  weight: number;
  properties: JsonObject;
}

export interface ContextGraph {
  userId: string;
  contextId: string;
  nodes: ReadonlyMap<string, ContextNode>;
  /** Keyed by edgeKey(sourceId, relation, targetId) — mirrors UNIQUE(source_id, target_id, relation). */
  edges: ReadonlyMap<string, ContextEdge>;
}

export interface DepthCounts {
  likes: number;
  dislikes: number;
}
export type DepthPref = Record<DepthBucket, DepthCounts>;

/** Typed view of the user_context root node properties. */
export interface UserContextProps {
  goal_text: string;
  why: string;
  level: TargetLevel;
  language: 'ko' | 'en';
  recency_days: number;
  version: number;
  depth_pref: DepthPref;
}

/** Typed view of a JUDGED edge's properties. */
export interface JudgedProps {
  verdict: JudgmentVerdict;
  watched_seconds: number | null;
  day: string;
  batch_id: string | null;
  arm: string | null;
}

export interface ConceptWeight {
  term: string;
  weight: number;
}

export interface Candidate {
  videoId: string;
  concepts: ConceptWeight[];
  /** Format code (e.g. content_type 'lecture'). */
  format?: string;
  channelId?: string;
  /** Raw depth value (v2 core.depth_level / video_pool.depth_level / a target level). */
  depth?: string | null;
  /** mandala_sector node id or title. When absent, inferred from RELEVANT_TO overlap. */
  branch?: string;
  passesBaseFilters: boolean;
}

export interface CandidateScore {
  videoId: string;
  score: number;
  excluded: boolean;
  /** Short Korean facts for the experiment ledger (never shown on screen). */
  reasons: string[];
}

export interface Judgment {
  videoId: string;
  verdict: JudgmentVerdict;
  watchedSeconds?: number | null;
  /** YYYY-MM-DD */
  day: string;
  batchId?: string | null;
  arm?: string | null;
}

export interface EdgeRef {
  sourceId: string;
  targetId: string;
  relation: ContextRelation;
  targetType: ContextNodeType | null;
  targetTitle: string | null;
}

export interface EdgeWeightChange {
  edge: EdgeRef;
  /** null = the edge did not exist before. */
  before: number | null;
  after: number;
}

export interface BranchRankChange {
  sectorId: string;
  title: string;
  rankBefore: number;
  rankAfter: number;
  weightBefore: number;
  weightAfter: number;
}

/** Everything needed for a "v1↔v2 차이표". */
export interface GraphDiff {
  versionBefore: number;
  versionAfter: number;
  judged: Array<{ videoId: string; verdict: JudgmentVerdict }>;
  /** WANTS / AVOIDS / CONTAINS weight changes, sorted by relation then target title. */
  edges: EdgeWeightChange[];
  avoidsAdded: EdgeWeightChange[];
  avoidsRaised: EdgeWeightChange[];
  branchRanks: BranchRankChange[];
  depthPref: { before: DepthPref; after: DepthPref };
}

export interface GraphSnapshot {
  schema: string;
  schema_version: number;
  user_id: string;
  context_id: string;
  nodes: ContextNode[];
  edges: ContextEdge[];
}

export type SearchInput = KeywordBuilderInput & { publishedAfter?: string };

/** Minimal DB surface (Prisma client / transaction client both satisfy it). */
export interface UserContextTx {
  $queryRawUnsafe<T = unknown>(sql: string, ...params: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...params: unknown[]): Promise<number>;
}
export interface UserContextDb extends UserContextTx {
  $transaction<T>(fn: (tx: UserContextTx) => Promise<T>): Promise<T>;
}
