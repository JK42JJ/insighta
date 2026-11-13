/**
 * Order-independent weights (James 2026-11-13): every WANTS / AVOIDS / CONTAINS weight out of the
 * context is derived from the judgment history as a whole, so the same judgments give the same
 * weights in any order. The history is the JUDGED edges: one per video (setEdge keys on the video),
 * so a video judged again counts once, with its latest verdict. depth_pref is recomputed from the
 * same edges. 넘김 is not counted.
 *
 * Formula (constants in USER_CONTEXT_CONFIG):
 *   concept WANTS = RATIO_SCALE · (L + RATIO_PRIOR_LIKES) / (L + S + RATIO_PRIOR_TOTAL)
 *                   L = Σ likes (a like watched ≥ WATCHED_RATIO_BONUS_MIN counts WATCHED_BONUS), S = skips;
 *                   no judgments → 1.0; never AVOIDS.
 *   format  WANTS = the same ratio; formats are never AVOIDS (selection score only).
 *   branch  CONTAINS = max(BRANCH_WEIGHT_FLOOR, base + LIKE_BRANCH_DELTA·likes − SKIP_BRANCH_DELTA·skips)
 *   channel WANTS = max(0, base + LIKE_FORMAT_CHANNEL_DELTA·likes − SKIP_FORMAT_CHANNEL_DELTA·skips)
 *   channel AVOIDS = AVOID_INITIAL_WEIGHT + AVOID_RAISE_DELTA·(skips − AVOID_MIN_SKIPS)
 *                   when skips ≥ AVOID_MIN_SKIPS and likes ≤ AVOID_MAX_LIKES (0); one like lifts it.
 * `base` (branches, channels) is the creation value, stored on the edge as base_weight.
 */
import { USER_CONTEXT_CONFIG as C } from './config';
import { emptyDepthPref } from './depth';
import {
  cloneGraph,
  depthPrefToJson,
  freeze,
  getEdge,
  judgedProps,
  outEdges,
  removeEdge,
  setEdge,
  videoProps,
  type MutableGraph,
} from './graph';
import type { ContextGraph, ContextNode, ContextRelation, DepthPref } from './types';

export const WEIGHT_RULE = 'ratio-v1';

interface Tally {
  likes: number;
  /** Likes with the watched-ratio bonus applied. */
  likeWeight: number;
  skips: number;
}

function emptyTally(): Tally {
  return { likes: 0, likeWeight: 0, skips: 0 };
}

function watchedMultiplier(watched: number | null, duration: number | null): number {
  if (typeof watched !== 'number' || duration === null || duration <= 0) return 1;
  return watched / duration >= C.WATCHED_RATIO_BONUS_MIN ? C.WATCHED_BONUS : 1;
}

/** 2·(L+1)/(L+S+2): 1.0 with no judgments, → 2 with only likes, → 0 with only skips. */
export function ratioWeight(likeWeight: number, skips: number): number {
  return (
    (C.RATIO_SCALE * (likeWeight + C.RATIO_PRIOR_LIKES)) /
    (likeWeight + skips + C.RATIO_PRIOR_TOTAL)
  );
}

/**
 * Creation value of a branch / channel edge: properties.base_weight when a recompute already
 * stored it, otherwise the seed value. Never the current edge weight: the incremental rules in
 * applyJudgments may already have changed that.
 */
function baseWeight(g: MutableGraph, relation: ContextRelation, target: ContextNode): number {
  const e = getEdge(g, g.contextId, relation, target.id);
  const stored = e?.properties['base_weight'];
  if (typeof stored === 'number') return stored;
  if (relation === 'CONTAINS') return C.DEFAULT_BRANCH_WEIGHT;
  if (
    relation === 'WANTS' &&
    target.type === 'channel' &&
    e &&
    e.properties['seed'] !== undefined
  ) {
    return C.RECOMPUTE_CHANNEL_SEED_BASE;
  }
  return 0;
}

/** Tallies per target node id (concepts, formats, channels) and per branch node id. */
export function tallyHistory(graph: ContextGraph): {
  targets: Map<string, Tally>;
  branches: Map<string, Tally>;
  depth: DepthPref;
} {
  const targets = new Map<string, Tally>();
  const branches = new Map<string, Tally>();
  const depth = emptyDepthPref();
  const bump = (
    m: Map<string, Tally>,
    id: string,
    verdict: 'useful' | 'skip',
    mult: number
  ): void => {
    const t = m.get(id) ?? emptyTally();
    if (verdict === 'useful') {
      t.likes += 1;
      t.likeWeight += mult;
    } else t.skips += 1;
    m.set(id, t);
  };
  for (const j of outEdges(graph, graph.contextId, 'JUDGED')) {
    const jp = judgedProps(j);
    if (!jp || (jp.verdict !== 'useful' && jp.verdict !== 'skip')) continue;
    const video = graph.nodes.get(j.targetId);
    if (!video) continue;
    const vp = videoProps(video);
    const mult = watchedMultiplier(jp.watched_seconds, vp.durationSeconds);
    for (const e of outEdges(graph, video.id, 'COVERS'))
      bump(targets, e.targetId, jp.verdict, mult);
    for (const e of outEdges(graph, video.id, 'TAGGED_WITH'))
      bump(targets, e.targetId, jp.verdict, mult);
    if (vp.branchId) bump(branches, vp.branchId, jp.verdict, mult);
    if (vp.depth) {
      if (jp.verdict === 'useful') depth[vp.depth].likes += 1;
      else depth[vp.depth].dislikes += 1;
    }
  }
  return { targets, branches, depth };
}

/** Rewrites the context's WANTS / AVOIDS / CONTAINS from the whole judgment history. Pure. */
export function recomputeWeights(graph: ContextGraph): ContextGraph {
  const g = cloneGraph(graph);
  const { targets, branches, depth } = tallyHistory(graph);
  const ctx = g.contextId;

  // Branches: every CONTAINS target, judged or not.
  for (const e of outEdges(g, ctx, 'CONTAINS')) {
    const node = g.nodes.get(e.targetId);
    if (!node) continue;
    const base = baseWeight(g, 'CONTAINS', node);
    const t = branches.get(node.id) ?? emptyTally();
    const w = Math.max(
      C.BRANCH_WEIGHT_FLOOR,
      base + C.LIKE_BRANCH_DELTA * t.likes - C.SKIP_BRANCH_DELTA * t.skips
    );
    setEdge(g, ctx, 'CONTAINS', node.id, w, { base_weight: base, likes: t.likes, skips: t.skips });
  }

  // Every concept / format / channel that has a WANTS or AVOIDS edge, or any judgment history.
  const ids = new Set<string>([...targets.keys()]);
  for (const rel of ['WANTS', 'AVOIDS'] as const)
    for (const e of outEdges(g, ctx, rel)) ids.add(e.targetId);
  for (const id of ids) {
    const node = g.nodes.get(id);
    if (!node || (node.type !== 'concept' && node.type !== 'format' && node.type !== 'channel'))
      continue;
    const t = targets.get(id) ?? emptyTally();
    const history = { likes: t.likes, like_weight: t.likeWeight, skips: t.skips };

    if (node.type === 'concept' || node.type === 'format') {
      setEdge(g, ctx, 'WANTS', id, ratioWeight(t.likeWeight, t.skips), history);
      removeEdge(g, ctx, 'AVOIDS', id); // concepts and formats are never avoided (James 2026-11-13)
      continue;
    }

    // channel
    const hadEdge = getEdge(g, ctx, 'WANTS', id) !== undefined;
    const avoided = t.skips >= C.AVOID_MIN_SKIPS && t.likes <= C.AVOID_MAX_LIKES;
    // A channel that was never wanted and has only a single skip gets no zero-weight edge.
    if (!hadEdge && t.likes === 0 && !avoided) continue;
    const base = baseWeight(g, 'WANTS', node);
    const w = Math.max(
      C.WEIGHT_FLOOR,
      base + C.LIKE_FORMAT_CHANNEL_DELTA * t.likes - C.SKIP_FORMAT_CHANNEL_DELTA * t.skips
    );
    setEdge(g, ctx, 'WANTS', id, w, { ...history, base_weight: base });
    if (avoided) {
      const avoid = C.AVOID_INITIAL_WEIGHT + C.AVOID_RAISE_DELTA * (t.skips - C.AVOID_MIN_SKIPS);
      setEdge(g, ctx, 'AVOIDS', id, avoid, history);
    } else {
      removeEdge(g, ctx, 'AVOIDS', id);
    }
  }
  const ctxNode = g.nodes.get(ctx);
  // depth counts are recomputed too, so a changed verdict replaces the old one instead of adding to it
  if (ctxNode)
    ctxNode.properties = {
      ...ctxNode.properties,
      weight_rule: WEIGHT_RULE,
      depth_pref: depthPrefToJson(depth),
    };
  return freeze(g);
}
