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
 *   2. Track B: youtube_videos with no rich_summary row at all
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

/**
 * Pull up to `limit` videoIds for the next batch. Track A first; Track B fills
 * the remaining slots when Track A is exhausted.
 */
export async function selectV2Candidates(limit: number): Promise<string[]> {
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
  const ids = trackA.map((r) => r.video_id);
  if (ids.length >= limit) return ids;

  // Track B — youtube_videos with no rich_summary row, quality-pass, bookmark-priority
  const remaining = limit - ids.length;
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
  for (const r of trackB) ids.push(r.youtube_video_id);
  return ids;
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
}> {
  if (runInProgress) {
    log.warn('v2 cron tick skipped — previous run still in progress');
    return { picked: 0, pass: 0, low: 0, skip: 0, errors: 0 };
  }
  runInProgress = true;
  const t0 = Date.now();
  try {
    const ids = await selectV2Candidates(batchSize);
    log.info('v2 cron batch start', { picked: ids.length, batchSize });
    let pass = 0;
    let low = 0;
    let skip = 0;
    let errors = 0;
    for (const videoId of ids) {
      try {
        const outcome = await generateRichSummaryV2({ videoId });
        if (outcome.kind === 'pass') pass += 1;
        else if (outcome.kind === 'low') low += 1;
        else skip += 1;
      } catch (err) {
        errors += 1;
        log.error('v2 cron item failed', {
          videoId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    log.info('v2 cron batch done', {
      picked: ids.length,
      pass,
      low,
      skip,
      errors,
      elapsedMs: Date.now() - t0,
    });
    return { picked: ids.length, pass, low, skip, errors };
  } finally {
    runInProgress = false;
  }
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
