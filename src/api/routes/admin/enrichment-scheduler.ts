import { FastifyInstance } from 'fastify';
import { getEnrichmentScheduler } from '@/modules/enrichment/scheduler';

export async function adminEnrichmentSchedulerRoutes(fastify: FastifyInstance) {
  const adminAuth = { onRequest: [fastify.authenticate, fastify.authenticateAdmin] };

  // GET /api/v1/admin/enrichment-scheduler/status
  fastify.get('/status', adminAuth, async () => {
    return { status: 'ok', data: getEnrichmentScheduler().getStatus() };
  });

  // GET /api/v1/admin/enrichment-scheduler/history
  fastify.get<{ Querystring: { limit?: number } }>('/history', adminAuth, async (req) => {
    const limit = req.query.limit ?? 10;
    return { status: 'ok', data: getEnrichmentScheduler().getHistory(limit) };
  });

  // POST /api/v1/admin/enrichment-scheduler/start
  fastify.post('/start', adminAuth, async () => {
    await getEnrichmentScheduler().start();
    return { status: 'ok', message: 'EnrichmentScheduler started' };
  });

  // POST /api/v1/admin/enrichment-scheduler/stop
  fastify.post('/stop', adminAuth, async () => {
    await getEnrichmentScheduler().stop();
    return { status: 'ok', message: 'EnrichmentScheduler stopped' };
  });
}
