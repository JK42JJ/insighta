import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../../../modules/database/client';
import { createErrorResponse, createSuccessResponse, ErrorCode } from '../../schemas/common.schema';
import { TIER_LIMITS } from '@/config/quota';

const RedeemCodeSchema = z.object({
  code: z.string().min(1),
});

const BulkUpdateSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(100),
  changes: z.object({
    tier: z.enum(['free', 'pro', 'lifetime', 'admin']).optional(),
    localCardsLimit: z.number().int().min(0).optional(),
    mandalaLimit: z.number().int().min(0).optional(),
  }),
});

export async function adminRedemptionRoutes(fastify: FastifyInstance) {
  // Public-facing: redeem a promotion code (requires normal auth, not admin)
  fastify.post(
    '/redeem',
    { onRequest: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { code } = RedeemCodeSchema.parse(request.body);
      const userId = request.user.userId;

      // Find active promotion
      const promos = await db.$queryRaw<Array<Record<string, unknown>>>`
        SELECT * FROM public.admin_promotions
        WHERE code = ${code} AND is_active = true
          AND (starts_at IS NULL OR starts_at <= NOW())
          AND (ends_at IS NULL OR ends_at > NOW())
      `;

      if (promos.length === 0) {
        return reply.code(404).send(
          createErrorResponse(ErrorCode.RESOURCE_NOT_FOUND, 'Invalid or expired promotion code', request.url)
        );
      }

      const promo = promos[0]!;

      // Check max redemptions
      if (promo['max_redemptions'] != null && (promo['current_redemptions'] as number) >= (promo['max_redemptions'] as number)) {
        return reply.code(400).send(
          createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Promotion has reached maximum redemptions', request.url)
        );
      }

      // Check if user already redeemed
      const existing = await db.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM public.user_promotion_redemptions
        WHERE user_id = ${userId}::uuid AND promotion_id = ${promo['id'] as string}::uuid
      `;
      if (existing.length > 0) {
        return reply.code(400).send(
          createErrorResponse(ErrorCode.VALIDATION_ERROR, 'You have already redeemed this promotion', request.url)
        );
      }

      const promoValue = promo['value'] as Record<string, unknown>;
      const appliedChanges: Record<string, unknown> = {};

      // Apply benefits based on type
      const promoType = promo['type'] as string;
      if (promoType === 'tier_upgrade' && promoValue['tier']) {
        await db.$queryRawUnsafe(
          `INSERT INTO public.user_subscriptions (user_id, tier)
           VALUES ($1::uuid, $2)
           ON CONFLICT (user_id) DO UPDATE SET tier = $2, updated_at = NOW()`,
          userId, promoValue['tier']
        );
        appliedChanges['tier'] = promoValue['tier'];
      } else if (promoType === 'limit_increase') {
        const limitIncrease = (promoValue['localCardsLimit'] as number) ?? 0;
        const mandalaIncrease = (promoValue['mandalaLimit'] as number) ?? 0;
        if (limitIncrease > 0 || mandalaIncrease > 0) {
          await db.$queryRawUnsafe(
            `INSERT INTO public.user_subscriptions (user_id, local_cards_limit, mandala_limit)
             VALUES ($1::uuid, $2, $3)
             ON CONFLICT (user_id) DO UPDATE SET
               local_cards_limit = COALESCE(user_subscriptions.local_cards_limit, ${TIER_LIMITS.free.cards}) + $2,
               mandala_limit = COALESCE(user_subscriptions.mandala_limit, ${TIER_LIMITS.free.mandalas}) + $3,
               updated_at = NOW()`,
            userId, limitIncrease, mandalaIncrease
          );
          appliedChanges['localCardsLimit'] = `+${limitIncrease}`;
          appliedChanges['mandalaLimit'] = `+${mandalaIncrease}`;
        }
      }

      // Record redemption + increment counter
      await db.$queryRaw`
        INSERT INTO public.user_promotion_redemptions (user_id, promotion_id, applied_changes)
        VALUES (${userId}::uuid, ${promo['id'] as string}::uuid, ${JSON.stringify(appliedChanges)}::jsonb)
      `;
      await db.$queryRaw`
        UPDATE public.admin_promotions
        SET current_redemptions = current_redemptions + 1
        WHERE id = ${promo['id'] as string}::uuid
      `;

      return reply.send(createSuccessResponse({ redeemed: true, applied: appliedChanges }));
    }
  );
}

export async function adminBulkRoutes(fastify: FastifyInstance) {
  const adminAuth = { onRequest: [fastify.authenticate, fastify.authenticateAdmin] };

  // POST /api/v1/admin/users/bulk — Batch tier/limit changes
  fastify.post('/', adminAuth, async (request: FastifyRequest, reply: FastifyReply) => {
    const { userIds, changes } = BulkUpdateSchema.parse(request.body);
    const adminId = request.user.userId;

    const setClauses: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (changes.tier !== undefined) { setClauses.push(`tier = $${idx}`); params.push(changes.tier); idx++; }
    if (changes.localCardsLimit !== undefined) { setClauses.push(`local_cards_limit = $${idx}`); params.push(changes.localCardsLimit); idx++; }
    if (changes.mandalaLimit !== undefined) { setClauses.push(`mandala_limit = $${idx}`); params.push(changes.mandalaLimit); idx++; }

    if (setClauses.length === 0) {
      return reply.code(400).send(
        createErrorResponse(ErrorCode.VALIDATION_ERROR, 'No changes specified', request.url)
      );
    }

    let successCount = 0;
    for (const userId of userIds) {
      const columns = setClauses.map(c => c.split(' = ')[0]!);
      const valuePlaceholders = Array.from({ length: params.length }, (_, i) => `$${i + 2}`);

      await db.$queryRawUnsafe(
        `INSERT INTO public.user_subscriptions (user_id, ${columns.join(', ')})
         VALUES ($1, ${valuePlaceholders.join(', ')})
         ON CONFLICT (user_id) DO UPDATE SET ${setClauses.join(', ')}, updated_at = NOW()`,
        userId,
        ...params
      );
      successCount++;
    }

    // Audit log
    await db.$queryRawUnsafe(
      `INSERT INTO public.admin_audit_log (admin_id, action, target_type, new_value)
       VALUES ($1::uuid, 'bulk_user_update', 'user', $2::jsonb)`,
      adminId, JSON.stringify({ userIds, changes, successCount })
    );

    return reply.send(createSuccessResponse({ updated: successCount, total: userIds.length }));
  });
}
