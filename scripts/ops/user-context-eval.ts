/**
 * Offline evaluation of the context score against James's judgments (no DB, no network).
 *   - separation: AUC of score for 좋아(1) vs 별로(0) over the judged videos (넘김 excluded),
 *     overall and for the context arm only
 *   - ablation (James 2026-11-13 #2): the same with one score component removed
 *     (branch, concept, level, format, channel) and the top-20 overlap of the selection on each pool
 *   - recency (James 2026-11-13 #4): score + W·max(0, 1 − age/D) or W·0.5^(age/H) over a grid
 *
 * Usage: npx tsx scripts/ops/user-context-eval.ts <ctx.json> <out.json>
 *          --judged <batch.json>:<judgments.json> [--judged ...]
 *          --pool <candidates.json>:<labels.json> [--pool ...]
 */
import * as fs from 'fs';

import {
  branchOrder,
  restoreGraph,
  scoreCandidate,
  type Candidate,
  type ContextGraph,
} from '@/modules/user-context';
import { cloneGraph, freeze, outEdges, setEdge, removeEdge } from '@/modules/user-context/graph';

interface Label {
  concepts: string[];
  format: string;
  depth: string;
}
interface BatchRow {
  videoId: string;
  arm: 'context' | 'current' | 'both';
  branch?: string;
  channelId: string;
  ageDays: number;
  label: Label | null;
}
interface JudgmentRow {
  video_id: string;
  verdict: 'useful' | 'skip' | 'pass';
}
interface Hit {
  arm: 'context' | 'current';
  branch: string | null;
  rank: number;
}
interface Cand {
  id: string;
  channelId: string;
  ageDays: number;
  passes: boolean;
  hits: Hit[];
  arms: string[];
}

const PER_BRANCH = 5;
const TOP_N = 20;
const RECENCY_W = [0.5, 1, 2];
const LINEAR_D = [90, 180, 365];
const HALF_LIFE = [30, 90, 180];

type Variant = 'baseline' | 'no-branch' | 'no-concept' | 'no-level' | 'no-format' | 'no-channel';
const VARIANTS: Variant[] = [
  'baseline',
  'no-branch',
  'no-concept',
  'no-level',
  'no-format',
  'no-channel',
];

const args = process.argv.slice(2);
const [ctxPath, outPath] = args;
const judgedSpecs = args.flatMap((a, i) => (a === '--judged' ? [args[i + 1]!] : []));
const poolSpecs = args.flatMap((a, i) => (a === '--pool' ? [args[i + 1]!] : []));
const base: ContextGraph = restoreGraph(JSON.parse(fs.readFileSync(ctxPath, 'utf-8')).snapshot);

/** Graph with one component neutralised (weights set to 0 / AVOIDS removed). */
function variantGraph(v: Variant): ContextGraph {
  if (v === 'baseline' || v === 'no-level') return base;
  const g = cloneGraph(base);
  const ctx = g.contextId;
  if (v === 'no-branch')
    for (const e of outEdges(g, ctx, 'CONTAINS')) setEdge(g, ctx, 'CONTAINS', e.targetId, 0);
  const type = v === 'no-concept' ? 'concept' : v === 'no-format' ? 'format' : 'channel';
  if (v !== 'no-branch') {
    for (const e of outEdges(g, ctx, 'WANTS'))
      if (g.nodes.get(e.targetId)?.type === type) setEdge(g, ctx, 'WANTS', e.targetId, 0);
    for (const e of outEdges(g, ctx, 'AVOIDS'))
      if (g.nodes.get(e.targetId)?.type === type) removeEdge(g, ctx, 'AVOIDS', e.targetId);
  }
  return freeze(g);
}
function variantCandidate(v: Variant, c: Candidate): Candidate {
  if (v === 'no-level') return { ...c, depth: null };
  if (v === 'no-branch') return { ...c, branch: undefined, concepts: c.concepts }; // branch term 0 via weights; keep inference off
  return c;
}
const graphs = new Map<Variant, ContextGraph>(VARIANTS.map((v) => [v, variantGraph(v)]));

/** branch title -> concept titles (RELEVANT_TO), for pool selection. */
const branchConcepts = new Map<string, Set<string>>();
for (const b of branchOrder(base)) {
  const set = new Set<string>();
  for (const e of outEdges(base, b.node.id, 'RELEVANT_TO')) {
    const t = base.nodes.get(e.targetId);
    if (t) set.add(t.title);
  }
  branchConcepts.set(b.node.title, set);
}
function pickBranch(hits: Hit[], concepts: string[]): string {
  let best: { branch: string; n: number } | null = null;
  for (const [branch, set] of branchConcepts) {
    const n = concepts.filter((x) => set.has(x)).length;
    if (n > 0 && (!best || n > best.n)) best = { branch, n };
  }
  if (best) return best.branch;
  const first = [...hits].filter((h) => h.arm === 'context').sort((a, b) => a.rank - b.rank)[0];
  return first?.branch ?? '만드는 법';
}

function auc(pos: number[], neg: number[]): number | null {
  if (pos.length === 0 || neg.length === 0) return null;
  let s = 0;
  for (const p of pos) for (const n of neg) s += p > n ? 1 : p === n ? 0.5 : 0;
  return s / (pos.length * neg.length);
}
function recencyTerm(kind: 'linear' | 'half', w: number, k: number, age: number): number {
  return kind === 'linear' ? w * Math.max(0, 1 - age / k) : w * Math.pow(0.5, age / k);
}

// ---- judged videos
interface Judged {
  videoId: string;
  arm: string;
  y: 1 | 0;
  age: number;
  cand: Candidate;
}
const judged: Judged[] = [];
for (const spec of judgedSpecs) {
  const [bPath, jPath] = spec.split(':');
  const rows = (JSON.parse(fs.readFileSync(bPath!, 'utf-8')) as { rows: BatchRow[] }).rows;
  const verdicts = new Map(
    (JSON.parse(fs.readFileSync(jPath!, 'utf-8')) as JudgmentRow[]).map((j) => [
      j.video_id,
      j.verdict,
    ])
  );
  for (const r of rows) {
    const v = verdicts.get(r.videoId);
    if (v !== 'useful' && v !== 'skip') continue;
    const l = r.label;
    judged.push({
      videoId: r.videoId,
      arm: r.arm,
      y: v === 'useful' ? 1 : 0,
      age: r.ageDays,
      cand: {
        videoId: r.videoId,
        concepts: (l?.concepts ?? []).map((term) => ({ term, weight: 1 })),
        format: l?.format,
        channelId: r.channelId,
        depth: l?.depth ?? null,
        branch: r.branch,
        passesBaseFilters: true,
      },
    });
  }
}
function scoresFor(v: Variant, extra?: (age: number) => number): Map<string, number> {
  const g = graphs.get(v)!;
  const m = new Map<string, number>();
  for (const j of judged) {
    // excluded videos (already judged in the graph) must still get a score here: score the candidate
    // with a fresh id so the "already judged" rule does not fire
    const s = scoreCandidate(g, { ...variantCandidate(v, j.cand), videoId: j.videoId + '#eval' });
    m.set(j.videoId, (s.excluded ? 0 : s.score) + (extra ? extra(j.age) : 0));
  }
  return m;
}
function separation(scores: Map<string, number>): {
  all: number | null;
  context: number | null;
  n: number;
} {
  const pos = judged.filter((j) => j.y === 1).map((j) => scores.get(j.videoId)!);
  const neg = judged.filter((j) => j.y === 0).map((j) => scores.get(j.videoId)!);
  const cj = judged.filter((j) => j.arm !== 'current');
  const cpos = cj.filter((j) => j.y === 1).map((j) => scores.get(j.videoId)!);
  const cneg = cj.filter((j) => j.y === 0).map((j) => scores.get(j.videoId)!);
  return { all: auc(pos, neg), context: auc(cpos, cneg), n: judged.length };
}

// ---- pools: top-20 selection per variant
interface PoolCand {
  c: Cand;
  cand: Candidate;
  branch: string;
  bestRank: number;
}
const pools: PoolCand[][] = poolSpecs.map((spec) => {
  const [cPath, lPath] = spec.split(':');
  const cands = (JSON.parse(fs.readFileSync(cPath!, 'utf-8')) as Cand[]).filter(
    (c) => c.passes && c.arms.includes('context')
  );
  const labels = JSON.parse(fs.readFileSync(lPath!, 'utf-8')) as Record<string, Label | null>;
  return cands.map((c) => {
    const l = labels[c.id];
    const concepts = l?.concepts ?? [];
    const branch = pickBranch(c.hits, concepts);
    return {
      c,
      branch,
      bestRank: Math.min(...c.hits.filter((h) => h.arm === 'context').map((h) => h.rank)),
      cand: {
        videoId: c.id,
        concepts: concepts.map((term) => ({ term, weight: 1 })),
        format: l?.format,
        channelId: c.channelId,
        depth: l?.depth ?? null,
        branch,
        passesBaseFilters: true,
      } as Candidate,
    };
  });
});
function selectTop20(v: Variant, pool: PoolCand[], extra?: (age: number) => number): string[] {
  const g = graphs.get(v)!;
  const scored = pool
    .map((p) => {
      const s = scoreCandidate(g, variantCandidate(v, p.cand));
      return { p, score: s.excluded ? -Infinity : s.score + (extra ? extra(p.c.ageDays) : 0) };
    })
    .filter((x) => x.score !== -Infinity)
    .sort(
      (a, b) => b.score - a.score || a.p.bestRank - b.p.bestRank || a.p.c.id.localeCompare(b.p.c.id)
    );
  const used = new Set<string>();
  const perBranch = new Map<string, number>();
  const out: string[] = [];
  for (const x of scored) {
    if (out.length >= TOP_N) break;
    if ((perBranch.get(x.p.branch) ?? 0) >= PER_BRANCH || used.has(x.p.c.channelId)) continue;
    perBranch.set(x.p.branch, (perBranch.get(x.p.branch) ?? 0) + 1);
    used.add(x.p.c.channelId);
    out.push(x.p.c.id);
  }
  return out;
}
const baselineTops = pools.map((pool) => selectTop20('baseline', pool));
function overlaps(v: Variant, extra?: (age: number) => number): number[] {
  return pools.map((pool, i) => {
    const top = new Set(selectTop20(v, pool, extra));
    return baselineTops[i]!.filter((id) => top.has(id)).length;
  });
}

// ---- run
const result: Record<string, unknown> = {
  judged: {
    n: judged.length,
    useful: judged.filter((j) => j.y === 1).length,
    skip: judged.filter((j) => j.y === 0).length,
    contextArm: judged.filter((j) => j.arm !== 'current').length,
  },
  pools: pools.map((p) => p.length),
  ablation: {} as Record<string, unknown>,
  recency: [] as unknown[],
};
const lines: string[] = [];
for (const v of VARIANTS) {
  const sep = separation(scoresFor(v));
  const ov = overlaps(v);
  (result.ablation as Record<string, unknown>)[v] = { ...sep, top20Overlap: ov };
  lines.push(
    `${v.padEnd(11)} AUC all ${sep.all?.toFixed(3) ?? '-'} | context arm ${sep.context?.toFixed(3) ?? '-'} | top-20 overlap ${ov.map((o) => `${o}/${TOP_N}`).join(', ')}`
  );
}
for (const kind of ['linear', 'half'] as const) {
  for (const w of RECENCY_W) {
    for (const k of kind === 'linear' ? LINEAR_D : HALF_LIFE) {
      const extra = (age: number): number => recencyTerm(kind, w, k, age);
      const sep = separation(scoresFor('baseline', extra));
      const ov = overlaps('baseline', extra);
      (result.recency as unknown[]).push({ kind, w, k, ...sep, top20Overlap: ov });
      lines.push(
        `recency ${kind.padEnd(6)} W=${w} ${kind === 'linear' ? 'D' : 'H'}=${String(k).padStart(3)} | AUC all ${sep.all?.toFixed(3) ?? '-'} | context ${sep.context?.toFixed(3) ?? '-'} | overlap ${ov.map((o) => `${o}/${TOP_N}`).join(', ')}`
      );
    }
  }
}
fs.writeFileSync(outPath, JSON.stringify(result, null, 1));
process.stdout.write(
  `judged ${JSON.stringify(result.judged)} | pools ${JSON.stringify(result.pools)}\n${lines.join('\n')}\n`
);
