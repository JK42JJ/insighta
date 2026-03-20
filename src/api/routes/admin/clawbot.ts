import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createSuccessResponse } from '../../schemas/common.schema';
import { getClawbot } from '../../../modules/scheduler/clawbot';

// ============================================================================
// Schemas
// ============================================================================

const ConfigUpdateSchema = z.object({
  cronExpression: z.string().optional(),
  threshold: z.number().int().min(1).max(100).optional(),
  batchLimit: z.number().int().min(1).max(500).optional(),
  delayMs: z.number().int().min(500).max(30000).optional(),
  autoStart: z.boolean().optional(),
});

const HistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// ============================================================================
// Routes
// ============================================================================

export async function adminClawbotRoutes(fastify: FastifyInstance) {
  const adminAuth = { onRequest: [fastify.authenticate, fastify.authenticateAdmin] };

  // GET /api/v1/admin/clawbot/status
  fastify.get('/status', adminAuth, async (_request: FastifyRequest, reply: FastifyReply) => {
    const status = getClawbot().getStatus();
    return reply.send(createSuccessResponse(status));
  });

  // POST /api/v1/admin/clawbot/trigger
  fastify.post('/trigger', adminAuth, async (_request: FastifyRequest, reply: FastifyReply) => {
    const clawbot = getClawbot();
    const status = clawbot.getStatus();

    if (status.running) {
      return reply.code(409).send({
        success: false,
        error: 'A run is already in progress',
        data: { currentRun: status.currentRun },
      });
    }

    // Fire and forget — return 202 immediately
    void clawbot.trigger();

    return reply.code(202).send(createSuccessResponse({ message: 'Clawbot run triggered' }));
  });

  // PUT /api/v1/admin/clawbot/config
  fastify.put('/config', adminAuth, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = ConfigUpdateSchema.parse(request.body);
    const config = getClawbot().updateConfig(body);
    return reply.send(createSuccessResponse({ config }));
  });

  // POST /api/v1/admin/clawbot/start
  fastify.post('/start', adminAuth, async (_request: FastifyRequest, reply: FastifyReply) => {
    await getClawbot().start();
    return reply.send(createSuccessResponse({ message: 'Clawbot started' }));
  });

  // POST /api/v1/admin/clawbot/stop
  fastify.post('/stop', adminAuth, async (_request: FastifyRequest, reply: FastifyReply) => {
    await getClawbot().stop();
    return reply.send(createSuccessResponse({ message: 'Clawbot stopped' }));
  });

  // GET /api/v1/admin/clawbot/history
  fastify.get('/history', adminAuth, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = HistoryQuerySchema.parse(request.query);
    const history = getClawbot().getRunHistory(query.limit);
    return reply.send(createSuccessResponse({ runs: history, total: history.length }));
  });
}
