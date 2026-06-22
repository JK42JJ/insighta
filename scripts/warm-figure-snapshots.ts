#!/usr/bin/env npx tsx
/**
 * C' figure-snapshot warming (figure deck chain).
 *
 * Pre-extracts figures for a mandala's high-relevance segments into
 * video_figure_snapshots, so the demo button chain only COLLECTS cached figures
 * (D) + builds — no live numerize at click time (numerize is 10-60s/video, not
 * one-take-able). Picks figure-worthy timestamps SPREAD across cells (theme
 * groups) via selectWarmTargets (capped — no over-extraction).
 *
 * Calls the insighta-internal POST /api/v1/internal/snapshot/get-or-extract
 * route (x-internal-token); that route's numerize-client does the actual
 * extraction — but only when extract is ENABLED (A: SNAPSHOT_SERVICE_TOKEN set)
 * AND the slidegen /numerize responds (B). Until A+B, --execute extracts nothing
 * (returns []), so this is gated:
 *
 *   --dry-run (DEFAULT): build + print the warm plan (video/cell/ts). NO HTTP,
 *                        NO writes. Verifies the selection up to the call.
 *   --execute         : actually POST get-or-extract per target (prod write =
 *                        snapshots upsert). Run ONLY after A+B land, per James.
 *
 * Run IN the prod container (DIRECT_URL + API both reachable). NOT auto-executed.
 *
 * Usage:
 *   npx tsx scripts/warm-figure-snapshots.ts                       # dry-run, mandala 942
 *   npx tsx scripts/warm-figure-snapshots.ts --mandala <uuid>      # dry-run other mandala
 *   npx tsx scripts/warm-figure-snapshots.ts --execute             # real extraction (A+B required)
 *   npx tsx scripts/warm-figure-snapshots.ts --min-rel 75 --per-cell 3 --per-video 4
 */

import { getPrismaClient } from '@/modules/database/client';
import { getInternalBatchToken } from '@/config/internal-auth';
import { selectWarmTargets, type RelSegment } from '@/modules/snapshot/warm-select';

const DEMO_MANDALA = '942e2757-64fa-4759-afc5-56e2f33869f2';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main(): Promise<void> {
  const mandalaId = arg('mandala', DEMO_MANDALA)!;
  const execute = process.argv.includes('--execute');
  const minRel = Number(arg('min-rel', '80'));
  const perCellVideoCap = Number(arg('per-cell', '2'));
  const perVideoTsCap = Number(arg('per-video', '3'));
  const prisma = getPrismaClient();

  // High-relevance segments + per-video cell (placements). Both user-scoped tables.
  const segments = await prisma.$queryRawUnsafe<RelSegment[]>(
    `SELECT video_id AS "videoId", from_sec AS "fromSec", relevance_pct AS "relevancePct"
     FROM video_mandala_segment_relevance
     WHERE mandala_id = $1::uuid AND relevance_pct >= $2
     ORDER BY relevance_pct DESC`,
    mandalaId,
    minRel
  );
  const cells = await prisma.$queryRawUnsafe<{ vid: string; cell: number }[]>(
    `SELECT yv.youtube_video_id AS vid, uvs.cell_index AS cell
       FROM user_video_states uvs JOIN youtube_videos yv ON yv.id = uvs.video_id
       WHERE uvs.mandala_id = $1::uuid AND uvs.cell_index >= 0
     UNION
     SELECT ulc.video_id AS vid, ulc.cell_index AS cell
       FROM user_local_cards ulc
       WHERE ulc.mandala_id = $1::uuid AND ulc.cell_index >= 0 AND ulc.video_id IS NOT NULL`,
    mandalaId
  );
  const cellByVideo = new Map<string, number>();
  for (const c of cells) if (!cellByVideo.has(c.vid)) cellByVideo.set(c.vid, c.cell);

  const targets = selectWarmTargets(segments, cellByVideo, { minRel, perCellVideoCap, perVideoTsCap });
  const tsCount = targets.reduce((n, t) => n + t.ts.length, 0);

  console.log(`[warm] mandala ${mandalaId} | segments>=${minRel}: ${segments.length} | targets: ${targets.length} videos / ${tsCount} ts (cap ${perCellVideoCap}/cell, ${perVideoTsCap}/video)`);
  for (const t of targets) console.log(`  cell${t.cellIndex} ${t.videoId} ts=${JSON.stringify(t.ts)}`);

  if (!execute) {
    console.log('[warm] DRY-RUN — no HTTP, no writes. Add --execute after extract is ENABLED (A) + slidegen /numerize responds (B).');
    await prisma.$disconnect();
    return;
  }

  // --execute: real extraction via the internal route (prod write = snapshots upsert).
  const token = getInternalBatchToken();
  if (!token) {
    console.log('[warm] ABORT: INTERNAL_BATCH_TOKEN unset — cannot call internal route.');
    await prisma.$disconnect();
    return;
  }
  const base = process.env['API_INTERNAL_BASE'] ?? 'http://localhost:3000';
  let ok = 0,
    empty = 0,
    fail = 0;
  for (const t of targets) {
    try {
      const resp = await fetch(`${base}/api/v1/internal/snapshot/get-or-extract`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-token': token },
        body: JSON.stringify({ videoId: t.videoId, ts: t.ts }),
      });
      const body = (await resp.json()) as { figures?: unknown[] };
      const n = Array.isArray(body.figures) ? body.figures.length : 0;
      if (n > 0) ok += 1;
      else empty += 1;
      console.log(`  ${t.videoId}: ${resp.status} figures=${n}`);
    } catch (e) {
      fail += 1;
      console.log(`  ${t.videoId}: ERR ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`[warm] execute done — videos with figures: ${ok}, empty: ${empty}, fail: ${fail}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('[warm] fatal:', e);
  process.exit(1);
});
