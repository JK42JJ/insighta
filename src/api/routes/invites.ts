/**
 * Invite tickets v2 routes (2026-07-15) — shareable links, redeemed on signup.
 *
 * GET  /api/v1/invites          — my tickets (mints missing open slots)
 * POST /api/v1/invites/redeem   — redeem a code for the current (new) user
 *
 * Supersedes the v1 email-input mint. Links resolve through /s/:code
 * (invite branch in share-links.ts).
 */

import { FastifyInstance } from 'fastify';
import { listTickets, redeemInvite } from '@/modules/invites/manager';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'routes/invites' });

export async function inviteRoutes(fastify: FastifyInstance): Promise<void> {
  const auth = { onRequest: [fastify.authenticate] };

  fastify.get('/', auth, async (request, reply) => {
    const userId = (request.user as { userId?: string } | undefined)?.userId;
    if (!userId) return reply.code(401).send({ status: 'error', error: 'Unauthorized' });
    const data = await listTickets(userId);
    return reply.code(200).send({ status: 'ok', data });
  });

  fastify.post<{ Body: { code?: string } }>('/redeem', auth, async (request, reply) => {
    const userId = (request.user as { userId?: string } | undefined)?.userId;
    if (!userId) return reply.code(401).send({ status: 'error', error: 'Unauthorized' });

    const code = (request.body?.code ?? '').trim();
    if (!code) return reply.code(400).send({ status: 'error', code: 'INVALID_CODE' });

    const result = await redeemInvite(code, userId);
    // 'self'/'already'/'used'/'invalid' are all non-fatal — the client just
    // proceeds; only a genuine redeem records the relationship.
    if (result === 'redeemed') {
      log.info('invite redeemed', { code, inviteeId: userId });
    }
    return reply.code(200).send({ status: 'ok', data: { result } });
  });
}
