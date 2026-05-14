/**
 * GET /api/v1/billing/portal
 *
 * Returns the LS hosted customer portal URL for the current user's active
 * subscription. Frontend uses this to let users manage their card / cancel /
 * change plan inside LS UI (ADR-8).
 *
 * 404 when the user has no subscription. 503 when billing not configured.
 */

import { FastifyInstance } from 'fastify';
import { createSuccessResponse, createErrorResponse, ErrorCode } from '../../schemas/common.schema';
import {
  billingConfig,
  findActiveSubscriptionByUser,
  getCustomer,
  LemonSqueezyApiError,
} from '@/modules/billing';
import { logger } from '@/utils/logger';

export async function billingPortalRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/', { onRequest: [fastify.authenticate] }, async (request, reply) => {
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
        .send(createErrorResponse(ErrorCode.UNAUTHORIZED, 'missing userId', request.url));
    }
    const userId = request.user.userId;

    const sub = await findActiveSubscriptionByUser(userId);
    if (!sub || !sub.provider_customer_id) {
      return reply
        .code(404)
        .send(
          createErrorResponse(ErrorCode.RESOURCE_NOT_FOUND, 'no active subscription', request.url)
        );
    }

    try {
      const customer = await getCustomer(sub.provider_customer_id);
      const portalUrl = customer.data.attributes.urls?.customer_portal;
      if (!portalUrl) {
        return reply
          .code(502)
          .send(
            createErrorResponse(
              ErrorCode.EXTERNAL_API_ERROR,
              'LS did not return portal URL',
              request.url
            )
          );
      }
      return reply.send(createSuccessResponse({ portalUrl }));
    } catch (err) {
      if (err instanceof LemonSqueezyApiError) {
        logger.warn('billing.portal LS error', { status: err.status });
        return reply
          .code(502)
          .send(
            createErrorResponse(
              ErrorCode.EXTERNAL_API_ERROR,
              'LS portal lookup failed',
              request.url
            )
          );
      }
      throw err;
    }
  });
}
