/**
 * Experiment 2026-11-13 selection (no DB, no network).
 * Context arm: score every candidate found by the context queries against context v1 and take the
 * top 5 per branch (one video per channel across the whole selection). Current arm: the app's order
 * (round-robin over its 5 queries by YouTube rank), one per channel, 20 videos.
 *
 * Usage: npx tsx scripts/ops/user-context-select.ts <candidates.json> <labels.json> <ctx_v1.json> <out.json>
 */
import * as fs from 'fs';

import {
  branchOrder,
  restoreGraph,
  scoreCandidate,
  type Candidate,
  type ContextGraph,
} from '@/modules/user-context';
import { outEdges } from '@/modules/user-context/graph';

interface Hit {
  arm: 'context' | 'current';
  branch: string | null;
  lang: string;
  query: string;
  rank: number;
  order?: string;
}
interface Cand {
  id: string;
  title: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  durationSec: number;
  lang: string;
  ageDays: number;
  passes: boolean;
  hits: Hit[];
  arms: string[];
}
interface Label {
  concepts: string[];
  format: string;
  depth: string;
}

const PER_BRANCH = 5;
const CURRENT_N = 20;
const CHANNEL_CAP = 1;

const [candPath, labelPath, ctxPath, outPath] = process.argv.slice(2);
const cands = (JSON.parse(fs.readFileSync(candPath, 'utf-8')) as Cand[]).filter((c) => c.passes);
const labels = JSON.parse(fs.readFileSync(labelPath, 'utf-8')) as Record<string, Label | null>;
const graph: ContextGraph = restoreGraph(JSON.parse(fs.readFileSync(ctxPath, 'utf-8')).snapshot);

/** branch title -> set of concept titles (RELEVANT_TO). */
const branchConcepts = new Map<string, Set<string>>();
for (const b of branchOrder(graph)) {
  const set = new Set<string>();
  for (const e of outEdges(graph, b.node.id, 'RELEVANT_TO')) {
    const t = graph.nodes.get(e.targetId);
    if (t) set.add(t.title);
  }
  branchConcepts.set(b.node.title, set);
}

function pickBranch(c: Cand, concepts: string[]): { branch: string; how: string } {
  let best: { branch: string; n: number } | null = null;
  for (const [branch, set] of branchConcepts) {
    const n = concepts.filter((x) => set.has(x)).length;
    if (n > 0 && (!best || n > best.n)) best = { branch, n };
  }
  if (best) return { branch: best.branch, how: `개념 ${best.n}개 일치` };
  const first = [...c.hits].filter((h) => h.arm === 'context').sort((a, b) => a.rank - b.rank)[0];
  return { branch: first?.branch ?? '만드는 법', how: '검색어의 갈래' };
}

// ---- context arm
const scored = cands
  .filter((c) => c.arms.includes('context'))
  .map((c) => {
    const l = labels[c.id];
    const concepts = l?.concepts ?? [];
    const { branch, how } = pickBranch(c, concepts);
    const cand: Candidate = {
      videoId: c.id,
      concepts: concepts.map((term) => ({ term, weight: 1 })),
      format: l?.format,
      channelId: c.channelId,
      depth: l?.depth ?? null,
      branch,
      passesBaseFilters: true,
    };
    const s = scoreCandidate(graph, cand);
    // Tie-break (2026-11-13, disclosed in the report): v1 weights are all 1.0, so many videos share the
    // top score; among equals, the best YouTube rank in the context queries comes first, then the id.
    const bestRank = Math.min(...c.hits.filter((h) => h.arm === 'context').map((h) => h.rank));
    return {
      c,
      branch,
      how,
      score: s.score,
      excluded: s.excluded,
      reasons: s.reasons,
      label: l,
      bestRank,
    };
  })
  .sort((a, b) => b.score - a.score || a.bestRank - b.bestRank || a.c.id.localeCompare(b.c.id));

const usedChannels = new Set<string>();
const perBranch = new Map<string, typeof scored>();
const ctxSelected: typeof scored = [];
for (const s of scored) {
  if (s.excluded) continue;
  const list = perBranch.get(s.branch) ?? [];
  if (list.length >= PER_BRANCH) continue;
  if (usedChannels.has(s.c.channelId)) continue;
  list.push(s);
  perBranch.set(s.branch, list);
  usedChannels.add(s.c.channelId);
  ctxSelected.push(s);
}

// ---- current arm: round-robin over the 5 queries by rank, one per channel
const curHits = cands
  .filter((c) => c.arms.includes('current'))
  .flatMap((c) => c.hits.filter((h) => h.arm === 'current').map((h) => ({ c, h })));
const queryOrder = [...new Set(curHits.map((x) => x.h.query))];
const byQuery = new Map<string, Array<{ c: Cand; h: Hit }>>();
for (const x of curHits) {
  const list = byQuery.get(x.h.query) ?? [];
  list.push(x);
  byQuery.set(x.h.query, list);
}
for (const list of byQuery.values()) list.sort((a, b) => a.h.rank - b.h.rank);
const curSelected: Array<{ c: Cand; h: Hit; position: number }> = [];
const curUsedChannels = new Set<string>();
const curSeen = new Set<string>();
let position = 0;
let progressed = true;
while (curSelected.length < CURRENT_N && progressed) {
  progressed = false;
  for (const q of queryOrder) {
    const list = byQuery.get(q) ?? [];
    while (list.length > 0) {
      const x = list.shift()!;
      progressed = true;
      if (curSeen.has(x.c.id)) continue;
      curSeen.add(x.c.id);
      if (curUsedChannels.has(x.c.channelId)) break;
      if (usedChannelsAcrossArms(x.c.channelId)) break;
      curUsedChannels.add(x.c.channelId);
      curSelected.push({ c: x.c, h: x.h, position: ++position });
      break;
    }
    if (curSelected.length >= CURRENT_N) break;
  }
}
function usedChannelsAcrossArms(channelId: string): boolean {
  return CHANNEL_CAP === 1 && usedChannels.has(channelId);
}

const out = {
  context: ctxSelected.map((s) => ({
    videoId: s.c.id,
    title: s.c.title,
    channel: s.c.channelTitle,
    channelId: s.c.channelId,
    lang: s.c.lang,
    publishedAt: s.c.publishedAt,
    ageDays: s.c.ageDays,
    durationSec: s.c.durationSec,
    branch: s.branch,
    branchHow: s.how,
    label: s.label,
    score: Number(s.score.toFixed(3)),
    bestRank: s.bestRank,
    reasons: s.reasons,
    queries: s.c.hits.filter((h) => h.arm === 'context').map((h) => `${h.query} (#${h.rank})`),
  })),
  contextShortfall: [...branchConcepts.keys()].map((b) => ({
    branch: b,
    selected: (perBranch.get(b) ?? []).length,
    candidatesScored: scored.filter((s) => s.branch === b).length,
    excluded: scored.filter((s) => s.branch === b && s.excluded).length,
  })),
  current: curSelected.map((x) => ({
    videoId: x.c.id,
    title: x.c.title,
    channel: x.c.channelTitle,
    channelId: x.c.channelId,
    lang: x.c.lang,
    publishedAt: x.c.publishedAt,
    ageDays: x.c.ageDays,
    durationSec: x.c.durationSec,
    label: labels[x.c.id] ?? null,
    basis: `지금 방식: 검색어 "${x.h.query}" ${x.h.order ?? 'relevance'} 순위 ${x.h.rank}, 질의 순환 ${x.position}번째`,
    queries: x.c.hits.filter((h) => h.arm === 'current').map((h) => `${h.query} (#${h.rank})`),
  })),
  overlap: ctxSelected.filter((s) => curSelected.some((x) => x.c.id === s.c.id)).map((s) => s.c.id),
  tieStats: {
    topScore: scored[0]?.score ?? null,
    atTopScore: scored.filter((s) => s.score === scored[0]?.score).length,
    // James 2026-11-13: how many selected videos were not tied — a selected video is "tied" when
    // another non-excluded candidate of the same branch has exactly the same score.
    selectedNotTied: ctxSelected.filter(
      (s) =>
        scored.filter((o) => !o.excluded && o.branch === s.branch && o.score === s.score).length ===
        1
    ).length,
    selectedTiedWithUnselected: ctxSelected.filter((s) =>
      scored.some(
        (o) =>
          !o.excluded && o.branch === s.branch && o.score === s.score && !ctxSelected.includes(o)
      )
    ).length,
    scoreHistogram: [
      ...scored.reduce(
        (m, s) => m.set(s.score, (m.get(s.score) ?? 0) + 1),
        new Map<number, number>()
      ),
    ]
      .sort((a, b) => b[0] - a[0])
      .slice(0, 6),
  },
  pools: {
    contextScored: scored.length,
    contextExcluded: scored.filter((s) => s.excluded).length,
    currentCandidates: new Set(curHits.map((x) => x.c.id)).size,
  },
};
fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
process.stdout.write(
  `context selected ${out.context.length} (${out.contextShortfall.map((b) => `${b.branch} ${b.selected}`).join(', ')}) | current ${out.current.length} | overlap ${out.overlap.length} | pools ${JSON.stringify(out.pools)}\n`
);
