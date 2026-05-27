/**
 * Admin v2 Quality Audit routes (CP488+, 2026-05-27).
 *
 * Read-only endpoints surfacing the daily audit results to the admin
 * dashboard. All routes guarded by `fastify.authenticate +
 * fastify.authenticateAdmin` per the existing admin convention
 * (`src/api/routes/admin/quality-metrics.ts:44`).
 *
 * Phase 1 deliberately keeps the surface small:
 *   - GET /latest-run         → most recent audit run summary
 *   - GET /critical           → list of critical-score rows (paginated)
 *   - POST /run-now           → trigger a one-off audit pass (idempotent on the
 *                                unique (video_id, audit_date) constraint)
 *
 * Phase 2 (LLM analysis) and Phase 3 (regen worker) will extend this
 * module with `/llm-report`, `/regen-queue`, and `/regen-trigger`
 * endpoints.
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { db } from '@/modules/database/client';
import { createSuccessResponse } from '../../schemas/common.schema';
import { runV2AuditOnce } from '@/modules/scheduler/v2-quality-audit-cron';
import { regenSingleVideo, runRegenBatchOnce } from '@/modules/scheduler/v2-quality-regen-cron';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'AdminV2QualityAudit' });

const CriticalQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  scoreMax: z.coerce.number().int().min(0).max(100).default(70),
});

export async function adminV2QualityAuditRoutes(fastify: FastifyInstance) {
  const adminAuth = { onRequest: [fastify.authenticate, fastify.authenticateAdmin] };

  /**
   * GET /api/v1/admin/v2-quality-audit/latest-run
   * Latest run summary + classification counts + by-model + by-violation.
   */
  fastify.get('/latest-run', adminAuth, async (_request: FastifyRequest, reply: FastifyReply) => {
    const run = await db.v2_quality_audit_runs.findFirst({
      orderBy: { run_date: 'desc' },
    });
    return reply.send(createSuccessResponse({ run }));
  });

  /**
   * GET /api/v1/admin/v2-quality-audit/critical?scoreMax=70&page=1&limit=50
   * Lists the worst-scoring v2 rows from the latest run, paginated.
   * Joins title from youtube_videos so the admin can spot patterns at
   * a glance.
   */
  fastify.get('/critical', adminAuth, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = CriticalQuerySchema.parse(request.query ?? {});
    const offset = (query.page - 1) * query.limit;

    const latestRun = await db.v2_quality_audit_runs.findFirst({
      orderBy: { run_date: 'desc' },
      select: { id: true, run_date: true },
    });
    if (!latestRun) {
      return reply.send(
        createSuccessResponse({
          run_date: null,
          items: [],
          pagination: { page: 1, limit: query.limit, total: 0, totalPages: 0 },
        })
      );
    }

    const items = await db.$queryRawUnsafe<
      Array<{
        video_id: string;
        title: string | null;
        overall_score: number;
        model: string | null;
        duration_seconds: number | null;
        violations: unknown;
        created_at: Date;
      }>
    >(
      `SELECT aud.video_id, yv.title, aud.overall_score, aud.model,
              aud.duration_seconds, aud.violations, aud.created_at
         FROM v2_quality_audit_log aud
         LEFT JOIN youtube_videos yv ON yv.youtube_video_id = aud.video_id
        WHERE aud.audit_run_id = $1::uuid
          AND aud.overall_score <= $2
        ORDER BY aud.overall_score ASC, aud.created_at DESC
        LIMIT $3 OFFSET $4`,
      latestRun.id,
      query.scoreMax,
      query.limit,
      offset
    );

    const [totalRow] = await db.$queryRawUnsafe<Array<{ total: bigint }>>(
      `SELECT COUNT(*)::bigint AS total
         FROM v2_quality_audit_log
        WHERE audit_run_id = $1::uuid AND overall_score <= $2`,
      latestRun.id,
      query.scoreMax
    );
    const total = Number(totalRow?.total ?? 0);

    return reply.send(
      createSuccessResponse({
        run_date: latestRun.run_date,
        items,
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.ceil(total / query.limit),
          hasPrev: query.page > 1,
          hasNext: query.page * query.limit < total,
        },
      })
    );
  });

  /**
   * POST /api/v1/admin/v2-quality-audit/run-now
   * Triggers a single audit pass. Useful for dev/smoke verification and
   * for the operator to re-run after a regen wave. The cron-managed
   * `runInProgress` flag protects against overlapping execution.
   */
  fastify.post('/run-now', adminAuth, async (_request: FastifyRequest, reply: FastifyReply) => {
    log.info('admin manual audit run triggered');
    const summary = await runV2AuditOnce();
    if (!summary) {
      return reply.status(409).send({
        success: false,
        error: 'audit_in_progress',
        message: 'A previous audit run is still in progress.',
      });
    }
    return reply.send(createSuccessResponse({ summary }));
  });

  /**
   * POST /api/v1/admin/v2-quality-audit/regen-now
   * Phase 3 — triggers a single regen batch (claims up to batchSize
   * highest-priority pending queue rows + processes them serially).
   * Useful for kicking off the drain manually without waiting for the
   * next cron tick.
   */
  fastify.post('/regen-now', adminAuth, async (_request: FastifyRequest, reply: FastifyReply) => {
    log.info('admin manual regen batch triggered');
    const summary = await runRegenBatchOnce();
    if (!summary) {
      return reply.status(409).send({
        success: false,
        error: 'regen_in_progress',
        message: 'A previous regen batch is still in progress.',
      });
    }
    return reply.send(createSuccessResponse({ summary }));
  });

  /**
   * POST /api/v1/admin/v2-quality-audit/regen-trigger/:videoId
   * Phase 3 — regenerate a specific video on-demand. Does not touch
   * the queue (queueRowId=null); useful when the operator wants to
   * recover one user-visible bad row without waiting for the batch.
   */
  fastify.post<{ Params: { videoId: string } }>(
    '/regen-trigger/:videoId',
    adminAuth,
    async (request, reply) => {
      const { videoId } = request.params;
      if (!/^[\w-]{6,15}$/.test(videoId)) {
        return reply.status(400).send({
          success: false,
          error: 'invalid_video_id',
          message: 'videoId must match the YouTube id charset.',
        });
      }
      log.info('admin manual single-video regen triggered', { videoId });
      const result = await regenSingleVideo(videoId, null);
      return reply.send(createSuccessResponse({ result }));
    }
  );

  /**
   * GET /api/v1/admin/v2-quality-audit/regen-queue
   * Phase 3 — paginated view of the queue (pending + in-progress +
   * recent resolved/failed) so the operator can see what the worker
   * is actually doing.
   */
  fastify.get('/regen-queue', adminAuth, async (request, reply) => {
    const limit = Math.min(
      Math.max(
        parseInt(String((request.query as Record<string, string>)?.['limit'] ?? '50'), 10) || 50,
        1
      ),
      200
    );
    const items = await db.$queryRawUnsafe<
      Array<{
        id: string;
        video_id: string;
        title: string | null;
        priority: number;
        status: string;
        reason: string | null;
        enqueued_at: Date;
        attempted_at: Date | null;
        resolved_at: Date | null;
      }>
    >(
      `SELECT q.id, q.video_id, yv.title, q.priority, q.status, q.reason,
              q.enqueued_at, q.attempted_at, q.resolved_at
         FROM v2_quality_regen_queue q
         LEFT JOIN youtube_videos yv ON yv.youtube_video_id = q.video_id
        ORDER BY (CASE q.status WHEN 'in_progress' THEN 0
                                WHEN 'pending'     THEN 1
                                WHEN 'failed'      THEN 2
                                WHEN 'resolved'    THEN 3
                                ELSE 9 END) ASC,
                 q.priority ASC,
                 q.enqueued_at DESC
        LIMIT $1`,
      limit
    );
    const summary = await db.$queryRawUnsafe<Array<{ status: string; cnt: bigint }>>(
      `SELECT status, COUNT(*) AS cnt FROM v2_quality_regen_queue GROUP BY status`
    );
    const counts: Record<string, number> = {};
    for (const r of summary) counts[r.status] = Number(r.cnt);
    return reply.send(createSuccessResponse({ items, counts }));
  });
}
