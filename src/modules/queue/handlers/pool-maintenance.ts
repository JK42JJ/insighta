/**
 * Pool Maintenance — fire-and-forget worker (CP494, YouTube ToS hygiene).
 *
 * Two 0-quota DB ops, run unconditionally on an independent cron so they no
 * longer depend on the batch-video-collector success path (which skips its
 * inline soft-expire on early-return / quota-exhaustion days):
 *
 *   Op1 soft-expire : is_active=false for rows past expires_at. Robustness —
 *                     guarantees no expired row is served even on collector-fail
 *                     days. (The collector keeps its own copy as a backstop.)
 *   Op2 scrub       : NULL/blank the stored YouTube metadata of rows whose
 *                     metadata is >30 days old (refreshed_at), keeping video_id
 *                     + embeddings + domain_tags. Satisfies the YouTube
 *                     Developer Policy "refresh OR delete within 30 days"
 *                     (we delete the regulated metadata; video_id is permanently
 *                     storable). scrub (not hard-DELETE) because
 *                     video_pool_embeddings/domain_tags cascade-delete on row
 *                     removal — scrub preserves the expensive 4096d embeddings.
 *
 * No YouTube quota, no DDL. Reviving scrubbed rows (re-fetching text) is a
 * separate P1.1 supply concern, NOT this job.
 *
 * Job flow: GHA cron POST → route enqueues `pool-maintenance-run` → this worker.
 */

import PgBoss from 'pg-boss';
import { config } from '@/config/index';
import { getPrismaClient } from '@/modules/database/client';
import { logger } from '@/utils/logger';
import { getJobQueue } from '../manager';
import { JOB_NAMES, POOL_MAINTENANCE_RUN_OPTIONS, type PoolMaintenanceRunPayload } from '../types';
import { runPoolMetadataRefresh } from '@/modules/video-pool/refresh-metadata';

const log = logger.child({ module: 'queue/pool-maintenance' });

const WORKER_CONCURRENCY = 1;

/** ToS metadata age limit — stored YouTube metadata older than this is scrubbed. */
export const METADATA_TTL_DAYS = 30;

/**
 * Op1 — deactivate rows past their TTL so they are never served. is_active is
 * the only serving gate (cache-matcher / hybrid-rerank / pool-provider), so
 * this is sufficient to keep the served set compliant.
 */
export const EXPIRE_SQL = `
  UPDATE public.video_pool
     SET is_active = false
   WHERE is_active = true AND expires_at < now()
`;

/**
 * Op2 — scrub regulated YouTube metadata from RETIRED rows whose metadata is
 * older than the TTL. NULL where nullable; '' / 0 where NOT NULL. video_id /
 * language / quality_tier / embeddings / domain_tags preserved. Idempotency
 * guard `title <> ''`: already-scrubbed rows are skipped.
 *
 * CP512 — **`is_active = false` guard added**: scrubbing a still-SERVED (active)
 * row emptied its title mid-serve, so users got title-less cards (the P0 defect).
 * Active rows must instead be kept ToS-compliant by REFRESH (videos.list re-fetch
 * + refreshed_at reset — see refresh-pool-metadata), NOT by scrub-to-empty.
 * Scrub-to-delete is only correct for rows already retired from serving.
 */
export const SCRUB_SQL = `
  UPDATE public.video_pool
     SET title = '', description = NULL, channel_name = NULL, channel_id = NULL,
         view_count = 0, like_count = 0, duration_seconds = NULL,
         published_at = NULL, thumbnail_url = NULL
   WHERE is_active = false
     AND refreshed_at < now() - interval '${METADATA_TTL_DAYS} days' AND title <> ''
`;

export interface PoolMaintenanceResult {
  skipped: boolean;
  expired: number;
  scrubbed: number;
}

/**
 * Minimal raw-exec surface — satisfied by both the real PrismaClient
 * (`$executeRawUnsafe` returns a PrismaPromise<number>, assignable to
 * Promise<number>) and a plain jest mock, so the core logic stays DB-free
 * in tests.
 */
export interface RawExecutor {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
}

/**
 * Core logic — pure over an injected raw executor so it is unit-testable
 * without a DB. Op1 then Op2 (disjoint WHERE clauses; order is immaterial).
 */
export async function runPoolMaintenance(
  prisma: RawExecutor,
  opts: { enabled: boolean }
): Promise<PoolMaintenanceResult> {
  if (!opts.enabled) {
    return { skipped: true, expired: 0, scrubbed: 0 };
  }
  const expired = Number(await prisma.$executeRawUnsafe(EXPIRE_SQL));
  const scrubbed = Number(await prisma.$executeRawUnsafe(SCRUB_SQL));
  return { skipped: false, expired, scrubbed };
}

export async function registerPoolMaintenanceWorker(): Promise<void> {
  const boss = getJobQueue().getInstance();
  await boss.work<PoolMaintenanceRunPayload>(
    JOB_NAMES.POOL_MAINTENANCE_RUN,
    { teamConcurrency: WORKER_CONCURRENCY, teamSize: 1 },
    handlePoolMaintenanceRun
  );
  log.info('pool-maintenance worker registered', { concurrency: WORKER_CONCURRENCY });
}

async function handlePoolMaintenanceRun(job: PgBoss.Job<PoolMaintenanceRunPayload>): Promise<void> {
  const startedAt = Date.now();
  const enabled = config.poolMaintenance.enabled;
  log.info('pool-maintenance: starting', { jobId: job.id, enabled, trigger: job.data?.trigger });

  try {
    const result = await runPoolMaintenance(getPrismaClient(), { enabled });
    // Op3 (CP512) — refresh active rows' metadata before it ages past the TTL,
    // so served rows stay ToS-compliant AND keep their titles (the correct
    // "refresh" branch of the 30-day rule, vs the scrub "delete" branch).
    let refresh = { candidates: 0, refreshed: 0, retired: 0 };
    if (enabled && config.poolMaintenance.refreshEnabled) {
      refresh = await runPoolMetadataRefresh();
    }
    log.info('pool-maintenance: completed', {
      jobId: job.id,
      ...result,
      refresh,
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    log.error('pool-maintenance: failed', {
      jobId: job.id,
      durationMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/** Enqueue a single pool-maintenance run. Returns the pg-boss job id or null. */
export async function enqueuePoolMaintenanceRun(
  payload: PoolMaintenanceRunPayload = {},
  options?: PgBoss.SendOptions
): Promise<string | null> {
  const boss = getJobQueue().getInstance();
  return boss.send(JOB_NAMES.POOL_MAINTENANCE_RUN, payload, {
    ...POOL_MAINTENANCE_RUN_OPTIONS,
    ...options,
  });
}
