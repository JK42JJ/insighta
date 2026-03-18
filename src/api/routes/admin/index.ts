import { FastifyInstance } from 'fastify';
import { registerAdminAuth } from '../../plugins/admin-auth';
import { adminCheckRoute } from './check';
import { adminUserRoutes } from './users';
import { adminStatsRoutes } from './stats';

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
}
