/**
 * Experiment: apply the day's judgments to the context graph (v1 -> v2) and write the diff.
 * Reads the v1 snapshot, the batch ledger (arm, branch, labels), video details and the exported
 * judgments; adds the judged videos to the graph; applies the judgments in time order in ONE call
 * (so the diff is v1 -> v2); writes the v2 snapshot and the diff. DB write only with --persist
 * (stg DIRECT_URL passed inline).
 *
 * Usage: npx tsx scripts/ops/user-context-apply.ts <ctx_v1.json> <batch.json> <details.json> <judgments.json> <out_dir> [--persist] [--arm context|all]
 */
import * as fs from 'fs';
import * as path from 'path';

import {
  addVideoToGraph,
  applyJudgments,
  diffGraphs,
  dropJudgments,
  persistGraph,
  recomputeWeights,
  restoreGraph,
  snapshotGraph,
  type ContextGraph,
  type Judgment,
  type UserContextDb,
} from '@/modules/user-context';
import { cloneGraph, findBranch, freeze } from '@/modules/user-context/graph';

interface BatchRow {
  videoId: string;
  arm: 'context' | 'current' | 'both';
  branch?: string;
  channelId: string;
  channel: string;
  title: string;
  lang: string;
  publishedAt: string;
  durationSec: number;
  label: { concepts: string[]; format: string; depth: string } | null;
}
interface JudgmentRow {
  video_id: string;
  verdict: 'useful' | 'skip' | 'pass';
  watched_seconds: number | null;
  at: string;
  /** set on a canceled row; such rows are never applied */
  canceled_at?: string | null;
}

const TX_TIMEOUT_MS = 120_000;
const TX_MAX_WAIT_MS = 10_000;

const [ctxPath, batchPath, detailsPath, judgPath, outDir] = process.argv.slice(2);
const armFilter = process.argv.includes('--arm')
  ? process.argv[process.argv.indexOf('--arm') + 1]
  : 'all';
const v1: ContextGraph = restoreGraph(JSON.parse(fs.readFileSync(ctxPath, 'utf-8')).snapshot);
const rows = (JSON.parse(fs.readFileSync(batchPath, 'utf-8')) as { rows: BatchRow[] }).rows;
const details = JSON.parse(fs.readFileSync(detailsPath, 'utf-8')) as Record<
  string,
  { channelId: string; channelTitle: string }
>;
// James 2026-11-13: one verdict per video — the latest live (not canceled) row. A video whose rows
// are all canceled loses its JUDGED edge (dropJudgments), so a canceled verdict is never counted.
const allRows = JSON.parse(fs.readFileSync(judgPath, 'utf-8')) as JudgmentRow[];
const latestLive = new Map<string, JudgmentRow>();
const seenIds = new Set<string>();
for (const r of [...allRows].sort((a, b) => a.at.localeCompare(b.at))) {
  seenIds.add(r.video_id);
  if (r.canceled_at) continue;
  latestLive.set(r.video_id, r);
}
const canceledOnly = [...seenIds].filter((id) => !latestLive.has(id));
const judgments = [...latestLive.values()].sort((a, b) => a.at.localeCompare(b.at));

const byId = new Map(rows.map((r) => [r.videoId, r]));
let g = v1;
for (const r of rows) {
  if (armFilter !== 'all' && r.arm !== armFilter && r.arm !== 'both') continue;
  const branchNode = r.branch ? findBranch(g, r.branch) : undefined;
  g = addVideoToGraph(g, {
    videoId: r.videoId,
    title: r.title,
    concepts: (r.label?.concepts ?? []).map((term) => ({ term, weight: 1 })),
    format: r.label?.format,
    channelId: details[r.videoId]?.channelId ?? r.channelId,
    channelTitle: details[r.videoId]?.channelTitle ?? r.channel,
    depth: r.label?.depth ?? null,
    durationSeconds: r.durationSec,
    language: r.lang,
    publishedAt: r.publishedAt,
    branchId: branchNode?.id ?? null,
  });
}
const withVideos = canceledOnly.length > 0 ? dropJudgments(g, canceledOnly) : g;

const js: Judgment[] = judgments
  .filter((j) => byId.has(j.video_id))
  .filter(
    (j) =>
      armFilter === 'all' ||
      byId.get(j.video_id)!.arm !== (armFilter === 'context' ? 'current' : 'context')
  )
  .map((j) => ({
    videoId: j.video_id,
    verdict: j.verdict,
    watchedSeconds: j.watched_seconds,
    day: j.at.slice(0, 10),
    batchId: '2026-11-13/기술/개발',
    arm: byId.get(j.video_id)!.arm,
  }));

const stepped = applyJudgments(withVideos, js);
// James 2026-11-13: weights are recomputed from the whole history (order-independent), the
// '입문용 개념 설명 피함' entry leaves the context, and the diff is v1 -> recomputed.
const recomputed = recomputeWeights(stepped.graph);
const m = cloneGraph(recomputed);
const ctxNode = m.nodes.get(m.contextId);
if (ctxNode) ctxNode.properties = { ...ctxNode.properties, avoid: [] };
const v2 = freeze(m);
const diff = diffGraphs(
  withVideos,
  v2,
  js.map((j) => ({ videoId: j.videoId, verdict: j.verdict }))
);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, `ctx_v2_${armFilter}.json`),
  JSON.stringify({ snapshot: snapshotGraph(v2) }, null, 1)
);
fs.writeFileSync(path.join(outDir, `diff_v1_v2_${armFilter}.json`), JSON.stringify(diff, null, 1));
process.stdout.write(
  `arm=${armFilter} judgments applied ${js.length} (rows ${allRows.length}, canceled-only ${canceledOnly.length}) | version ${diff.versionBefore} -> ${diff.versionAfter} | edge changes ${diff.edges.length} | avoids +${diff.avoidsAdded.length} ^${diff.avoidsRaised.length} -${diff.avoidsRemoved.length}\n`
);

async function main(): Promise<void> {
  if (!process.argv.includes('--persist')) return;
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const db = {
      $transaction: <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
        prisma.$transaction(fn as never, {
          timeout: TX_TIMEOUT_MS,
          maxWait: TX_MAX_WAIT_MS,
        }) as Promise<T>,
      $queryRawUnsafe: prisma.$queryRawUnsafe.bind(prisma),
      $executeRawUnsafe: prisma.$executeRawUnsafe.bind(prisma),
    };
    const prevIdx = process.argv.indexOf('--previous');
    const previous: ContextGraph =
      prevIdx > 0
        ? restoreGraph(JSON.parse(fs.readFileSync(process.argv[prevIdx + 1], 'utf-8')).snapshot)
        : v1;
    const res = await persistGraph(db as unknown as UserContextDb, v2, { previous });
    process.stdout.write(`persisted ${JSON.stringify(res)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}
void main();
