/**
 * Out-of-sample score dump for evaluation (no DB, no network): each judged batch is scored with the
 * context that existed BEFORE its judgments (day 1 with v1, day 2 with v2), for the full score and
 * with one component removed (branch, concept, level, format, channel). Separation and combinations
 * (subscribers, recency) are computed from this dump.
 *
 * Usage: npx tsx scripts/ops/user-context-score-dump.ts <out.json> <ctx.json>:<batch.json> [<ctx>:<batch> ...]
 */
import * as fs from 'fs';

import { restoreGraph, scoreCandidate, type Candidate, type ContextGraph } from '@/modules/user-context';
import { cloneGraph, freeze, outEdges, removeEdge, setEdge } from '@/modules/user-context/graph';

interface Label {
  concepts: string[];
  format: string;
  depth: string;
}
interface BatchRow {
  videoId: string;
  branch?: string;
  channelId: string;
  label: Label | null;
}
type Variant = 'full' | 'no-branch' | 'no-concept' | 'no-level' | 'no-format' | 'no-channel';
const VARIANTS: Variant[] = ['full', 'no-branch', 'no-concept', 'no-level', 'no-format', 'no-channel'];

function variantGraph(base: ContextGraph, v: Variant): ContextGraph {
  if (v === 'full' || v === 'no-level') return base;
  const g = cloneGraph(base);
  const ctx = g.contextId;
  if (v === 'no-branch') {
    for (const e of outEdges(g, ctx, 'CONTAINS')) setEdge(g, ctx, 'CONTAINS', e.targetId, 0);
    return freeze(g);
  }
  const type = v === 'no-concept' ? 'concept' : v === 'no-format' ? 'format' : 'channel';
  for (const e of outEdges(g, ctx, 'WANTS'))
    if (g.nodes.get(e.targetId)?.type === type) setEdge(g, ctx, 'WANTS', e.targetId, 0);
  for (const e of outEdges(g, ctx, 'AVOIDS'))
    if (g.nodes.get(e.targetId)?.type === type) removeEdge(g, ctx, 'AVOIDS', e.targetId);
  return freeze(g);
}

const [outPath, ...specs] = process.argv.slice(2);
const out: Record<string, Record<Variant, number | null>> = {};
for (const spec of specs) {
  const [ctxPath, batchPath] = spec.split(':');
  const base = restoreGraph(JSON.parse(fs.readFileSync(ctxPath!, 'utf-8')).snapshot);
  const rows = (JSON.parse(fs.readFileSync(batchPath!, 'utf-8')) as { rows: BatchRow[] }).rows;
  const graphs = new Map(VARIANTS.map((v) => [v, variantGraph(base, v)]));
  for (const r of rows) {
    const l = r.label;
    const cand: Candidate = {
      // a fresh id so the "already judged" rule never fires on the scored context
      videoId: `${r.videoId}#eval`,
      concepts: (l?.concepts ?? []).map((term) => ({ term, weight: 1 })),
      format: l?.format,
      channelId: r.channelId,
      depth: l?.depth ?? null,
      branch: r.branch,
      passesBaseFilters: true,
    };
    const scores = {} as Record<Variant, number | null>;
    for (const v of VARIANTS) {
      const c = v === 'no-level' ? { ...cand, depth: null } : cand;
      const s = scoreCandidate(graphs.get(v)!, c);
      scores[v] = s.excluded ? null : s.score;
    }
    out[r.videoId] = scores;
  }
}
fs.writeFileSync(outPath!, JSON.stringify(out, null, 1));
process.stdout.write(`scored ${Object.keys(out).length} videos × ${VARIANTS.length} variants\n`);
