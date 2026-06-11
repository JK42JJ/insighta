/**
 * Admin pool-serve trigger — CP499+ canary measurement entry.
 *
 * POST /api/v1/admin/pool-serve/run   body { userId, mandalaId }
 *   Detects deficit cells (placed < V5_POOL_SERVE_MIN_PER_CELL) and enqueues
 *   one fill job per cell, BYPASSING the V5_POOL_SERVE flag — the canary
 *   measures on one mandala while the fleet flag stays off.
 *
 * GET /api/v1/admin/pool-serve/runs/:runId
 *   Returns the skill_runs row (per-cell outcomes: pool/live recruited,
 *   scored, passed, inserted) — the canary 충당률 numbers come from here.
 *
 * Guarded by `fastify.authenticate + fastify.authenticateAdmin` per the admin
 * route convention (mirrors admin/relevance-backfill.ts).
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { dispatchPoolServeForMandala } from '@/modules/queue/handlers/pool-serve-fill';
import { getPrismaClient } from '@/modules/database/client';
import { createSuccessResponse } from '../../schemas/common.schema';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'admin/pool-serve' });

const RunBodySchema = z.object({
  userId: z.string().uuid(),
  mandalaId: z.string().uuid(),
});

const RunParamsSchema = z.object({
  runId: z.string().uuid(),
});

export async function adminPoolServeRoutes(fastify: FastifyInstance) {
  const adminAuth = { onRequest: [fastify.authenticate, fastify.authenticateAdmin] };

  fastify.post('/run', adminAuth, async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId, mandalaId } = RunBodySchema.parse(request.body ?? {});

    const result = await dispatchPoolServeForMandala(userId, mandalaId, { bypassFlag: true });

    log.info('admin pool-serve run', { userId, mandalaId, ...result });
    return reply.send(createSuccessResponse(result));
  });

  fastify.get('/runs/:runId', adminAuth, async (request: FastifyRequest, reply: FastifyReply) => {
    const { runId } = RunParamsSchema.parse(request.params ?? {});
    const run = await getPrismaClient().skill_runs.findUnique({ where: { id: runId } });
    return reply.send(createSuccessResponse(run));
  });
}
