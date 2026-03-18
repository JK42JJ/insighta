import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../../modules/database/client';
import { createErrorResponse, ErrorCode } from '../schemas/common.schema';

/**
 * Admin authentication plugin.
 * Must be registered AFTER the main auth plugin (requires fastify.authenticate).
 *
 * Usage in routes: { onRequest: [fastify.authenticate, fastify.authenticateAdmin] }
 * The standard authenticate runs first (JWT verification + request.user population),
 * then authenticateAdmin checks is_super_admin.
 */
export async function registerAdminAuth(fastify: FastifyInstance) {
  fastify.decorate(
    'authenticateAdmin',
    async function (request: FastifyRequest, reply: FastifyReply) {
      // At this point, fastify.authenticate has already run and set request.user
      const userId = request.user?.userId;
      if (!userId) {
        return reply
          .code(401)
          .send(createErrorResponse(ErrorCode.UNAUTHORIZED, 'Authentication required', request.url));
      }

      // Check is_super_admin in auth.users
      const result = await db.$queryRaw<Array<{ is_super_admin: boolean | null }>>`
        SELECT is_super_admin FROM auth.users WHERE id = ${userId}::uuid
      `;

      if (!result[0]?.is_super_admin) {
        return reply
          .code(403)
          .send(
            createErrorResponse(
              ErrorCode.FORBIDDEN,
              'Admin access required',
              request.url
            )
          );
      }
    }
  );

  fastify.log.info('Admin authentication plugin registered');
}
