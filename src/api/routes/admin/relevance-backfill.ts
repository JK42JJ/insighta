/**
 * Admin Relevance Backfill route — CP498 PR3b (A-stage).
 *
 * Manual entrypoint to score a single mandala's unscored placed cards. This is
 * the controlled 1-mandala measurement surface: it deliberately bypasses both
 * the BACKFILL_RELEVANCE_ENABLED flag and the created_at cutoff, so the backfill
 * can be measured on one mandala while the auto path stays off in prod.
 *
 * Guarded by `fastify.authenticate + fastify.authenticateAdmin` per the admin
 * convention (see v2-quality-audit.ts:38).
 *
 *   POST /api/v1/admin/relevance-backfill/run   body { userId, mandalaId }
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { createSuccessResponse } from '../../schemas/common.schema';
import { enqueueRelevanceBackfillForMandala } from '@/modules/relevance/relevance-backfill-trigger';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'AdminRelevanceBackfill' });

const RunBodySchema = z.object({
  userId: z.string().uuid(),
  mandalaId: z.string().uuid(),
});

export async function adminRelevanceBackfillRoutes(fastify: FastifyInstance) {
  const adminAuth = { onRequest: [fastify.authenticate, fastify.authenticateAdmin] };

  /**
   * POST /api/v1/admin/relevance-backfill/run
   * Fan out relevance-quick jobs for every unscored placed card in the target
   * mandala (cutoff ignored, flag bypassed). Returns enqueue/skip counts.
   */
  fastify.post('/run', adminAuth, async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId, mandalaId } = RunBodySchema.parse(request.body ?? {});

    const result = await enqueueRelevanceBackfillForMandala({
      userId,
      mandalaId,
      applyCutoff: false,
    });

    log.info('admin relevance backfill run', { userId, mandalaId, ...result });
    return reply.send(createSuccessResponse(result));
  });
}
