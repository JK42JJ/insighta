/**
 * GET /api/v1/billing/subscriptions/me
 *
 * Returns current user's billing state. Combines billing_subscriptions
 * (latest active row) + user_subscriptions.tier so the FE can render
 * plan, status, period_end, and whether portal entry is available.
 *
 * Returns 200 with `subscription: null` when the user has no active row —
 * lets the FE distinguish "no plan yet" from a hard error.
 */

import { FastifyInstance } from 'fastify';
import { db } from '@/modules/database/client';
import { createSuccessResponse, createErrorResponse, ErrorCode } from '../../schemas/common.schema';
import { findActiveSubscriptionByUser } from '@/modules/billing';

export async function billingSubscriptionRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/me', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!request.user || !('userId' in request.user)) {
      return reply
        .code(401)
        .send(createErrorResponse(ErrorCode.UNAUTHORIZED, 'missing userId', request.url));
    }
    const userId = request.user.userId;

    const [sub, userTier] = await Promise.all([
      findActiveSubscriptionByUser(userId),
      db.user_subscriptions.findUnique({ where: { user_id: userId } }),
    ]);

    return reply.send(
      createSuccessResponse({
        tier: userTier?.tier ?? 'free',
        subscription: sub
          ? {
              id: sub.id,
              planCode: sub.plan_code,
              status: sub.status,
              currentPeriodStart: sub.current_period_start,
              currentPeriodEnd: sub.current_period_end,
              cancelAtPeriodEnd: sub.cancel_at_period_end,
              amountCents: sub.amount_cents,
              currency: sub.currency,
            }
          : null,
      })
    );
  });
}
