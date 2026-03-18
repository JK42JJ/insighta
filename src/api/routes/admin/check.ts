import { FastifyInstance } from 'fastify';

/**
 * Lightweight admin check endpoint.
 * No DB query in handler — authenticateAdmin hook already verifies is_super_admin.
 */
export async function adminCheckRoute(fastify: FastifyInstance) {
  fastify.get(
    '/',
    {
      onRequest: [fastify.authenticate, fastify.authenticateAdmin],
    },
    async (_request, _reply) => {
      return { isAdmin: true };
    }
  );
}
