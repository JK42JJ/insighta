/**
 * Context graph → search input (the existing KeywordBuilderInput shape + publishedAfter).
 * Deterministic: ties break on title then node id. AVOIDS are deliberately not used here.
 */

import { MS_PER_DAY } from '@/utils/time-constants';

import { USER_CONTEXT_CONFIG as C } from './config';
import { cmpStr, contextProps, outEdges } from './graph';
import type { ContextGraph, ContextNode, ContextRelation, SearchInput } from './types';

interface Ranked {
  node: ContextNode;
  weight: number;
}

/** Targets of `relation` out of the context, weight desc → title asc → id asc; weight > floor only. */
export function rankedTargets(
  graph: ContextGraph,
  relation: ContextRelation,
  type?: ContextNode['type']
): Ranked[] {
  const out: Ranked[] = [];
  for (const e of outEdges(graph, graph.contextId, relation)) {
    const node = graph.nodes.get(e.targetId);
    if (!node || (type !== undefined && node.type !== type)) continue;
    out.push({ node, weight: e.weight });
  }
  return out.sort(
    (a, b) =>
      b.weight - a.weight || cmpStr(a.node.title, b.node.title) || cmpStr(a.node.id, b.node.id)
  );
}

/** Branch order (all CONTAINS targets, including zero weight) — used for rank diffs. */
export function branchOrder(graph: ContextGraph): Ranked[] {
  return rankedTargets(graph, 'CONTAINS', 'mandala_sector');
}

export function buildSearchInput(graph: ContextGraph, now: Date = new Date()): SearchInput {
  const ctx = contextProps(graph);
  const subGoals = branchOrder(graph)
    .filter((r) => r.weight > C.WEIGHT_FLOOR)
    .slice(0, C.SEARCH_MAX_SUB_GOALS)
    .map((r) => r.node.title);
  const focusTags = rankedTargets(graph, 'WANTS', 'concept')
    .filter((r) => r.weight > C.WEIGHT_FLOOR)
    .slice(0, C.SEARCH_MAX_FOCUS_TAGS)
    .map((r) => r.node.title);
  const input: SearchInput = {
    centerGoal: ctx.goal_text,
    subGoals,
    focusTags,
    targetLevel: ctx.level,
    language: ctx.language,
  };
  if (ctx.recency_days > 0) {
    input.publishedAfter = new Date(now.getTime() - ctx.recency_days * MS_PER_DAY).toISOString();
  }
  return input;
}
