import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db as prisma } from '../../modules/database/client';
import {
  getMeSchema,
  GetMeResponse,
} from '../schemas/auth.schema';
import { createErrorResponse, ErrorCode } from '../schemas/common.schema';

/**
 * Authentication Routes (Supabase Auth)
 *
 * User registration, login, and token management are handled entirely by
 * Supabase Auth on the frontend using @supabase/supabase-js.
 *
 * This module only provides:
 * - GET /auth/me - Get current authenticated user info
 * - POST /auth/logout - Server-side logout acknowledgment
 *
 * Frontend auth flow:
 *   1. supabase.auth.signInWithOAuth({ provider: 'google' })
 *   2. Supabase handles OAuth flow, returns session with JWT
 *   3. Frontend sends JWT in Authorization header to API
 *   4. API verifies JWT using SUPABASE_JWT_SECRET (see plugins/auth.ts)
 */
export async function authRoutes(fastify: FastifyInstance) {
  /**
   * GET /auth/me
   * Get current authenticated user information
   */
  fastify.get<{ Reply: GetMeResponse }>(
    '/me',
    {
      schema: getMeSchema,
      preHandler: [fastify.authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.user || !('userId' in request.user)) {
        return reply.code(401).send(
          createErrorResponse(
            ErrorCode.UNAUTHORIZED,
            'Not authenticated',
            request.url
          )
        );
      }

      // Fetch user data from database
      const user = await prisma.users.findUnique({
        where: { id: request.user.userId },
      });

      if (!user) {
        return reply.code(404).send(
          createErrorResponse(
            ErrorCode.RESOURCE_NOT_FOUND,
            'User not found',
            request.url
          )
        );
      }

      // Extract name from metadata
      const meta = user.raw_user_meta_data as Record<string, unknown> | null;
      const name = (meta?.['name'] as string) ||
                   (meta?.['full_name'] as string) ||
                   (user.email?.split('@')[0] ?? '');

      const response: GetMeResponse = {
        user: {
          id: user.id,
          email: user.email ?? '',
          name,
          createdAt: user.created_at ?? new Date(),
          updatedAt: user.updated_at ?? new Date(),
        },
      };

      return reply.code(200).send(response);
    }
  );

  /**
   * POST /auth/logout
   * Server-side logout acknowledgment
   *
   * Actual session invalidation is handled by Supabase Auth on the frontend:
   *   await supabase.auth.signOut()
   */
  fastify.post(
    '/logout',
    {
      schema: {
        description: 'Acknowledge server-side logout',
        tags: ['auth'],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: 'object',
            properties: {
              message: { type: 'string' },
            },
          },
        },
      },
      preHandler: [fastify.authenticate],
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.code(200).send({ message: 'Logged out successfully' });
    }
  );

  fastify.log.info('Authentication routes registered (Supabase Auth mode)');
}
