/**
 * Judgments → new context graph + diff (pure). Rules: see config.ts header (James-approved).
 *
 * - Every judgment writes/overwrites the context ─JUDGED→ video edge.
 * - pass changes nothing else (no concept / format / channel / branch / depth_pref change).
 * - The AVOIDS rule reads the judgment history from the JUDGED edges of the resulting graph,
 *   so judgments are applied in array order.
 * - version += 1 once per call that carries ≥ 1 judgment.
 */

import { USER_CONTEXT_CONFIG as C } from './config';
import {
  UserContextError,
  cloneGraph,
  cmpStr,
  contextProps,
  depthPrefToJson,
  edgeKey,
  findVideoNode,
  freeze,
  getEdge,
  judgedProps,
  outEdges,
  setEdge,
  videoProps,
  type MutableGraph,
  removeEdge,
} from './graph';
import { branchOrder } from './search';
import type {
  BranchRankChange,
  ContextEdge,
  ContextGraph,
  ContextRelation,
  DepthPref,
  EdgeWeightChange,
  GraphDiff,
  Judgment,
  JudgmentVerdict,
} from './types';

const DIFF_RELATIONS: readonly ContextRelation[] = ['WANTS', 'AVOIDS', 'CONTAINS'];
const DIFF_RELATION_ORDER: Readonly<Record<string, number>> = Object.freeze({
  CONTAINS: 0,
  WANTS: 1,
  AVOIDS: 2,
});

function addWeight(
  g: MutableGraph,
  relation: ContextRelation,
  targetId: string,
  delta: number
): void {
  const prev = getEdge(g, g.contextId, relation, targetId);
  setEdge(
    g,
    g.contextId,
    relation,
    targetId,
    Math.max(C.WEIGHT_FLOOR, (prev?.weight ?? 0) + delta)
  );
}

/** Lowers an existing edge (floor WEIGHT_FLOOR); never creates one. */
function lowerWeight(
  g: MutableGraph,
  relation: ContextRelation,
  targetId: string,
  delta: number
): void {
  const prev = getEdge(g, g.contextId, relation, targetId);
  if (!prev) return;
  setEdge(g, g.contextId, relation, targetId, Math.max(C.WEIGHT_FLOOR, prev.weight - delta));
}

/** Verdict counts over judged videos that point at `targetId` via COVERS / TAGGED_WITH. */
function historyFor(g: MutableGraph, targetId: string): { likes: number; skips: number } {
  let likes = 0;
  let skips = 0;
  for (const j of outEdges(g, g.contextId, 'JUDGED')) {
    const verdict = judgedProps(j)?.verdict;
    if (verdict !== 'useful' && verdict !== 'skip') continue;
    const linked =
      getEdge(g, j.targetId, 'COVERS', targetId) !== undefined ||
      getEdge(g, j.targetId, 'TAGGED_WITH', targetId) !== undefined;
    if (!linked) continue;
    if (verdict === 'useful') likes++;
    else skips++;
  }
  return { likes, skips };
}

/**
 * AVOIDS for one target (concept, format or channel), from its judgment history:
 * created / raised after AVOID_MIN_SKIPS skips with at most AVOID_MAX_LIKES likes, and removed
 * once likes ≥ skips (James 2026-11-12). Passes never count.
 */
function updateAvoid(g: MutableGraph, targetId: string): void {
  const h = historyFor(g, targetId);
  const prev = getEdge(g, g.contextId, 'AVOIDS', targetId);
  if (prev && h.likes >= h.skips) {
    removeEdge(g, g.contextId, 'AVOIDS', targetId);
    return;
  }
  if (h.skips < C.AVOID_MIN_SKIPS || h.likes > C.AVOID_MAX_LIKES) return;
  setEdge(
    g,
    g.contextId,
    'AVOIDS',
    targetId,
    prev ? prev.weight + C.AVOID_RAISE_DELTA : C.AVOID_INITIAL_WEIGHT
  );
}

function watchedMultiplier(
  watchedSeconds: number | null | undefined,
  durationSeconds: number | null
): number {
  if (typeof watchedSeconds !== 'number' || durationSeconds === null || durationSeconds <= 0)
    return 1;
  return watchedSeconds / durationSeconds >= C.WATCHED_RATIO_BONUS_MIN ? C.WATCHED_BONUS : 1;
}

function applyOne(g: MutableGraph, j: Judgment, depthPref: DepthPref): void {
  const video = findVideoNode(g, j.videoId);
  if (!video) throw new UserContextError(`video ${j.videoId} is not in the context graph`);
  const vp = videoProps(video);

  setEdge(g, g.contextId, 'JUDGED', video.id, C.JUDGED_EDGE_WEIGHT, {
    verdict: j.verdict,
    watched_seconds: typeof j.watchedSeconds === 'number' ? j.watchedSeconds : null,
    day: j.day,
    batch_id: j.batchId ?? null,
    arm: j.arm ?? null,
  });
  if (j.verdict === 'pass') return;

  const conceptIds = outEdges(g, video.id, 'COVERS')
    .filter((e) => g.nodes.get(e.targetId)?.type === 'concept')
    .map((e) => e.targetId);
  const tagIds = outEdges(g, video.id, 'TAGGED_WITH')
    .filter((e) => {
      const t = g.nodes.get(e.targetId)?.type;
      return t === 'format' || t === 'channel';
    })
    .map((e) => e.targetId);
  const branchId =
    vp.branchId !== null && getEdge(g, g.contextId, 'CONTAINS', vp.branchId) !== undefined
      ? vp.branchId
      : null;

  if (j.verdict === 'useful') {
    const mult = watchedMultiplier(j.watchedSeconds, vp.durationSeconds);
    for (const id of conceptIds) {
      addWeight(g, 'WANTS', id, C.LIKE_CONCEPT_DELTA * mult);
      updateAvoid(g, id);
    }
    if (branchId) addWeight(g, 'CONTAINS', branchId, C.LIKE_BRANCH_DELTA);
    for (const id of tagIds) {
      addWeight(g, 'WANTS', id, C.LIKE_FORMAT_CHANNEL_DELTA);
      updateAvoid(g, id);
    }
    if (vp.depth) depthPref[vp.depth].likes += 1;
    return;
  }

  // skip
  for (const id of conceptIds) {
    lowerWeight(g, 'WANTS', id, C.SKIP_CONCEPT_DELTA);
    updateAvoid(g, id);
  }
  if (branchId) lowerWeight(g, 'CONTAINS', branchId, C.SKIP_BRANCH_DELTA);
  for (const id of tagIds) {
    lowerWeight(g, 'WANTS', id, C.SKIP_FORMAT_CHANNEL_DELTA);
    updateAvoid(g, id);
  }
  if (vp.depth) depthPref[vp.depth].dislikes += 1;
}

function contextEdgesByKey(graph: ContextGraph): Map<string, ContextEdge> {
  const out = new Map<string, ContextEdge>();
  for (const e of outEdges(graph, graph.contextId)) {
    if (DIFF_RELATIONS.includes(e.relation))
      out.set(edgeKey(e.sourceId, e.relation, e.targetId), e);
  }
  return out;
}

export function diffGraphs(
  before: ContextGraph,
  after: ContextGraph,
  judged: Array<{ videoId: string; verdict: JudgmentVerdict }> = []
): GraphDiff {
  const b = contextEdgesByKey(before);
  const a = contextEdgesByKey(after);
  const edges: EdgeWeightChange[] = [];
  for (const [k, e] of a) {
    const prev = b.get(k);
    if (prev && prev.weight === e.weight) continue;
    const target = after.nodes.get(e.targetId);
    edges.push({
      edge: {
        sourceId: e.sourceId,
        targetId: e.targetId,
        relation: e.relation,
        targetType: target?.type ?? null,
        targetTitle: target?.title ?? null,
      },
      before: prev ? prev.weight : null,
      after: e.weight,
    });
  }
  // Edges that existed before and are gone now (an AVOIDS released).
  for (const [k, e] of b) {
    if (a.has(k)) continue;
    const target = before.nodes.get(e.targetId);
    edges.push({
      edge: {
        sourceId: e.sourceId,
        targetId: e.targetId,
        relation: e.relation,
        targetType: target?.type ?? null,
        targetTitle: target?.title ?? null,
      },
      before: e.weight,
      after: null,
    });
  }
  edges.sort(
    (x, y) =>
      (DIFF_RELATION_ORDER[x.edge.relation] ?? 0) - (DIFF_RELATION_ORDER[y.edge.relation] ?? 0) ||
      cmpStr(x.edge.targetTitle ?? '', y.edge.targetTitle ?? '') ||
      cmpStr(x.edge.targetId, y.edge.targetId)
  );

  const rankOf = (g: ContextGraph): Map<string, { rank: number; weight: number }> => {
    const m = new Map<string, { rank: number; weight: number }>();
    branchOrder(g).forEach((r, i) => m.set(r.node.id, { rank: i + 1, weight: r.weight }));
    return m;
  };
  const rb = rankOf(before);
  const branchRanks: BranchRankChange[] = [];
  for (const [id, cur] of rankOf(after)) {
    const prev = rb.get(id);
    branchRanks.push({
      sectorId: id,
      title: after.nodes.get(id)?.title ?? '',
      rankBefore: prev?.rank ?? cur.rank,
      rankAfter: cur.rank,
      weightBefore: prev?.weight ?? cur.weight,
      weightAfter: cur.weight,
    });
  }
  branchRanks.sort((x, y) => x.rankAfter - y.rankAfter);

  const ctxBefore = contextProps(before);
  const ctxAfter = contextProps(after);
  return {
    versionBefore: ctxBefore.version,
    versionAfter: ctxAfter.version,
    judged,
    edges,
    avoidsAdded: edges.filter((c) => c.edge.relation === 'AVOIDS' && c.before === null),
    avoidsRaised: edges.filter(
      (c) =>
        c.edge.relation === 'AVOIDS' && c.before !== null && c.after !== null && c.after > c.before
    ),
    avoidsRemoved: edges.filter((c) => c.edge.relation === 'AVOIDS' && c.after === null),
    branchRanks,
    depthPref: { before: ctxBefore.depth_pref, after: ctxAfter.depth_pref },
  };
}

export function applyJudgments(
  graph: ContextGraph,
  judgments: readonly Judgment[]
): { graph: ContextGraph; diff: GraphDiff } {
  const g = cloneGraph(graph);
  const ctx = contextProps(g);
  const depthPref = ctx.depth_pref;
  for (const j of judgments) applyOne(g, j, depthPref);

  const ctxNode = g.nodes.get(g.contextId);
  if (!ctxNode) throw new UserContextError('context node missing');
  ctxNode.properties = {
    ...ctxNode.properties,
    depth_pref: depthPrefToJson(depthPref),
    version: judgments.length > 0 ? ctx.version + 1 : ctx.version,
  };

  const next = freeze(g);
  const judged = judgments.map((j) => ({ videoId: j.videoId, verdict: j.verdict }));
  return { graph: next, diff: diffGraphs(graph, next, judged) };
}

/**
 * Removes the JUDGED edge of each video whose verdict was canceled (no live verdict left), so a
 * following recomputeWeights no longer counts it. Pure; unknown ids are ignored.
 */
export function dropJudgments(graph: ContextGraph, videoIds: readonly string[]): ContextGraph {
  const g = cloneGraph(graph);
  for (const id of videoIds) {
    const video = findVideoNode(g, id);
    if (video) removeEdge(g, g.contextId, 'JUDGED', video.id);
  }
  return freeze(g);
}
