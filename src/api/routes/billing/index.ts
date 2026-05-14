/**
 * Billing routes plugin — mounts under `/api/v1/billing`.
 *
 * Order matters: webhook route needs a raw-body content parser registered
 * BEFORE the route declaration, so we register the parser inside the plugin
 * (Fastify encapsulation — does not leak to other routes).
 */

import { FastifyInstance } from 'fastify';
import { billingCheckoutRoutes } from './checkout';
import { billingWebhookRoutes } from './webhook';
import { billingPortalRoutes } from './portal';
import { billingSubscriptionRoutes } from './subscriptions';
import { billingFeatureFlagRoutes } from './feature-flag';

export async function billingRoutes(fastify: FastifyInstance): Promise<void> {
  await fastify.register(billingCheckoutRoutes, { prefix: '/checkout' });
  await fastify.register(billingWebhookRoutes, { prefix: '/webhook' });
  await fastify.register(billingPortalRoutes, { prefix: '/portal' });
  await fastify.register(billingSubscriptionRoutes, { prefix: '/subscriptions' });
  await fastify.register(billingFeatureFlagRoutes, { prefix: '/feature-flag' });
}
