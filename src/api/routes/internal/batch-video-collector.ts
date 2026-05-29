/**
 * Internal trigger endpoint for the batch-video-collector skill.
 *
 * Protected by a shared token (`INTERNAL_BATCH_TOKEN`) so GitHub Actions
 * (or another internal caller) can invoke the skill without a user JWT.
 * DO NOT expose this token to the browser — it bypasses per-user auth.
 *
 * POST /api/v1/internal/skills/batch-video-collector/run
 *   Headers: x-internal-token: <token>
 *   Body: { limit?: number, runType?: string, trigger?: string }
 *   Response (202): { success: true, accepted: true, jobId: string }
 *
 * CP489+ (2026-05-29) — fire-and-forget pivot.
 *
 * Before: this route awaited `skillRegistry.execute(...)` synchronously and
 * the GHA curl waited for the response. After PR #782 raised the daily
 * keyword limit 60 → 200 the executor exceeded prod nginx's 180s
 * `proxy_read_timeout`, so every scheduled run failed with curl exit 22
 * (HTTP 504) at exactly the 3-minute mark.
 *
 * Now: the route enqueues a pg-boss job (BATCH_VIDEO_COLLECTOR_RUN) and
 * ACKs in milliseconds. A background worker (see
 * `src/modules/queue/handlers/batch-video-collector.ts`) runs the skill
 * with unbounded duration — its progress and final status are visible via
 * the existing `video_pool_collection_runs` table and BE logs. Failure of
 * a single run is bounded by the next cron tick + the morning watchdog.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { enqueueBatchVideoCollectorRun } from '@/modules/queue';
import { getInternalBatchToken } from '@/config/internal-auth';
import { getPrismaClient } from '@/modules/database/client';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'api/internal/batch-video-collector' });

/**
 * Default freshness window for the watchdog. A successful collector run
 * within the last 25h means yesterday's slot is covered (the schedule is
 * 2×/day at 07:30 + 19:30 UTC, so a healthy 24h window has at least one
 * success; 25h gives 1h slack for cron jitter and processing time).
 */
const DEFAULT_WATCHDOG_GRACE_HOURS = 25;

/** Statuses that count as "the run actually happened". */
const HEALTHY_STATUSES = ['success', 'partial'] as const;

function verifyInternalToken(request: FastifyRequest, reply: FastifyReply): boolean {
  const expected = getInternalBatchToken();
  if (!expected) {
    log.warn('INTERNAL_BATCH_TOKEN not set — refusing to serve');
    void reply.code(503).send({ error: 'internal trigger not configured' });
    return false;
  }
  const got = request.headers['x-internal-token'];
  if (typeof got !== 'string' || got !== expected) {
    log.warn('internal route rejected: bad token');
    void reply.code(401).send({ error: 'invalid internal token' });
    return false;
  }
  return true;
}

export const internalBatchVideoCollectorRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{
    Body: { limit?: number; runType?: string; trigger?: string };
  }>('/batch-video-collector/run', async (request, reply) => {
    if (!verifyInternalToken(request, reply)) return reply;

    const { limit, runType, trigger } = request.body ?? {};

    try {
      const jobId = await enqueueBatchVideoCollectorRun({
        limit,
        runType,
        trigger: trigger ?? 'http',
      });

      if (!jobId) {
        log.error('enqueue returned null jobId');
        return reply.code(500).send({
          success: false,
          error: 'failed to enqueue batch-video-collector run',
        });
      }

      log.info('batch-video-collector: enqueued', {
        jobId,
        limit: limit ?? null,
        runType: runType ?? null,
        trigger: trigger ?? 'http',
      });

      return reply.code(202).send({
        success: true,
        accepted: true,
        jobId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`batch-video-collector enqueue failed: ${msg}`);
      return reply.code(500).send({ success: false, error: msg });
    }
  });

  /**
   * GET /api/v1/internal/skills/batch-video-collector/missed-yesterday
   *   Headers: x-internal-token: <token>
   *   Query:   graceHours? (default 25)
   *   Response: {
   *     success: true,
   *     missed: boolean,
   *     graceHours: number,
   *     lastHealthyRun: { id, runType, startedAt, endedAt, status, videosNew } | null,
   *   }
   *
   * Used by the morning watchdog workflow to decide whether to re-trigger
   * yesterday's missed run. Returns `missed: true` when there is no
   * healthy (`success`/`partial`) run within the grace window, or no row
   * at all.
   */
  fastify.get<{
    Querystring: { graceHours?: string };
  }>('/batch-video-collector/missed-yesterday', async (request, reply) => {
    if (!verifyInternalToken(request, reply)) return reply;

    const parsed = Number(request.query?.graceHours);
    const graceHours =
      Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_WATCHDOG_GRACE_HOURS;

    try {
      const prisma = getPrismaClient();
      const lastHealthy = await prisma.video_pool_collection_runs.findFirst({
        where: { status: { in: [...HEALTHY_STATUSES] } },
        orderBy: { started_at: 'desc' },
        select: {
          id: true,
          run_type: true,
          started_at: true,
          ended_at: true,
          status: true,
          videos_new: true,
        },
      });

      const cutoff = Date.now() - graceHours * 3600 * 1000;
      const startedAtMs = lastHealthy?.started_at?.getTime() ?? 0;
      const missed = !lastHealthy || startedAtMs < cutoff;

      return reply.code(200).send({
        success: true,
        missed,
        graceHours,
        lastHealthyRun: lastHealthy
          ? {
              id: lastHealthy.id,
              runType: lastHealthy.run_type,
              startedAt: lastHealthy.started_at?.toISOString() ?? null,
              endedAt: lastHealthy.ended_at?.toISOString() ?? null,
              status: lastHealthy.status,
              videosNew: lastHealthy.videos_new,
            }
          : null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`missed-yesterday probe failed: ${msg}`);
      return reply.code(500).send({ success: false, error: msg });
    }
  });
};
