#!/usr/bin/env npx tsx
/**
 * Backfill script (CP491 step 5): probe the shorts-eligible video_pool backlog
 * (is_short IS NULL AND duration_seconds < 180) and tag is_short. With --demote
 * (default for the real run), rows found to be Shorts are also soft-deleted
 * (is_active=false) so they drop out of v3 tier1 reads.
 *
 * Wraps the probeAndTagShorts engine (step 3) and loops it until the backlog
 * is drained. Resumable (probed rows leave the NULL filter) and fail-open
 * (probe_error rows stay NULL for a later retry).
 *
 * Run IN the prod container (DIRECT_URL + youtube.com both reachable there;
 * no secret leaves the host). NOT auto-executed.
 *
 * Usage:
 *   npx tsx scripts/backfill-shorts.ts --dry-run            # measure short ratio, NO write
 *   npx tsx scripts/backfill-shorts.ts --dry-run --limit 200
 *   npx tsx scripts/backfill-shorts.ts --limit 50           # small batch, tag + demote, 1 pass
 *   npx tsx scripts/backfill-shorts.ts                      # full: loop until drained
 *   npx tsx scripts/backfill-shorts.ts --no-demote          # tag-only, no soft-delete
 *
 * Flags: --dry-run | --limit N | --batch N | --concurrency N | --delay MS
 *        | --max-batches N | --no-demote
 */

import { probeAndTagShorts } from '../src/modules/video-pool/short-probe-runner';
import {
  isShort,
  SHORT_SIGNAL,
  SHORT_MAX_DURATION_SEC,
} from '../src/modules/video-pool/is-short';
import { getPrismaClient } from '../src/modules/database/client';
import { logger } from '../src/utils/logger';

const log = logger.child({ module: 'BackfillShorts' });

const DEFAULT_BATCH = 200;
const DEFAULT_CONCURRENCY = 5;
const DEFAULT_DELAY_MS = 300;
const DEFAULT_DRY_RUN_SAMPLE = 200;
// Safety cap: backlog is ~4.5k rows / 200 per batch ≈ 23 batches. 100 is a
// runaway backstop, not an expected ceiling.
const MAX_BATCHES_CAP = 100;

function argNum(args: string[], flag: string, fallback: number): number {
  const i = args.indexOf(flag);
  if (i < 0) return fallback;
  const n = Number(args[i + 1]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Probe a sample of the backlog and report the short ratio — NO DB write. */
async function dryRun(limit: number, concurrency: number): Promise<void> {
  const prisma = getPrismaClient();
  const rows = await prisma.video_pool.findMany({
    where: { is_short: null, duration_seconds: { lt: SHORT_MAX_DURATION_SEC } },
    select: { video_id: true, duration_seconds: true },
    take: limit,
  });
  log.info(`[dry-run] sampling ${rows.length} <${SHORT_MAX_DURATION_SEC}s rows (no write)`);

  let shorts = 0;
  let normals = 0;
  let errors = 0;
  for (let i = 0; i < rows.length; i += concurrency) {
    const batch = rows.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (row) => {
        const { isShort: short, signal } = await isShort(row.video_id, row.duration_seconds);
        if (signal === SHORT_SIGNAL.PROBE_ERROR) errors += 1;
        else if (short) shorts += 1;
        else normals += 1;
      })
    );
  }
  const probed = shorts + normals;
  const ratio = probed > 0 ? ((shorts / probed) * 100).toFixed(1) : 'n/a';
  log.info(
    `[dry-run] probed=${probed} shorts=${shorts} normals=${normals} errors=${errors} ` +
      `→ short ratio = ${ratio}% (of definitive probes)`
  );
}

/** Count remaining backlog rows (is_short IS NULL AND <180s). */
async function backlogCount(): Promise<number> {
  const prisma = getPrismaClient();
  return prisma.video_pool.count({
    where: { is_short: null, duration_seconds: { lt: SHORT_MAX_DURATION_SEC } },
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const demote = !args.includes('--no-demote');
  const concurrency = argNum(args, '--concurrency', DEFAULT_CONCURRENCY);

  if (isDryRun) {
    const sample = argNum(args, '--limit', DEFAULT_DRY_RUN_SAMPLE);
    await dryRun(sample, concurrency);
    return;
  }

  const batch = argNum(args, '--limit', argNum(args, '--batch', DEFAULT_BATCH));
  const delayMs = argNum(args, '--delay', DEFAULT_DELAY_MS);
  // --limit means a single bounded pass; otherwise loop until drained.
  const singlePass = args.indexOf('--limit') >= 0;
  const maxBatches = singlePass ? 1 : argNum(args, '--max-batches', MAX_BATCHES_CAP);

  const before = await backlogCount();
  log.info(
    `backfill start: backlog=${before} batch=${batch} concurrency=${concurrency} ` +
      `delay=${delayMs}ms demote=${demote} singlePass=${singlePass} maxBatches=${maxBatches}`
  );

  const totals = { probed: 0, shorts: 0, normals: 0, errors: 0, demoted: 0 };
  for (let b = 0; b < maxBatches; b += 1) {
    const r = await probeAndTagShorts({ limit: batch, concurrency, delayMs, demote });
    totals.probed += r.probed;
    totals.shorts += r.shorts;
    totals.normals += r.normals;
    totals.errors += r.errors;
    totals.demoted += r.demoted;
    log.info(
      `  batch ${b + 1}: probed=${r.probed} shorts=${r.shorts} demoted=${r.demoted} errors=${r.errors}`
    );
    // probeAndTagShorts returns 0 probed only when no rows matched (drained) OR
    // every row in the batch errored. errors stay NULL → would re-loop forever;
    // stop when a batch made no definitive progress.
    if (r.probed === 0) break;
  }

  const after = await backlogCount();
  log.info(
    `backfill done: probed=${totals.probed} shorts=${totals.shorts} normals=${totals.normals} ` +
      `errors=${totals.errors} demoted=${totals.demoted} | backlog ${before} → ${after}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    log.error({ err }, 'backfill-shorts failed');
    process.exit(1);
  });
