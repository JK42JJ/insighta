/**
 * Candidate scoring against a context graph (pure).
 *
 * excluded when: base filters fail | already judged (EXCLUDE_JUDGED_VERDICTS) |
 *                any AVOIDS on its concept / format / channel ≥ AVOID_EXCLUDE.
 * score = Σ WANTS(concept)·cover·CONCEPT_SCORE_WEIGHT − Σ AVOIDS(<threshold)·AVOID_PENALTY_WEIGHT
 *       + BRANCH_MATCH_WEIGHT·CONTAINS(branch) + level fit + FORMAT/CHANNEL_PREF_WEIGHT·WANTS.
 * reasons are short Korean facts for the ledger only.
 */

import { EXCLUDE_JUDGED_VERDICTS, USER_CONTEXT_CONFIG as C } from './config';
import { toDepthBucket } from './depth';
import {
  cmpStr,
  contextProps,
  edgeWeight,
  findBranch,
  findNodeByKey,
  judgedVideos,
  outEdges,
  roundWeight,
} from './graph';
import type {
  Candidate,
  CandidateScore,
  ContextGraph,
  ContextNode,
  DepthBucket,
  DepthPref,
  JudgmentVerdict,
} from './types';

const VERDICT_KO: Readonly<Record<JudgmentVerdict, string>> = Object.freeze({
  useful: '좋아',
  skip: '별로',
  pass: '넘김',
});

/** Two outcomes (like / dislike) each get PRIOR_SMOOTH pseudo-counts. */
const LEVEL_FIT_OUTCOMES = 2;

function f(n: number): string {
  return n.toFixed(C.REASON_DECIMALS);
}
function signed(n: number): string {
  return n >= 0 ? `+${f(n)}` : `−${f(-n)}`;
}

/** Beta-style level fit in [0, 1]; the declared level carries a prior. */
export function levelFit(depthPref: DepthPref, declared: DepthBucket, depth: DepthBucket): number {
  const counts = depthPref[depth];
  const prior = depth === declared ? C.PRIOR_AT_DECLARED_LEVEL : 0;
  const num = counts.likes + prior + C.PRIOR_SMOOTH;
  const den = counts.likes + counts.dislikes + prior + LEVEL_FIT_OUTCOMES * C.PRIOR_SMOOTH;
  return num / den;
}

/** LEVEL_FIT_WEIGHT × (fit − neutral); unknown depth → 0. */
export function levelFitTerm(
  depthPref: DepthPref,
  declared: DepthBucket,
  rawDepth: string | null | undefined
): number {
  const bucket = toDepthBucket(rawDepth);
  if (bucket === null) return 0;
  return C.LEVEL_FIT_WEIGHT * (levelFit(depthPref, declared, bucket) - C.LEVEL_FIT_NEUTRAL);
}

/** Explicit branch, else the sector whose RELEVANT_TO concepts overlap most (tie: weight, title, id). */
function resolveBranch(
  graph: ContextGraph,
  candidate: Candidate
): { node: ContextNode; inferred: boolean } | null {
  if (candidate.branch) {
    const node = findBranch(graph, candidate.branch);
    return node ? { node, inferred: false } : null;
  }
  const conceptIds = new Set<string>();
  for (const c of candidate.concepts) {
    const n = findNodeByKey(graph, 'concept', c.term);
    if (n) conceptIds.add(n.id);
  }
  if (conceptIds.size === 0) return null;
  let best: { node: ContextNode; overlap: number; weight: number } | null = null;
  for (const e of outEdges(graph, graph.contextId, 'CONTAINS')) {
    const sector = graph.nodes.get(e.targetId);
    if (!sector) continue;
    const overlap = outEdges(graph, sector.id, 'RELEVANT_TO').filter((r) =>
      conceptIds.has(r.targetId)
    ).length;
    if (overlap === 0) continue;
    const better =
      best === null ||
      overlap > best.overlap ||
      (overlap === best.overlap &&
        (e.weight > best.weight ||
          (e.weight === best.weight &&
            (cmpStr(sector.title, best.node.title) < 0 ||
              (sector.title === best.node.title && cmpStr(sector.id, best.node.id) < 0)))));
    if (better) best = { node: sector, overlap, weight: e.weight };
  }
  return best ? { node: best.node, inferred: true } : null;
}

export function scoreCandidate(graph: ContextGraph, candidate: Candidate): CandidateScore {
  const ctxId = graph.contextId;
  const excludedResult = (reason: string): CandidateScore => ({
    videoId: candidate.videoId,
    score: 0,
    excluded: true,
    reasons: [reason],
  });

  if (!candidate.passesBaseFilters) return excludedResult('기본 필터 미통과');

  const judged = judgedVideos(graph).get(candidate.videoId);
  if (judged && EXCLUDE_JUDGED_VERDICTS.includes(judged)) {
    return excludedResult(`이미 판정한 영상(${VERDICT_KO[judged]})`);
  }

  const reasons: string[] = [];
  let score = 0;

  // AVOIDS: exclusion first, then penalties below the threshold.
  const avoidTargets: Array<{ node: ContextNode; label: string }> = [];
  for (const c of candidate.concepts) {
    const n = findNodeByKey(graph, 'concept', c.term);
    if (n) avoidTargets.push({ node: n, label: '개념' });
  }
  const formatNode = candidate.format
    ? findNodeByKey(graph, 'format', candidate.format)
    : undefined;
  if (formatNode) avoidTargets.push({ node: formatNode, label: '형식' });
  const channelNode = candidate.channelId
    ? findNodeByKey(graph, 'channel', candidate.channelId)
    : undefined;
  if (channelNode) avoidTargets.push({ node: channelNode, label: '채널' });

  for (const t of avoidTargets) {
    const avoid = edgeWeight(graph, ctxId, 'AVOIDS', t.node.id);
    if (t.node.type === 'concept') {
      // Concepts are never excluded, only penalised (James 2026-11-12).
      if (avoid > 0) {
        const p = avoid * C.AVOID_CONCEPT_PENALTY;
        score -= p;
        reasons.push(`회피 ${t.label} '${t.node.title}' ${signed(-p)}`);
      }
      continue;
    }
    if (avoid >= C.AVOID_EXCLUDE) {
      return excludedResult(
        `회피 ${t.label} '${t.node.title}' ${f(avoid)} ≥ ${f(C.AVOID_EXCLUDE)}`
      );
    }
    if (avoid > 0) {
      const p = avoid * C.AVOID_PENALTY_WEIGHT;
      score -= p;
      reasons.push(`회피 ${t.label} '${t.node.title}' ${signed(-p)}`);
    }
  }

  // WANTS × COVERS
  for (const c of candidate.concepts) {
    const n = findNodeByKey(graph, 'concept', c.term);
    if (!n) continue;
    const want = edgeWeight(graph, ctxId, 'WANTS', n.id);
    if (want <= 0) continue;
    const term = want * c.weight * C.CONCEPT_SCORE_WEIGHT;
    score += term;
    reasons.push(`관심 개념 '${n.title}' ${f(want)}×${f(c.weight)} ${signed(term)}`);
  }

  // branch
  const branch = resolveBranch(graph, candidate);
  if (branch) {
    const w = edgeWeight(graph, ctxId, 'CONTAINS', branch.node.id);
    const term = w * C.BRANCH_MATCH_WEIGHT;
    if (term !== 0) {
      score += term;
      reasons.push(
        `${branch.inferred ? '추정 가지' : '가지'} '${branch.node.title}' ${signed(term)}`
      );
    }
  }

  // level fit
  const ctx = contextProps(graph);
  const bucket = toDepthBucket(candidate.depth);
  if (bucket !== null) {
    const fit = levelFit(ctx.depth_pref, ctx.level, bucket);
    const term = levelFitTerm(ctx.depth_pref, ctx.level, candidate.depth);
    if (term !== 0) {
      score += term;
      reasons.push(`난이도 ${bucket} 적합도 ${f(fit)} ${signed(term)}`);
    }
  }

  // format / channel preference
  if (formatNode) {
    const term = edgeWeight(graph, ctxId, 'WANTS', formatNode.id) * C.FORMAT_PREF_WEIGHT;
    if (term > 0) {
      score += term;
      reasons.push(`선호 형식 '${formatNode.title}' ${signed(term)}`);
    }
  }
  if (channelNode) {
    const term = edgeWeight(graph, ctxId, 'WANTS', channelNode.id) * C.CHANNEL_PREF_WEIGHT;
    if (term > 0) {
      score += term;
      reasons.push(`선호 채널 '${channelNode.title}' ${signed(term)}`);
    }
  }

  return { videoId: candidate.videoId, score: roundWeight(score), excluded: false, reasons };
}

/** Top n non-excluded candidates; score desc, then videoId asc. Duplicate videoIds keep the first. */
export function selectTop(
  graph: ContextGraph,
  candidates: readonly Candidate[],
  n: number
): CandidateScore[] {
  const seen = new Set<string>();
  const scored: CandidateScore[] = [];
  for (const c of candidates) {
    if (seen.has(c.videoId)) continue;
    seen.add(c.videoId);
    const s = scoreCandidate(graph, c);
    if (!s.excluded) scored.push(s);
  }
  scored.sort((a, b) => b.score - a.score || cmpStr(a.videoId, b.videoId));
  return scored.slice(0, Math.max(0, n));
}
