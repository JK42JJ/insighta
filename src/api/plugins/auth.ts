import { FastifyInstance, FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import fastifyJWT from '@fastify/jwt';
import { JWTPayload } from '../schemas/auth.schema';
import { createErrorResponse, ErrorCode } from '../schemas/common.schema';

/**
 * JWT Authentication Plugin
 *
 * Provides JWT token generation, verification, and authentication middleware.
 * Integrates with @fastify/jwt for secure token handling.
 *
 * Features:
 * - Access token generation (15 min expiry)
 * - Refresh token generation (7 day expiry)
 * - Token verification with error handling
 * - Request decorator for authenticated user
 * - Route-level authentication hook
 */

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
    generateTokens: (payload: JWTPayload) => Promise<{ accessToken: string; refreshToken: string; expiresIn: number }>;
  }
}

/**
 * Token expiration times
 */
const ACCESS_TOKEN_EXPIRY = '15m'; // 15 minutes
const REFRESH_TOKEN_EXPIRY = '7d'; // 7 days
const ACCESS_TOKEN_EXPIRY_SECONDS = 900; // 15 * 60

/**
 * Register JWT authentication plugin
 */
export async function registerAuth(fastify: FastifyInstance) {
  // Ensure JWT_SECRET is set
  const jwtSecret = process.env['JWT_SECRET'];
  if (!jwtSecret) {
    throw new Error(
      'JWT_SECRET environment variable is required. Please set it in your .env file.'
    );
  }

  const jwtRefreshSecret = process.env['JWT_REFRESH_SECRET'] || `${jwtSecret}_refresh`;

  // Register JWT plugin for access tokens
  await fastify.register(fastifyJWT, {
    secret: jwtSecret,
    sign: {
      expiresIn: ACCESS_TOKEN_EXPIRY,
    },
    decode: {
      complete: false, // Return payload only, not full JWT object
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
   * Decorator: Generate both access and refresh tokens
   */
  fastify.decorate('generateTokens', async function (payload: JWTPayload) {
    // Generate access token using the main JWT instance
    const accessToken = await fastify.jwt.sign(payload);

    // Generate refresh token with refresh secret and unique JTI for rotation
    // Add jti (JWT ID) to ensure each refresh token is unique even with same payload
    const refreshPayload = {
      ...payload,
      jti: `${payload.userId}_${Date.now()}_${Math.random().toString(36).substring(7)}`,
    };

    const refreshToken = await fastify.jwt.sign(refreshPayload, {
      expiresIn: REFRESH_TOKEN_EXPIRY,
      key: jwtRefreshSecret,
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TOKEN_EXPIRY_SECONDS,
    };
  });

  /**
   * Decorator: Authentication hook for protected routes
   *
   * Usage:
   *   fastify.get('/protected', {
   *     preHandler: [fastify.authenticate],
   *     handler: async (request, reply) => {
   *       // Access authenticated user via request.user
   *     }
   *   });
   */
  fastify.decorate('authenticate', async function (
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    try {
      // Verify JWT and decode payload
      const payload = await request.jwtVerify<JWTPayload>();

      // Attach user to request
      request.user = payload;
    } catch (err) {
      // Handle JWT errors
      const error = err as Error;
      let errorCode = ErrorCode.INVALID_TOKEN;
      let message = 'Invalid authentication token';
      let statusCode = 401;

      if (error.message.includes('expired')) {
        errorCode = ErrorCode.TOKEN_EXPIRED;
        message = 'Access token has expired';
      } else if (error.message.includes('No Authorization')) {
        errorCode = ErrorCode.UNAUTHORIZED;
        message = 'No authorization token provided';
      }

      return reply.code(statusCode).send(
        createErrorResponse(errorCode, message, request.url, {
          error: error.message,
        })
      );
    }
  });

  fastify.log.info('JWT authentication plugin registered');
}

/**
 * Helper: Verify refresh token
 *
 * @param fastify - Fastify instance
 * @param refreshToken - Refresh token to verify
 * @returns Decoded JWT payload
 */
export async function verifyRefreshToken(
  fastify: FastifyInstance,
  refreshToken: string
): Promise<JWTPayload> {
  try {
    const jwtRefreshSecret = process.env['JWT_REFRESH_SECRET'] || `${process.env['JWT_SECRET']}_refresh`;

    // Verify refresh token with refresh secret using 'key' option
    const payload = await fastify.jwt.verify<JWTPayload>(refreshToken, {
      key: jwtRefreshSecret,
    });

    return payload;
  } catch (err) {
    const error = err as Error;

    if (error.message.includes('expired')) {
      throw new Error('REFRESH_TOKEN_EXPIRED');
    } else {
      throw new Error('INVALID_REFRESH_TOKEN');
    }
  }
}

/**
 * Helper: Extract token from Authorization header
 *
 * @param authHeader - Authorization header value
 * @returns Extracted token or null
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

/**
 * Helper: Create JWT payload from user data
 *
 * @param user - User object with id, email, name
 * @returns JWT payload
 */
export function createJWTPayload(user: {
  id: string;
  email: string;
  name: string;
}): JWTPayload {
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
  };
}
