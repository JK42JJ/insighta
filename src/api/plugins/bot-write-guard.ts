import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getPrismaClient } from '../../modules/database';
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
  '/api/v1/bot/request-approval', // Bot must be able to request approval
  '/api/v1/snapshots', // Snapshot creation is part of the safety flow
]);

const APPROVAL_TOKEN_TTL_MINUTES = 5;

export async function registerBotWriteGuard(fastify: FastifyInstance) {
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // Only apply to write methods
    if (!WRITE_METHODS.has(request.method)) return;

    // Only apply to bot users
    if (!request.user || request.user.role !== 'bot') return;

    // Allow exempt routes
    if (BOT_WRITE_EXEMPT_ROUTES.has(request.url.split('?')[0] ?? '')) return;

    // Check for approval token header
    const tokenValue = request.headers['x-bot-approval-token'];
    if (!tokenValue || typeof tokenValue !== 'string') {
      return reply
        .code(403)
        .send(
          createErrorResponse(
            ErrorCode.FORBIDDEN,
            'Bot write operations require approval. Use POST /api/v1/bot/request-approval first.',
            request.url,
            { hint: 'Include x-bot-approval-token header after user approves the action' }
          )
        );
    }

    // Validate token against DB
    const prisma = getPrismaClient();
    const approval = await prisma.bot_approval_tokens.findFirst({
      where: {
        token: tokenValue,
        user_id: request.user.userId,
        status: 'approved',
        expires_at: { gte: new Date() },
      },
    });

    if (!approval) {
      return reply
        .code(403)
        .send(
          createErrorResponse(
            ErrorCode.FORBIDDEN,
            'Invalid or expired approval token.',
            request.url
          )
        );
    }

    // Mark token as used (one-time use)
    await prisma.bot_approval_tokens.update({
      where: { id: approval.id },
      data: { status: 'used' },
    });
  });

  fastify.log.info('Bot write guard registered — bot write operations require approval token');
}

/**
 * Generate a cryptographically random approval token
 */
export function generateApprovalToken(): string {
  return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
}

/**
 * Get token expiry timestamp
 */
export function getTokenExpiry(): Date {
  return new Date(Date.now() + APPROVAL_TOKEN_TTL_MINUTES * 60 * 1000);
}
