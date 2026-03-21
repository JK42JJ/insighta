import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getPrismaClient } from '../../modules/database';

/**
 * Bot Usage Logger Plugin
 *
 * Logs all bot API requests to bot_usage_log table for Phase 0 usage pattern analysis.
 * Only logs requests from role: 'bot' users. Regular users are not tracked.
 *
 * Collected data enables #309 Phase 0 graduation criteria:
 * - Which commands are used most frequently
 * - Usage patterns over time (2+ weeks needed)
 * - Response quality feedback (future: user rating)
 */

export async function registerBotUsageLogger(fastify: FastifyInstance) {
  fastify.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    // Only log bot requests
    if (!request.user || request.user.role !== 'bot') return;

    const prisma = getPrismaClient();
    const command = extractCommand(request.method, request.url);

    try {
      await prisma.bot_usage_log.create({
        data: {
          user_id: request.user.userId,
          command,
          metadata: {
            method: request.method,
            url: request.url,
            status_code: reply.statusCode,
            response_time_ms: reply.elapsedTime ? Math.round(reply.elapsedTime) : null,
          },
        },
      });
    } catch {
      // Non-blocking — logging failure must not affect API response
      fastify.log.warn('Bot usage log write failed');
    }
  });

  fastify.log.info('Bot usage logger registered — tracking bot API requests');
}

/**
 * Extract a human-readable command name from HTTP method + URL
 */
function extractCommand(method: string, url: string): string {
  // Strip query params and /api/v1 prefix
  const path = url.split('?')[0]?.replace('/api/v1/', '') ?? url;

  // Map known patterns to command names
  if (path.includes('mood')) return 'mood';
  if (path.includes('weekly-report')) return 'report';
  if (path.includes('subscriptions')) return 'subscription';
  if (path.includes('snapshots') && method === 'POST') return 'snapshot_create';
  if (path.includes('rollback')) return 'snapshot_rollback';
  if (path.includes('mandalas')) return 'mandala_query';
  if (path.includes('local-cards')) return 'card_operation';

  return `${method.toLowerCase()}:${path}`;
}
