import { FastifyInstance, FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import fastifyJWT from '@fastify/jwt';
import { JWTPayload } from '../schemas/auth.schema';
import { createErrorResponse, ErrorCode } from '../schemas/common.schema';

/**
 * Supabase JWT Authentication Plugin
 *
 * Verifies Supabase-issued JWT tokens using SUPABASE_JWT_SECRET.
 * Maps Supabase JWT claims (sub, email, user_metadata) to our JWTPayload format
 * for backward compatibility with existing route handlers.
 *
 * Token lifecycle is managed entirely by Supabase Auth on the frontend.
 * This plugin only verifies and decodes tokens.
 */

/** Supabase JWT token payload structure */
interface SupabaseJWTClaims {
  aud: string;
  exp: number;
  iat: number;
  iss: string;
  sub: string;
  email?: string;
  phone?: string;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
  role?: string;
  aal?: string;
  session_id?: string;
}

// Extend @fastify/jwt type definitions for user payload
declare module '@fastify/jwt' {
  interface FastifyJWT {
    user: JWTPayload;
  }
}

// Extend Fastify type definitions for custom decorators
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: preHandlerHookHandler;
  }
}

/**
 * Register Supabase JWT authentication plugin
 */
export async function registerAuth(fastify: FastifyInstance) {
  // Support both Supabase JWT secret and legacy JWT_SECRET for backward compatibility
  const jwtSecret = process.env['SUPABASE_JWT_SECRET'] || process.env['JWT_SECRET'];
  if (!jwtSecret) {
    throw new Error(
      'SUPABASE_JWT_SECRET (or JWT_SECRET) environment variable is required. ' +
      'Get it from Supabase Dashboard > Settings > API > JWT Secret.'
    );
  }

  // Register JWT plugin for token verification only (no signing)
  await fastify.register(fastifyJWT, {
    secret: jwtSecret,
    decode: {
      complete: false,
    },
    messages: {
      badRequestErrorMessage: 'Authorization header format must be: Bearer <token>',
      noAuthorizationInHeaderMessage: 'No Authorization header found',
      authorizationTokenExpiredMessage: 'Access token has expired',
      authorizationTokenInvalid: (err) => {
        return `Authorization token is invalid: ${err.message}`;
      },
    },
  });

  /**
   * Decorator: Authentication hook for protected routes
   *
   * Verifies Supabase JWT and maps claims to JWTPayload format:
   *   sub → userId
   *   email → email
   *   user_metadata.name / user_metadata.full_name → name
   *
   * Usage unchanged from custom JWT:
   *   fastify.get('/protected', {
   *     onRequest: [fastify.authenticate],
   *     handler: async (request, reply) => {
   *       // request.user.userId, request.user.email, request.user.name
   *     }
   *   });
   */
  fastify.decorate('authenticate', async function (
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    try {
      // Verify JWT and decode Supabase claims
      const decoded = await request.jwtVerify<SupabaseJWTClaims>();

      // Map Supabase JWT claims to our JWTPayload for backward compatibility
      const userMeta = (decoded.user_metadata || {}) as Record<string, unknown>;
      request.user = {
        userId: decoded.sub,
        email: decoded.email || '',
        name: (userMeta['name'] as string) ||
              (userMeta['full_name'] as string) ||
              (decoded.email?.split('@')[0] || ''),
      };
    } catch (err) {
      const error = err as Error;
      let errorCode = ErrorCode.INVALID_TOKEN;
      let message = 'Invalid authentication token';

      if (error.message.includes('expired')) {
        errorCode = ErrorCode.TOKEN_EXPIRED;
        message = 'Access token has expired';
      } else if (error.message.includes('No Authorization')) {
        errorCode = ErrorCode.UNAUTHORIZED;
        message = 'No authorization token provided';
      }

      return reply.code(401).send(
        createErrorResponse(errorCode, message, request.url, {
          error: error.message,
        })
      );
    }
  });

  fastify.log.info('Supabase JWT authentication plugin registered');
}

/**
 * Helper: Extract token from Authorization header
 */
export function extractTokenFromHeader(authHeader?: string): string | null {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1] || null;
}
