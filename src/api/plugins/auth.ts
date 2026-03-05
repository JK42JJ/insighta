import { FastifyInstance, FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import fastifyJWT from '@fastify/jwt';
import { createPublicKey } from 'crypto';
import { JWTPayload } from '../schemas/auth.schema';
import { createErrorResponse, ErrorCode } from '../schemas/common.schema';

/**
 * Supabase JWT Authentication Plugin
 *
 * Verifies Supabase-issued JWT tokens.
 * Supabase Cloud uses ES256 asymmetric keys — we fetch the public key from JWKS.
 * Fallback to HS256 via SUPABASE_JWT_SECRET for self-hosted or legacy setups.
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
 * Fetch the ES256 public key from Supabase JWKS endpoint and convert to PEM.
 */
async function fetchSupabasePublicKey(supabaseUrl: string): Promise<string | null> {
  try {
    const jwksUrl = `${supabaseUrl}/auth/v1/.well-known/jwks.json`;
    const response = await fetch(jwksUrl);
    if (!response.ok) return null;

    const jwks = (await response.json()) as {
      keys: Array<{ kty: string; crv: string; x: string; y: string; alg: string }>;
    };
    const key = jwks.keys.find((k) => k.alg === 'ES256');
    if (!key) return null;

    // Convert JWK to PEM using Node.js crypto
    const publicKey = createPublicKey({ key, format: 'jwk' });
    return publicKey.export({ type: 'spki', format: 'pem' }) as string;
  } catch {
    return null;
  }
}

/**
 * Register Supabase JWT authentication plugin
 */
export async function registerAuth(fastify: FastifyInstance) {
  const supabaseUrl = process.env['SUPABASE_URL'];
  const jwtSecret = process.env['SUPABASE_JWT_SECRET'] || process.env['JWT_SECRET'];

  // Try JWKS first (ES256), fall back to HS256 secret
  let jwtOptions: Parameters<typeof fastifyJWT>[1];
  let method: string;

  if (supabaseUrl) {
    const publicKeyPem = await fetchSupabasePublicKey(supabaseUrl);
    if (publicKeyPem) {
      // ES256: use asymmetric key config — public key for verification only
      // @fastify/jwt requires both public and private keys for asymmetric algorithms,
      // but we never sign tokens (only Supabase does), so private is unused placeholder.
      jwtOptions = {
        secret: {
          public: publicKeyPem,
          private: 'unused-we-never-sign-tokens',
        },
        decode: { complete: false },
        verify: { algorithms: ['ES256'] as const },
      };
      method = 'JWKS (ES256)';
    } else if (jwtSecret) {
      jwtOptions = {
        secret: jwtSecret,
        decode: { complete: false },
        verify: { algorithms: ['HS256'] as const },
      };
      method = 'HS256 (JWKS fetch failed, using fallback)';
    } else {
      throw new Error(
        'Failed to fetch JWKS from Supabase and no SUPABASE_JWT_SECRET fallback configured.'
      );
    }
  } else if (jwtSecret) {
    jwtOptions = {
      secret: jwtSecret,
      decode: { complete: false },
      verify: { algorithms: ['HS256'] as const },
    };
    method = 'HS256';
  } else {
    throw new Error(
      'Either SUPABASE_URL (for JWKS/ES256) or SUPABASE_JWT_SECRET (for HS256) is required.'
    );
  }

  // Register JWT plugin
  await fastify.register(fastifyJWT, {
    ...jwtOptions,
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
   */
  fastify.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
    try {
      const decoded = await request.jwtVerify<SupabaseJWTClaims>();

      const userMeta: Record<string, unknown> = decoded.user_metadata || {};
      request.user = {
        userId: decoded.sub,
        email: decoded.email || '',
        name:
          (userMeta['name'] as string) ||
          (userMeta['full_name'] as string) ||
          decoded.email?.split('@')[0] ||
          '',
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

  fastify.log.info(`Supabase JWT authentication registered (${method})`);
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
