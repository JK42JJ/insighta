import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { systemBatchEnrich } from '../../../modules/ontology/enrichment';
import { createSuccessResponse } from '../../schemas/common.schema';

const BatchAllBodySchema = z.object({
  limit: z.number().int().min(1).max(500).default(100),
  delay_ms: z.number().int().min(0).max(10000).default(2000),
});

export async function adminEnrichmentRoutes(fastify: FastifyInstance) {
  const adminAuth = { onRequest: [fastify.authenticate, fastify.authenticateAdmin] };

  // POST /api/v1/admin/enrichment/batch-all — enrich all unsummarized YouTube videos
  fastify.post('/batch-all', adminAuth, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = BatchAllBodySchema.parse(request.body);
    const result = await systemBatchEnrich({
      limit: body.limit,
      delayMs: body.delay_ms,
    });
    return reply.send(createSuccessResponse(result));
  });
}
