/**
 * Internal trigger for the pool-maintenance job (CP494, YouTube ToS hygiene).
 *
 * Protected by the shared `INTERNAL_BATCH_TOKEN` so the GitHub Actions cron can
 * invoke it without a user JWT. Fire-and-forget: enqueues a pg-boss job and
 * ACKs in milliseconds (the two UPDATEs run in the background worker).
 *
 * POST /api/v1/internal/pool-maintenance/run
 *   Headers: x-internal-token: <token>
 *   Body: { trigger?: string }
 *   Response (202): { success: true, accepted: true, jobId: string }
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { enqueuePoolMaintenanceRun } from '@/modules/queue';
import { getInternalBatchToken } from '@/config/internal-auth';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'api/internal/pool-maintenance' });

function verifyInternalToken(request: FastifyRequest, reply: FastifyReply): boolean {
  const expected = getInternalBatchToken();
  if (!expected) {
    log.warn('INTERNAL_BATCH_TOKEN not set — refusing to serve');
    void reply.code(503).send({ error: 'internal trigger not configured' });
    return false;
  }
  const got = request.headers['x-internal-token'];
  if (typeof got !== 'string' || got !== expected) {
    log.warn('internal route rejected: bad token');
    void reply.code(401).send({ error: 'invalid internal token' });
    return false;
  }
  return true;
}

export const internalPoolMaintenanceRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: { trigger?: string } }>('/pool-maintenance/run', async (request, reply) => {
    if (!verifyInternalToken(request, reply)) return reply;

    const trigger = request.body?.trigger ?? 'http';
    try {
      const jobId = await enqueuePoolMaintenanceRun({ trigger });
      if (!jobId) {
        log.error('enqueue returned null jobId');
        return reply.code(500).send({ success: false, error: 'failed to enqueue' });
      }
      log.info('pool-maintenance: enqueued', { jobId, trigger });
      return reply.code(202).send({ success: true, accepted: true, jobId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`pool-maintenance enqueue failed: ${msg}`);
      return reply.code(500).send({ success: false, error: msg });
    }
  });
};
