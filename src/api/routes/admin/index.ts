import { FastifyInstance } from 'fastify';
import { registerAdminAuth } from '../../plugins/admin-auth';
import { adminCheckRoute } from './check';
import { adminUserRoutes } from './users';
import { adminStatsRoutes } from './stats';
import { adminPromotionRoutes } from './promotions';
import { adminAuditRoutes } from './audit';
import { adminRedemptionRoutes, adminBulkRoutes } from './redemption';
// Stripe scaffold moved to payments.legacy.ts on 2026-05-13 (superseded by
// Lemon Squeezy under /api/v1/billing/*). See payments.legacy.ts header.
// import { adminPaymentRoutes, stripeWebhookRoutes } from './payments';
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
import { adminSystemSettingsRoutes } from './system-settings';
import { adminDiscoverTracesRoutes } from './discover-traces';
import { adminSearchAlgorithmsRoutes } from './search-algorithms';
import { adminV2QualityAuditRoutes } from './v2-quality-audit';

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
  // Stripe scaffold de-registered 2026-05-13 (see payments.legacy.ts).
  // await fastify.register(adminPaymentRoutes, { prefix: '/payments' });
  await fastify.register(adminHealthRoutes, { prefix: '/health' });
  await fastify.register(adminLlmRoutes, { prefix: '/llm' });
  await fastify.register(adminEnrichmentRoutes, { prefix: '/enrichment' });
  await fastify.register(adminClawbotRoutes, { prefix: '/clawbot' });
  await fastify.register(adminEnrichmentSchedulerRoutes, { prefix: '/enrichment-scheduler' });
  await fastify.register(adminChatbotRoutes, { prefix: '/chatbot' });
  await fastify.register(adminQualityMetricsRoutes, { prefix: '/quality-metrics' });
  await fastify.register(adminSystemSettingsRoutes, { prefix: '/settings' });
  await fastify.register(adminDiscoverTracesRoutes, { prefix: '/discover-traces' });
  // CP488 — Search Quality Overhaul: algorithm catalog + per-mandala override
  // + A/B comparison view (D11 measurement oracle).
  await fastify.register(adminSearchAlgorithmsRoutes, { prefix: '/search-algorithms' });
  // CP488+ — v2 Quality Audit (daily score scan of v2 rich-summary rows).
  // Design: docs/design/v2-quality-audit-system-2026-05-27.md
  await fastify.register(adminV2QualityAuditRoutes, { prefix: '/v2-quality-audit' });
  // await fastify.register(stripeWebhookRoutes, { prefix: '/webhooks/stripe' });
}
