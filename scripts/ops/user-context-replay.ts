/**
 * Replay check for the user-context graph (read-only, no DB, no network).
 *
 * For each judgment in time order: score the judged video with the context as it stood just
 * before, then apply the judgment. Compares how well the score separates useful from skip (AUC),
 * with labels (concepts / format / depth) and without (channel only).
 *
 * Usage: npx tsx scripts/ops/user-context-replay.ts <candidates.json> <judgments.json> <labels.json>
 */
import * as fs from 'fs';

import {
  addVideoToGraph,
  applyJudgments,
  createContextGraph,
  scoreCandidate,
  type Candidate,
  type ContextGraph,
} from '@/modules/user-context';

interface CandidateRow {
  video_id: string;
  cell: string;
  title: string;
  channel_id: string | null;
  channel_name: string | null;
  duration_seconds: number | null;
  language: string | null;
  published_at: string | null;
}
interface JudgmentRow {
  video_id: string;
  cell: string;
  verdict: 'useful' | 'skip' | 'pass';
  at: string;
  watched_seconds: number | null;
}
interface Label {
  concepts: string[];
  format: string;
  depth: string;
}

const USER_ID = '00000000-0000-4000-8000-000000000001';
const HALF = 0.5;

function auc(points: Array<{ score: number; positive: boolean }>): number | null {
  const pos = points.filter((p) => p.positive).map((p) => p.score);
  const neg = points.filter((p) => !p.positive).map((p) => p.score);
  if (pos.length === 0 || neg.length === 0) return null;
  let wins = 0;
  for (const a of pos) for (const b of neg) wins += a > b ? 1 : a === b ? HALF : 0;
  return wins / (pos.length * neg.length);
}

function run(
  cands: CandidateRow[],
  judgments: JudgmentRow[],
  labels: Record<string, Label> | null,
  scope: 'cell' | 'user'
): { auc: number | null; n: number; informative: number; useful: number; skip: number } {
  const graphs = new Map<string, ContextGraph>();
  const keyOf = (cell: string): string => (scope === 'cell' ? cell : 'all');
  const graphFor = (cell: string): ContextGraph => {
    const k = keyOf(cell);
    let g = graphs.get(k);
    if (!g) {
      const cellsHere = scope === 'cell' ? [cell] : [...new Set(cands.map((c) => c.cell))];
      g = createContextGraph({
        userId: USER_ID,
        contextKey: k,
        goalText: k,
        branches: cellsHere.map((t) => ({ title: t })),
      });
      for (const c of cands.filter((x) => scope === 'user' || x.cell === cell)) {
        const l = labels?.[c.video_id];
        g = addVideoToGraph(g, {
          videoId: c.video_id,
          title: c.title,
          concepts: (l?.concepts ?? []).map((term) => ({ term, weight: 1 })),
          format: l?.format,
          depth: l?.depth ?? null,
          channelId: c.channel_id ?? undefined,
          channelTitle: c.channel_name ?? undefined,
          durationSeconds: c.duration_seconds,
          language: c.language,
          publishedAt: c.published_at,
          branchId: undefined,
        });
      }
      graphs.set(k, g);
    }
    return g;
  };

  const points: Array<{ score: number; positive: boolean }> = [];
  for (const j of judgments) {
    const c = cands.find((x) => x.video_id === j.video_id);
    if (!c) continue;
    const g = graphFor(j.cell);
    const l = labels?.[j.video_id];
    const cand: Candidate = {
      videoId: j.video_id,
      concepts: (l?.concepts ?? []).map((term) => ({ term, weight: 1 })),
      format: l?.format,
      channelId: c.channel_id ?? undefined,
      depth: l?.depth ?? null,
      branch: j.cell,
      passesBaseFilters: true,
    };
    if (j.verdict !== 'pass') {
      const s = scoreCandidate(g, cand);
      points.push({ score: s.excluded ? Number.NEGATIVE_INFINITY : s.score, positive: j.verdict === 'useful' });
    }
    const next = applyJudgments(g, [
      { videoId: j.video_id, verdict: j.verdict, watchedSeconds: j.watched_seconds, day: j.at.slice(0, 10) },
    ]);
    graphs.set(keyOf(j.cell), next.graph);
  }
  const base = points.length > 0 ? points[0].score : 0;
  return {
    auc: auc(points),
    n: points.length,
    informative: points.filter((p) => p.score !== base).length,
    useful: points.filter((p) => p.positive).length,
    skip: points.filter((p) => !p.positive).length,
  };
}

const [candPath, judgPath, labelPath] = process.argv.slice(2);
const cands = JSON.parse(fs.readFileSync(candPath, 'utf-8')) as CandidateRow[];
const judgments = (JSON.parse(fs.readFileSync(judgPath, 'utf-8')) as JudgmentRow[]).sort((a, b) =>
  a.at.localeCompare(b.at)
);
const labels = JSON.parse(fs.readFileSync(labelPath, 'utf-8')) as Record<string, Label>;
for (const scope of ['cell', 'user'] as const) {
  for (const [name, l] of [
    ['labels', labels],
    ['no labels', null],
  ] as const) {
    const r = run(cands, judgments, l, scope);
    process.stdout.write(
      `${scope}-scope ${name}: AUC ${r.auc === null ? 'n/a' : r.auc.toFixed(3)} | scored ${r.n} (useful ${r.useful}, skip ${r.skip}) | scores different from the first ${r.informative}\n`
    );
  }
}
