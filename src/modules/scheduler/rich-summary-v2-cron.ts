/**
 * Rich Summary v2 cron — prod-runtime backfill (CP437).
 *
 * Schedules a node-cron task that picks N candidate videos per cycle
 * (N = `RICH_SUMMARY_V2_BATCH_SIZE`, default 50) and generates the v2
 * layered summary for each via `generateRichSummaryV2`.
 *
 * Track priority (matches docs/design/rich-summary-v2-validation-filter.md §2):
 *   1. Track A: existing v1 rows that need regeneration
 *      - structured IS NULL (jsonb-null)
 *      - quality_flag = 'low'
 *      - actionables array < 3
 *      - completeness < 0.7 (v2 metric, when populated)
 *   2. Track A2 (CP475+): v2 rows where the first generation produced
 *      `quality_flag = 'low'` — cooldown V2_LOW_RETRY_COOLDOWN_HOURS (default 12h)
 *      since `updated_at` to avoid hammering transient failures. After one
 *      retry the row is marked `quality_flag = 'low_retried'` (permanent) so
 *      it is never re-picked by this track. Manual intervention required to
 *      reset.
 *   3. Track B: youtube_videos with no rich_summary row at all
 *      - quality-pass (view_count ≥ 1000, duration 60-10800)
 *      - bookmark count desc, then view_count desc
 *
 * Hard Rule note: this cron runs ON THE PROD SERVER as part of the API
 * process (started in `src/api/server.ts` after the rest of the runtime
 * boots). It IS a service-operation path — explicit user authorization
 * was given (CP437 decision B-2). Default `RICH_SUMMARY_V2_CRON_ENABLED=false`
 * keeps the cron dormant until prod operator flips it.
 *
 * Concurrency: candidates are processed serially (Promise.all loop with a
 * single in-flight call) to keep the LLM provider rate-limit headroom for
 * the user-facing wizard path. If batches are too slow, raise
 * `RICH_SUMMARY_V2_BATCH_SIZE` rather than parallelizing here.
 */

import * as cron from 'node-cron';
import { Prisma } from '@prisma/client';

import { getPrismaClient } from '@/modules/database/client';
import { loadRichSummaryConfig } from '@/config/rich-summary';
import { logger } from '@/utils/logger';

import { generateRichSummaryV2 } from '../skills/rich-summary-v2-generator';

const log = logger.child({ module: 'RichSummaryV2Cron' });

let cronTask: cron.ScheduledTask | null = null;
let runInProgress = false;

const V2_LOW_RETRIED_FLAG = 'low_retried';

/** Distinct candidate kinds so retry rows can be tracked separately. */
export type V2CandidateKind = 'trackA-v1' | 'trackA2-v2-low' | 'trackB-new';
export interface V2Candidate {
  videoId: string;
  kind: V2CandidateKind;
}

/**
 * Pull up to `limit` candidates for the next batch. Track A → A2 → B in
 * priority order; earlier tracks fill until exhausted.
 */
export async function selectV2Candidates(limit: number): Promise<V2Candidate[]> {
  if (limit <= 0) return [];
  const prisma = getPrismaClient();

  // Track A — v1 rows that need regeneration
  const trackA = await prisma.$queryRaw<{ video_id: string }[]>(Prisma.sql`
    SELECT video_id
    FROM video_rich_summaries
    WHERE template_version = 'v1'
      AND (
        jsonb_typeof(structured) = 'null'
        OR quality_flag = 'low'
        OR (
          jsonb_typeof(structured) = 'object'
          AND COALESCE(jsonb_array_length(NULLIF(structured->'actionables', 'null'::jsonb)), 0) < 3
        )
      )
    ORDER BY quality_score ASC NULLS FIRST
    LIMIT ${Prisma.raw(String(limit))}
  `);
  const candidates: V2Candidate[] = trackA.map((r) => ({
    videoId: r.video_id,
    kind: 'trackA-v1' as const,
  }));
  if (candidates.length >= limit) return candidates;

  // Track A2 — v2 rows with quality_flag='low', cooldown
  // `v2LowRetryCooldownHours` (env-tunable, default 12) since `updated_at`.
  // One retry only — after this pass the row is marked 'low_retried' so it
  // can never re-enter this track.
  const a2Remaining = limit - candidates.length;
  const cooldownHours = loadRichSummaryConfig().v2LowRetryCooldownHours;
  const trackA2 = await prisma.$queryRaw<{ video_id: string }[]>(Prisma.sql`
    SELECT video_id
    FROM video_rich_summaries
    WHERE template_version = 'v2'
      AND quality_flag = 'low'
      AND updated_at < now() - make_interval(hours => ${Prisma.raw(String(cooldownHours))})
    ORDER BY updated_at ASC
    LIMIT ${Prisma.raw(String(a2Remaining))}
  `);
  for (const r of trackA2) {
    candidates.push({ videoId: r.video_id, kind: 'trackA2-v2-low' });
  }
  if (candidates.length >= limit) return candidates;

  // Track B — youtube_videos with no rich_summary row, quality-pass, bookmark-priority
  const remaining = limit - candidates.length;
  const trackB = await prisma.$queryRaw<{ youtube_video_id: string }[]>(Prisma.sql`
    SELECT yv.youtube_video_id
    FROM youtube_videos yv
    LEFT JOIN video_rich_summaries rs ON rs.video_id = yv.youtube_video_id
    LEFT JOIN (
      SELECT youtube_video_id, COUNT(*) AS bookmark_count
      FROM (
        SELECT yv2.youtube_video_id
        FROM user_video_states uvs
        JOIN youtube_videos yv2 ON yv2.id = uvs.video_id
      ) sub
      GROUP BY youtube_video_id
    ) book ON book.youtube_video_id = yv.youtube_video_id
    WHERE rs.video_id IS NULL
      AND yv.view_count >= 1000
      AND yv.duration_seconds BETWEEN 60 AND 10800
    ORDER BY COALESCE(book.bookmark_count, 0) DESC, yv.view_count DESC
    LIMIT ${Prisma.raw(String(remaining))}
  `);
  for (const r of trackB) {
    candidates.push({ videoId: r.youtube_video_id, kind: 'trackB-new' });
  }
  return candidates;
}

/**
 * Mark a Track A2 row as `low_retried` so it can never re-enter the retry
 * track regardless of further `updated_at` ageing. Called after a Track A2
 * retry produces another `low` outcome.
 */
async function markLowRetried(videoId: string): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.$executeRaw(Prisma.sql`
    UPDATE video_rich_summaries
    SET quality_flag = ${V2_LOW_RETRIED_FLAG}
    WHERE video_id = ${videoId}
      AND template_version = 'v2'
      AND quality_flag = 'low'
  `);
}

/**
 * Single batch run — used by both the cron tick and an admin-trigger
 * endpoint (future). Serial processing; logs each outcome.
 */
export async function runV2BatchOnce(batchSize: number): Promise<{
  picked: number;
  pass: number;
  low: number;
  skip: number;
  errors: number;
  lowRetried: number;
}> {
  if (runInProgress) {
    log.warn('v2 cron tick skipped — previous run still in progress');
    return { picked: 0, pass: 0, low: 0, skip: 0, errors: 0, lowRetried: 0 };
  }
  runInProgress = true;
  const t0 = Date.now();
  try {
    const candidates = await selectV2Candidates(batchSize);
    log.info('v2 cron batch start', {
      picked: candidates.length,
      batchSize,
      byKind: countByKind(candidates),
    });
    let pass = 0;
    let low = 0;
    let skip = 0;
    let errors = 0;
    let lowRetried = 0;
    for (const cand of candidates) {
      try {
        const outcome = await generateRichSummaryV2({ videoId: cand.videoId });
        if (outcome.kind === 'pass') pass += 1;
        else if (outcome.kind === 'low') {
          low += 1;
          // Track A2 retry that produced another 'low' → permanent stop marker.
          if (cand.kind === 'trackA2-v2-low') {
            await markLowRetried(cand.videoId);
            lowRetried += 1;
            log.info('v2 cron: row marked low_retried after retry', {
              videoId: cand.videoId,
            });
          }
        } else skip += 1;
      } catch (err) {
        errors += 1;
        log.error('v2 cron item failed', {
          videoId: cand.videoId,
          kind: cand.kind,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    log.info('v2 cron batch done', {
      picked: candidates.length,
      pass,
      low,
      skip,
      errors,
      lowRetried,
      elapsedMs: Date.now() - t0,
    });
    return { picked: candidates.length, pass, low, skip, errors, lowRetried };
  } finally {
    runInProgress = false;
  }
}

function countByKind(candidates: V2Candidate[]): Record<V2CandidateKind, number> {
  const out: Record<V2CandidateKind, number> = {
    'trackA-v1': 0,
    'trackA2-v2-low': 0,
    'trackB-new': 0,
  };
  for (const c of candidates) out[c.kind] += 1;
  return out;
}

/**
 * Start the cron task. Idempotent — repeat calls re-arm with the latest
 * config.
 */
export function startRichSummaryV2Cron(): void {
  const config = loadRichSummaryConfig();
  if (!config.v2CronEnabled) {
    log.info('v2 cron disabled (RICH_SUMMARY_V2_CRON_ENABLED=false)');
    return;
  }
  if (!config.enabled) {
    log.warn('v2 cron requested but RICH_SUMMARY_ENABLED=false — refusing to start');
    return;
  }
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
  }
  if (!cron.validate(config.v2CronSchedule)) {
    log.error('v2 cron schedule invalid — not started', {
      schedule: config.v2CronSchedule,
    });
    return;
  }
  cronTask = cron.schedule(config.v2CronSchedule, () => {
    void runV2BatchOnce(config.v2BatchSize);
  });
  log.info('v2 cron started', {
    schedule: config.v2CronSchedule,
    batchSize: config.v2BatchSize,
  });
}

export function stopRichSummaryV2Cron(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    log.info('v2 cron stopped');
  }
}
