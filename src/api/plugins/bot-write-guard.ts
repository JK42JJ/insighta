import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createErrorResponse, ErrorCode } from '../schemas/common.schema';

/**
 * Bot Write Guard Plugin
 *
 * Blocks bot users from write operations (POST/PUT/PATCH/DELETE) unless
 * a valid approval token is provided via x-bot-approval-token header.
 *
 * Regular users are unaffected — this guard only restricts role: 'bot'.
 *
 * Incident context (2026-03-21): Clawbot directly modified DB via psql,
 * corrupting 174 cards. This structural guard ensures bot write operations
 * go through the approval flow even if agent prompt rules are ignored.
 */

/** HTTP methods considered as write operations */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Routes exempt from bot write guard (bot needs these to function) */
const BOT_WRITE_EXEMPT_ROUTES = new Set([
  '/api/v1/bot/request-approval',  // Bot must be able to request approval
]);

export async function registerBotWriteGuard(fastify: FastifyInstance) {
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // Only apply to write methods
    if (!WRITE_METHODS.has(request.method)) return;

    // Only apply to bot users
    if (!request.user || request.user.role !== 'bot') return;

    // Allow exempt routes
    if (BOT_WRITE_EXEMPT_ROUTES.has(request.url.split('?')[0] ?? '')) return;

    // Check for approval token
    const approvalToken = request.headers['x-bot-approval-token'];
    if (!approvalToken) {
      return reply.code(403).send(
        createErrorResponse(
          ErrorCode.FORBIDDEN,
          'Bot write operations require approval. Use POST /api/v1/bot/request-approval first.',
          request.url,
          { hint: 'Include x-bot-approval-token header after user approves the action' }
        )
      );
    }

    // TODO (P2): Validate approval token against bot_approval_tokens table
    // For now, any non-empty token passes — P2 will add proper validation
  });

  fastify.log.info('Bot write guard registered — bot write operations require approval token');
}
