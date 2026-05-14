/**
 * POST /api/v1/billing/checkout
 *
 * Body: { planCode?: 'pro_monthly' }   (defaults to pro_monthly — MVP single plan)
 * Auth: fastify.authenticate (JWT).
 *
 * Issues a Lemon Squeezy hosted checkout URL with custom_data.user_id pinned
 * so the webhook can attribute back. FE redirects via window.location.href.
 *
 * Returns 503 when LS env config is missing (graceful disable per §7.1 rollback).
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '@/modules/database/client';
import { createSuccessResponse, createErrorResponse, ErrorCode } from '../../schemas/common.schema';
import {
  billingConfig,
  createCheckout,
  findActiveSubscriptionByEmail,
  findPlanByCode,
  LemonSqueezyApiError,
} from '@/modules/billing';
import { getSetting, SETTING_KEYS } from '@/modules/system-settings';
import { logger } from '@/utils/logger';

const BodySchema = z.object({
  planCode: z.enum(['pro_monthly', 'pro_yearly', 'pro_lifetime']).optional().default('pro_monthly'),
  successUrl: z.string().url().optional(),
  /** When true, LS overlay renders dark. Caller (FE) detects from user's theme. */
  dark: z.boolean().optional(),
  /** ISO 2-letter locale (e.g., 'ko', 'en') for LS hosted checkout localization. */
  locale: z.string().min(2).max(8).optional(),
});

export async function billingCheckoutRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!billingConfig.enabled) {
      return reply
        .code(503)
        .send(
          createErrorResponse(
            ErrorCode.SERVICE_UNAVAILABLE,
            'billing is not configured',
            request.url
          )
        );
    }
    if (!request.user || !('userId' in request.user)) {
      return reply
        .code(401)
        .send(createErrorResponse(ErrorCode.UNAUTHORIZED, 'missing userId in token', request.url));
    }
    const userId = request.user.userId;

    const parsed = BodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply
        .code(400)
        .send(createErrorResponse(ErrorCode.VALIDATION_ERROR, parsed.error.message, request.url));
    }

    const plan = findPlanByCode(parsed.data.planCode);
    if (!plan) {
      return reply
        .code(404)
        .send(
          createErrorResponse(
            ErrorCode.RESOURCE_NOT_FOUND,
            `unknown planCode ${parsed.data.planCode}`,
            request.url
          )
        );
    }

    // Look up user email. CP456 Phase 5: admin no longer bypasses the
    // billing_enabled flag — admins must flip the flag ON from /admin/billing
    // before they (or anyone else) can check out. Strict gate per user choice.
    const user = await db.users.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user?.email) {
      return reply
        .code(409)
        .send(
          createErrorResponse(
            ErrorCode.CONFLICT,
            'user has no email — cannot checkout',
            request.url
          )
        );
    }

    // CP456 Phase 5 (strict gate): flag=false → 403 for everyone, admins
    // included. Admins must flip the flag from /admin/billing first.
    const billingEnabled = await getSetting<boolean>(SETTING_KEYS.BILLING_ENABLED, false);
    if (!billingEnabled) {
      logger.info('billing.checkout blocked: feature flag off', { user_id: userId });
      return reply.code(403).send({
        error: {
          code: 'BILLING_DISABLED',
          message: 'Billing is not yet enabled',
          timestamp: new Date().toISOString(),
          path: request.url,
        },
      });
    }

    try {
      // Preflight: short-circuit when the user already has an active LS
      // subscription. webhook may not have landed locally, so LS is the
      // source of truth here. We surface `code=ALREADY_SUBSCRIBED` and the
      // portal URL so the FE can redirect the user to manage their existing
      // subscription instead of opening a second checkout (which LS will
      // also block server-side, producing the "stuck loader" symptom).
      const activeSub = await findActiveSubscriptionByEmail(user.email);
      if (activeSub) {
        logger.info('billing.checkout preflight blocked: already subscribed', {
          user_id: userId,
          ls_subscription_id: activeSub.subscriptionId,
          status: activeSub.status,
        });
        return reply.code(409).send({
          error: {
            code: 'ALREADY_SUBSCRIBED',
            message: 'user already has an active subscription',
            details: {
              subscriptionId: activeSub.subscriptionId,
              portalUrl: activeSub.customerPortalUrl,
            },
            timestamp: new Date().toISOString(),
            path: request.url,
          },
        });
      }

      const ls = await createCheckout({
        variantId: plan.variantId,
        email: user.email,
        userId,
        ...(parsed.data.successUrl ? { successUrl: parsed.data.successUrl } : {}),
        ...(typeof parsed.data.dark === 'boolean' ? { dark: parsed.data.dark } : {}),
        ...(parsed.data.locale ? { locale: parsed.data.locale } : {}),
      });
      return reply.send(
        createSuccessResponse({
          checkoutUrl: ls.data.attributes.url,
          expiresAt: ls.data.attributes.expires_at,
          planCode: plan.planCode,
        })
      );
    } catch (err) {
      if (err instanceof LemonSqueezyApiError) {
        logger.warn('billing.checkout LS error', { status: err.status });
        return reply
          .code(502)
          .send(
            createErrorResponse(ErrorCode.EXTERNAL_API_ERROR, 'LS checkout failed', request.url)
          );
      }
      throw err;
    }
  });
}
