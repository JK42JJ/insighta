import { FastifyInstance } from 'fastify';
import { getJobQueue } from '@/modules/queue';

/**
 * Admin Enrichment Scheduler Routes
 *
 * Migrated from EnrichmentScheduler to pg-boss JobQueue (Phase 2).
 * Legacy start/stop endpoints removed — pg-boss manages lifecycle.
 */
export async function adminEnrichmentSchedulerRoutes(fastify: FastifyInstance) {
  const adminAuth = { onRequest: [fastify.authenticate, fastify.authenticateAdmin] };

  // GET /api/v1/admin/enrichment-scheduler/status
  fastify.get('/status', adminAuth, async () => {
    const queue = getJobQueue();
    const queueStatus = await queue.getStatus();

    return {
      status: 'ok',
      data: {
        engine: 'pg-boss',
        running: queueStatus.running,
        queues: queueStatus.queues,
      },
    };
  });
}
