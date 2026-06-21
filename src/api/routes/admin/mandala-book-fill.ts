/**
 * Admin Mandala Book Fill route (§2-D #1).
 *
 * Manual entrypoint to (re)generate one mandala's book_json from its placed
 * videos' v2 summaries. Mirrors relevance-backfill: admin-guarded, single
 * mandala, enqueues a durable pg-boss job (the '...' menu / async '준비중' UX
 * button is wired separately in §2-D — this is the enqueue contract).
 *
 *   POST /api/v1/admin/mandala-book-fill/run   body { userId, mandalaId }
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { createSuccessResponse } from '../../schemas/common.schema';
import { enqueueMandalaBookFill } from '@/modules/queue/handlers/mandala-book-fill';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'AdminMandalaBookFill' });

const RunBodySchema = z.object({
  userId: z.string().uuid(),
  mandalaId: z.string().uuid(),
});

export async function adminMandalaBookFillRoutes(fastify: FastifyInstance) {
  const adminAuth = { onRequest: [fastify.authenticate, fastify.authenticateAdmin] };

  /**
   * POST /api/v1/admin/mandala-book-fill/run
   * Enqueue a book-fill job for the target mandala. Returns the job id.
   */
  fastify.post('/run', adminAuth, async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId, mandalaId } = RunBodySchema.parse(request.body ?? {});

    const jobId = await enqueueMandalaBookFill({ userId, mandalaId, trigger: 'admin' });

    log.info('admin mandala book fill enqueued', { userId, mandalaId, jobId });
    return reply.send(createSuccessResponse({ enqueued: jobId != null, jobId }));
  });
}
