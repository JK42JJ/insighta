import { FastifyInstance } from 'fastify';
import { registerAdminAuth } from '../../plugins/admin-auth';
import { adminCheckRoute } from './check';
import { adminUserRoutes } from './users';
import { adminStatsRoutes } from './stats';
import { adminPromotionRoutes } from './promotions';
import { adminAuditRoutes } from './audit';
import { adminRedemptionRoutes, adminBulkRoutes } from './redemption';
import { adminPaymentRoutes, stripeWebhookRoutes } from './payments';
import { adminAnalyticsRoutes } from './analytics';
import { adminContentRoutes } from './content';
import { adminReportRoutes } from './reports';
import { adminHealthRoutes } from './health';
import { adminLlmRoutes } from './llm';
import { adminEnrichmentRoutes } from './enrichment';
import { adminClawbotRoutes } from './clawbot';
import { adminEnrichmentSchedulerRoutes } from './enrichment-scheduler';
import { adminChatbotRoutes } from './chatbot';
import { adminQualityMetricsRoutes } from './quality-metrics';

/**
 * Admin routes plugin.
 * All routes under /api/v1/admin/* require is_super_admin.
 */
export async function adminRoutes(fastify: FastifyInstance) {
  // Register admin auth decorator (must happen before routes use it)
  await registerAdminAuth(fastify);

  // Register sub-routes
  await fastify.register(adminCheckRoute, { prefix: '/check' });
  await fastify.register(adminUserRoutes, { prefix: '/users' });
  await fastify.register(adminStatsRoutes, { prefix: '/stats' });
  await fastify.register(adminPromotionRoutes, { prefix: '/promotions' });
  await fastify.register(adminRedemptionRoutes, { prefix: '/promotions' });
  await fastify.register(adminBulkRoutes, { prefix: '/users/bulk' });
  await fastify.register(adminAuditRoutes, { prefix: '/audit-log' });
  await fastify.register(adminAnalyticsRoutes, { prefix: '/analytics' });
  await fastify.register(adminContentRoutes, { prefix: '/content' });
  await fastify.register(adminReportRoutes, { prefix: '/reports' });
  await fastify.register(adminPaymentRoutes, { prefix: '/payments' });
  await fastify.register(adminHealthRoutes, { prefix: '/health' });
  await fastify.register(adminLlmRoutes, { prefix: '/llm' });
  await fastify.register(adminEnrichmentRoutes, { prefix: '/enrichment' });
  await fastify.register(adminClawbotRoutes, { prefix: '/clawbot' });
  await fastify.register(adminEnrichmentSchedulerRoutes, { prefix: '/enrichment-scheduler' });
  await fastify.register(adminChatbotRoutes, { prefix: '/chatbot' });
  await fastify.register(adminQualityMetricsRoutes, { prefix: '/quality-metrics' });
  await fastify.register(stripeWebhookRoutes, { prefix: '/webhooks/stripe' });
}
