/**
 * Admin trace export — full request/response timeline per mandala.
 *
 * Returns the contents of `video_discover_traces` for one mandala in
 * chronological order so an operator can manually verify the actual
 * pipeline behaviour: LLM prompts, YouTube search queries, Cohere rerank
 * input/output, embedding batches, etc.
 *
 * All routes guarded by fastify.authenticate + fastify.authenticateAdmin.
 */

import { FastifyPluginCallback } from 'fastify';
import { getPrismaClient } from '@/modules/database';
import {
  buildMandalaSearchJourney,
  type InteractionRow,
  type TraceRow,
} from '@/modules/discover-tracing/search-journey';

export const adminDiscoverTracesRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  const adminAuth = { onRequest: [fastify.authenticate, fastify.authenticateAdmin] };

  /**
   * GET /api/v1/admin/discover-traces/by-mandala/:mandalaId
   *
   * Returns: { mandalaId, count, traces: [...] } sorted by created_at ASC.
   */
  fastify.get<{ Params: { mandalaId: string } }>(
    '/by-mandala/:mandalaId',
    adminAuth,
    async (request, reply) => {
      const prisma = getPrismaClient();
      const rows = await prisma.video_discover_traces.findMany({
        where: { mandala_id: request.params.mandalaId },
        orderBy: { created_at: 'asc' },
        take: 5000,
      });
      return reply.send({
        mandalaId: request.params.mandalaId,
        count: rows.length,
        traces: rows.map((r) => ({
          id: r.id,
          run_id: r.run_id,
          user_id: r.user_id,
          step: r.step,
          status: r.status,
          request: r.request,
          response: r.response,
          error_message: r.error_message,
          latency_ms: r.latency_ms,
          created_at: r.created_at.toISOString(),
        })),
      });
    }
  );

  /**
   * GET /api/v1/admin/discover-traces/by-run/:runId — fetch one execution.
   */
  fastify.get<{ Params: { runId: string } }>(
    '/by-run/:runId',
    adminAuth,
    async (request, reply) => {
      const prisma = getPrismaClient();
      const rows = await prisma.video_discover_traces.findMany({
        where: { run_id: request.params.runId },
        orderBy: { created_at: 'asc' },
        take: 5000,
      });
      return reply.send({ runId: request.params.runId, count: rows.length, traces: rows });
    }
  );

  /**
   * GET /api/v1/admin/discover-traces/recent?user_id=...&limit=N
   * — most recent traces for a given user, regardless of mandala.
   */
  fastify.get<{ Querystring: { user_id?: string; limit?: string } }>(
    '/recent',
    adminAuth,
    async (request, reply) => {
      const userId = request.query.user_id;
      const limit = Math.min(Number(request.query.limit ?? '500') || 500, 5000);
      const prisma = getPrismaClient();
      const rows = await prisma.video_discover_traces.findMany({
        where: userId ? { user_id: userId } : {},
        orderBy: { created_at: 'desc' },
        take: limit,
      });
      return reply.send({ count: rows.length, traces: rows });
    }
  );

  /**
   * GET /api/v1/admin/discover-traces/journey/:mandalaId
   *
   * CP489 Phase 6 — Mandala Search Journey Ledger.
   * Aggregates per-round trace rows (`add_cards.end` returned_video_ids) with
   * card_interactions (like/archive/delete) into a chronological journey:
   * what was returned each round, which were reused from prior rounds, what
   * the user did after each round. Powers admin debugging + longitudinal
   * search-quality analysis (user-requested artifact, CP489).
   */
  fastify.get<{ Params: { mandalaId: string } }>(
    '/journey/:mandalaId',
    adminAuth,
    async (request, reply) => {
      const prisma = getPrismaClient();
      const mandalaId = request.params.mandalaId;

      const [traceRows, interactionRows] = await Promise.all([
        prisma.video_discover_traces.findMany({
          where: { mandala_id: mandalaId, step: 'add_cards.end', status: 'ok' },
          orderBy: { created_at: 'asc' },
          select: {
            id: true,
            run_id: true,
            step: true,
            status: true,
            created_at: true,
            response: true,
          },
          take: 5000,
        }),
        prisma.card_interactions.findMany({
          where: {
            mandala_id: mandalaId,
            signal: { in: ['like', 'archive', 'delete'] },
          },
          select: { video_id: true, signal: true, created_at: true },
          take: 50000,
        }),
      ]);

      const traces: TraceRow[] = traceRows.map((r) => ({
        id: r.id,
        run_id: r.run_id,
        step: r.step,
        status: r.status,
        created_at: r.created_at,
        response: r.response,
      }));

      const interactions: InteractionRow[] = interactionRows.map((r) => ({
        video_id: r.video_id,
        signal: r.signal,
        created_at: r.created_at,
      }));

      const journey = buildMandalaSearchJourney({
        mandalaId,
        traces,
        interactions,
      });

      return reply.send(journey);
    }
  );

  done();
};
