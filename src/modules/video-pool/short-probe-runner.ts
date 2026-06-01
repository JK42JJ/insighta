/**
 * Async Shorts probe runner (CP491, step 3/5).
 *
 * Tag engine: finds video_pool rows still pending a probe within the
 * shorts-eligible band (is_short IS NULL AND duration_seconds < 180 — the
 * step-1 partial index), probes each via the shared isShort() helper
 * (step 2), and writes is_short / short_signal / short_probed_at.
 *
 * - Throttled (concurrency + inter-batch delay) so bulk runs don't trip
 *   YouTube rate limits.
 * - Resumable: probed rows drop out of the `is_short IS NULL` filter, so a
 *   re-run simply continues. Safe to stop/restart mid-backfill.
 * - Fail-open: a `probe_error` row is left NULL (NOT written) so it is
 *   re-probed next run — never blocks/demotes on a flaky probe.
 * - `demote` (default false) is opt-in for the backfill (step 5): when a
 *   row is a Short it is also soft-deleted (is_active=false). Default runs
 *   tag-only. New rows are tagged inline at the promote gate (step 4); this
 *   module is for backfill + bulk re-probe.
 *
 * The short_signal value written is exactly what isShort() returns
 * (SHORT_SIGNAL.*) — single vocabulary, no hardcoded strings here.
 */

import { getPrismaClient } from '@/modules/database/client';
import { logger } from '@/utils/logger';
import { isShort, SHORT_SIGNAL, SHORT_MAX_DURATION_SEC } from './is-short';

const log = logger.child({ module: 'video-pool/short-probe-runner' });

type PoolRow = { video_id: string; duration_seconds: number | null };

/** Minimal Prisma surface used here — lets tests inject a mock. */
export interface PrismaLike {
  video_pool: {
    findMany: (args: unknown) => Promise<PoolRow[]>;
    update: (args: unknown) => Promise<unknown>;
  };
}

export interface ProbeRunOpts {
  /** Max rows to probe this run. Default 200. */
  limit?: number;
  /** Concurrent probes per batch. Default 4. */
  concurrency?: number;
  /** Delay between batches (ms). Default 200. */
  delayMs?: number;
  /** Also soft-delete (is_active=false) rows found to be Shorts. Default false. */
  demote?: boolean;
  /** Inject Prisma (tests). */
  prisma?: PrismaLike;
  /** Inject the detector (tests). */
  isShortImpl?: typeof isShort;
}

export interface ProbeRunResult {
  /** Rows that got a definitive tag (short or normal). */
  probed: number;
  shorts: number;
  normals: number;
  /** Probe errors — left NULL for retry, not counted as probed. */
  errors: number;
  /** Rows soft-deleted (only when demote=true). */
  demoted: number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function probeAndTagShorts(opts: ProbeRunOpts = {}): Promise<ProbeRunResult> {
  const db: PrismaLike = opts.prisma ?? (getPrismaClient() as unknown as PrismaLike);
  const limit = opts.limit ?? 200;
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const delayMs = opts.delayMs ?? 200;
  const demote = opts.demote ?? false;
  const probe = opts.isShortImpl ?? isShort;

  const rows = await db.video_pool.findMany({
    where: { is_short: null, duration_seconds: { lt: SHORT_MAX_DURATION_SEC } },
    select: { video_id: true, duration_seconds: true },
    take: limit,
  });

  let shorts = 0;
  let normals = 0;
  let errors = 0;
  let demoted = 0;

  for (let i = 0; i < rows.length; i += concurrency) {
    const batch = rows.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (row) => {
        const { isShort: short, signal } = await probe(row.video_id, row.duration_seconds);
        // Fail-open: don't persist probe errors — leave NULL for a later retry.
        if (signal === SHORT_SIGNAL.PROBE_ERROR) {
          errors += 1;
          return;
        }
        const willDemote = short && demote;
        await db.video_pool.update({
          where: { video_id: row.video_id },
          data: {
            is_short: short,
            short_signal: signal, // SSOT: exactly isShort()'s SHORT_SIGNAL value
            short_probed_at: new Date(),
            ...(willDemote ? { is_active: false } : {}),
          },
        });
        if (short) shorts += 1;
        else normals += 1;
        if (willDemote) demoted += 1;
      })
    );
    if (i + concurrency < rows.length && delayMs > 0) await sleep(delayMs);
  }

  log.info(
    `probeAndTagShorts: probed=${shorts + normals} shorts=${shorts} normals=${normals} ` +
      `errors=${errors} demoted=${demoted} (limit=${limit}, demote=${demote})`
  );
  return { probed: shorts + normals, shorts, normals, errors, demoted };
}
