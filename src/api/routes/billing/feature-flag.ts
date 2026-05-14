/**
 * GET /api/v1/billing/feature-flag (no auth)
 *
 * Public read of the `billing_enabled` flag so the marketing /pricing page
 * (no auth) and the in-app /subscription page can both gate their CTAs.
 *
 * Admin users always see CTAs enabled regardless of the flag — that check
 * lives FE-side because this endpoint is unauthenticated.
 */

import { FastifyInstance } from 'fastify';
import { createSuccessResponse } from '../../schemas/common.schema';
import { getSetting, SETTING_KEYS } from '@/modules/system-settings';

export async function billingFeatureFlagRoutes(fastify: FastifyInstance) {
  fastify.get('/', async (_request, reply) => {
    const enabled = await getSetting<boolean>(SETTING_KEYS.BILLING_ENABLED, false);
    return reply.send(createSuccessResponse({ enabled: !!enabled }));
  });
}
