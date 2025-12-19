import { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { createErrorResponse, ErrorCode } from '../schemas/common.schema';

/**
 * Rate Limit Plugin Configuration
 *
 * Provides fine-grained rate limiting for different endpoint categories.
 * Prevents abuse and ensures fair usage of API resources.
 *
 * Rate Limit Strategy:
 * - Global: 100 req/min per IP
 * - Auth endpoints: 5-20 req/min (stricter for security)
 * - Heavy operations (sync, summary): 5-10 req/min
 * - Standard operations: 30-100 req/min
 *
 * Headers:
 * - X-RateLimit-Limit: Maximum requests allowed
 * - X-RateLimit-Remaining: Remaining requests in current window
 * - X-RateLimit-Reset: Unix timestamp when limit resets
 */

/**
 * Rate limit configurations for different endpoint categories
 */
export const RATE_LIMIT_CONFIG = {
  global: {
    max: parseInt(process.env['RATE_LIMIT_MAX'] || '100', 10),
    timeWindow: process.env['RATE_LIMIT_WINDOW'] || '1 minute',
  },
  auth: {
    login: { max: 10, timeWindow: '1 minute' },
    register: { max: 5, timeWindow: '1 minute' },
    refresh: { max: 20, timeWindow: '1 minute' },
  },
  heavy: {
    sync: { max: 10, timeWindow: '1 minute' },
    summary: { max: 5, timeWindow: '1 minute' },
    import: { max: 10, timeWindow: '1 minute' },
  },
  standard: {
    playlists: { max: 50, timeWindow: '1 minute' },
    videos: { max: 100, timeWindow: '1 minute' },
    analytics: { max: 30, timeWindow: '1 minute' },
    notes: { max: 50, timeWindow: '1 minute' },
  },
} as const;

/**
 * Register global rate limiting plugin
 *
 * This sets up the base rate limiter that applies to all routes.
 * Individual routes can override these settings with stricter limits.
 */
export async function registerRateLimit(fastify: FastifyInstance) {
  await fastify.register(rateLimit, {
    global: true,
    max: RATE_LIMIT_CONFIG.global.max,
    timeWindow: RATE_LIMIT_CONFIG.global.timeWindow,
    cache: 10000, // Cache size for tracking IPs
    allowList: (process.env['RATE_LIMIT_WHITELIST'] || '').split(',').filter(Boolean),
    redis: undefined, // Can be configured for production with Redis
    nameSpace: 'rl:', // Redis key namespace
    continueExceeding: true, // Continue to count requests after limit exceeded
    skipOnError: true, // Don't fail requests if rate limiter errors
    enableDraftSpec: true, // Support for draft-07 of the rate limit spec

    // Custom key generator (default is IP-based)
    keyGenerator: (request) => {
      // Use authenticated user ID if available, otherwise fall back to IP
      const user = request.user as { userId?: string } | undefined;
      if (user?.userId) {
        return `user:${user.userId}`;
      }
      return request.ip;
    },

    // Custom error response
    errorResponseBuilder: (request, context) => {
      return createErrorResponse(
        ErrorCode.RATE_LIMIT_EXCEEDED,
        `Rate limit exceeded. Maximum ${context.max} requests per ${context.after}. Try again later.`,
        request.url,
        {
          limit: context.max,
          remaining: 0,
          resetAt: new Date(Date.now() + context.ttl).toISOString(),
        }
      );
    },

    // Add rate limit headers to responses
    addHeaders: {
      'x-ratelimit-limit': true, // Total requests allowed
      'x-ratelimit-remaining': true, // Remaining requests
      'x-ratelimit-reset': true, // Reset timestamp (Unix)
    },

    // Add custom headers
    addHeadersOnExceeding: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
    },
  });

  fastify.log.info(
    `Rate limiting plugin registered: max=${RATE_LIMIT_CONFIG.global.max}, window=${RATE_LIMIT_CONFIG.global.timeWindow}`
  );
}

/**
 * Helper function to create route-specific rate limit configuration
 *
 * Usage in route definitions:
 * ```typescript
 * fastify.post('/api/v1/auth/login', {
 *   config: createRateLimitConfig('auth', 'login'),
 *   handler: async (request, reply) => { ... }
 * });
 * ```
 */
export function createRateLimitConfig(
  category: keyof typeof RATE_LIMIT_CONFIG,
  subcategory?: string
) {
  const config =
    category === 'global'
      ? RATE_LIMIT_CONFIG.global
      : subcategory && category in RATE_LIMIT_CONFIG
      ? (RATE_LIMIT_CONFIG[category] as Record<string, { max: number; timeWindow: string }>)[
          subcategory
        ]
      : RATE_LIMIT_CONFIG.global;

  if (!config) {
    throw new Error(`Invalid rate limit configuration: ${category}.${subcategory}`);
  }

  return {
    rateLimit: {
      max: config.max,
      timeWindow: config.timeWindow,
    },
  };
}

/**
 * Decorator to add rate limit configuration to route options
 *
 * This extends Fastify's route options to include rate limit configuration.
 */
declare module 'fastify' {
  interface RouteShorthandOptions {
    rateLimit?: {
      max: number;
      timeWindow: string | number;
    };
  }
}

/**
 * Rate limit presets for common use cases
 */
export const RATE_LIMIT_PRESETS = {
  // Authentication endpoints (strict)
  auth: { max: 10, timeWindow: '1 minute' },

  // Heavy operations (very strict)
  heavy: { max: 5, timeWindow: '1 minute' },

  // Standard CRUD operations (moderate)
  standard: { max: 50, timeWindow: '1 minute' },

  // Read-only operations (relaxed)
  readonly: { max: 100, timeWindow: '1 minute' },

  // Admin operations (strict but higher than auth)
  admin: { max: 20, timeWindow: '1 minute' },
} as const;

/**
 * Helper to check if user is approaching rate limit
 *
 * Can be used in route handlers to warn users before they hit the limit.
 */
export function isApproachingRateLimit(remaining: number, limit: number): boolean {
  const threshold = 0.2; // Warn when <20% remaining
  return remaining / limit < threshold;
}
