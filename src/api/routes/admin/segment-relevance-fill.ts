/**
 * Admin Segment-Relevance Fill route (§2-D #2).
 *
 * Manual entrypoint to score one mandala's rich-summary time-segments against
 * its centerGoal and populate video_mandala_segment_relevance (the slidegen
 * relevance-gate input). Mirrors relevance-backfill: admin-guarded, single
 * mandala, fans out durable pg-boss jobs.
 *
 *   POST /api/v1/admin/segment-relevance-fill/run   body { userId, mandalaId }
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { createSuccessResponse } from '../../schemas/common.schema';
import { enqueueSegmentRelevanceForMandala } from '@/modules/relevance/segment-relevance-trigger';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'AdminSegmentRelevanceFill' });

const RunBodySchema = z.object({
  userId: z.string().uuid(),
  mandalaId: z.string().uuid(),
});

export async function adminSegmentRelevanceFillRoutes(fastify: FastifyInstance): Promise<void> {
  const adminAuth = { onRequest: [fastify.authenticate, fastify.authenticateAdmin] };

  /**
   * POST /api/v1/admin/segment-relevance-fill/run
   * Fan out segment-relevance jobs for every placed video's v2 segments in the
   * target mandala (stale rows cleared first). Returns enqueue/segment counts.
   */
  fastify.post('/run', adminAuth, async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId, mandalaId } = RunBodySchema.parse(request.body ?? {});

    const result = await enqueueSegmentRelevanceForMandala({ userId, mandalaId });

    log.info('admin segment relevance fill run', { userId, mandalaId, ...result });
    return reply.send(createSuccessResponse(result));
  });
}
