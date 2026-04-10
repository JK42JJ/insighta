import { FastifyInstance, FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { createErrorResponse, ErrorCode } from '../schemas/common.schema';

/**
 * Rate Limit Plugin — Targeted Resource Protection
 *
 * Design principles (industry-aligned, 2026-04-10):
 *
 *   1. Rate limit protects EXPENSIVE RESOURCES, not normal usage.
 *   2. Authenticated users are NEVER globally rate limited on reads.
 *   3. Health checks and internal calls are always excluded.
 *   4. Cost-generating endpoints (LLM, YouTube API) have individual budgets.
 *   5. One endpoint's limit never affects another (Stripe/X model).
 *
 * Architecture — 3 tiers:
 *
 *   Tier 1 (global safety net):
 *     Authenticated:   200 req/min (POST/PUT/DELETE only, GET excluded)
 *     Unauthenticated: 30 req/min (all methods, IP-based)
 *     Health/internal:  excluded
 *
 *   Tier 2 (method-based):
 *     GET requests: no limit (reads are free)
 *     Write requests: counted in Tier 1
 *
 *   Tier 3 (per-endpoint, applied via route config):
 *     POST /mandalas/generate:        10 req/min (LLM cost)
 *     POST /mandalas/search-by-goal:  20 req/min (vector search)
 *     POST /mandalas/create*:         10 req/min (heavy transaction)
 *     POST /playlists/import:         10 req/min (YouTube API)
 *     POST /:id/sync:                  5 req/min (YouTube API)
 *     POST /auth/*:                   10 req/min (brute-force prevention)
 *
 * Reference: GitHub 5,000/hr auth, Stripe endpoint-specific, X per-endpoint 15min.
 */

/** Authenticated user global write limit */
const AUTHENTICATED_WRITE_MAX = 200;
/** Unauthenticated global limit (all methods) */
const UNAUTHENTICATED_MAX = 30;
/** Time window */
const TIME_WINDOW = '1 minute';

/** Rate limit presets for Tier 3 per-route application */
export const RATE_LIMITS = {
  /** LLM-calling endpoints — OpenRouter/Ollama cost protection */
  llm: { max: 10, timeWindow: TIME_WINDOW },
  /** Vector search — DB compute cost */
  vectorSearch: { max: 20, timeWindow: TIME_WINDOW },
  /** Heavy transactions — mandala creation, template clone */
  heavyWrite: { max: 10, timeWindow: TIME_WINDOW },
  /** YouTube API — external quota protection */
  youtube: { max: 10, timeWindow: TIME_WINDOW },
  /** YouTube sync — expensive, sequential */
  youtubeSync: { max: 5, timeWindow: TIME_WINDOW },
  /** Auth endpoints — brute-force prevention */
  auth: { max: 10, timeWindow: TIME_WINDOW },
} as const;

/**
 * Check if request should skip rate limiting entirely.
 */
function shouldSkip(request: FastifyRequest): boolean {
  const url = request.url;

  // Health checks — never rate limited
  if (url === '/health' || url === '/api/health') return true;

  // Internal/monitoring calls from Docker/localhost
  const ip = request.ip;
  if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('172.')) return true;

  // GET requests from authenticated users — reads are free
  if (request.method === 'GET') {
    const user = request.user as { userId?: string } | undefined;
    if (user?.userId) return true;
  }

  return false;
}

/**
 * Register rate limit plugin.
 *
 * Global: applies to all routes as safety net.
 * Individual routes can add Tier 3 limits via route config.
 */
export async function registerRateLimit(fastify: FastifyInstance) {
  await fastify.register(rateLimit, {
    global: true,
    max: (request) => {
      const user = request.user as { userId?: string } | undefined;
      return user?.userId ? AUTHENTICATED_WRITE_MAX : UNAUTHENTICATED_MAX;
    },
    timeWindow: TIME_WINDOW,
    cache: 10000,
    allowList: (request: FastifyRequest, _key: string) => {
      return shouldSkip(request);
    },
    skipOnError: true,
    continueExceeding: false,

    keyGenerator: (request) => {
      const user = request.user as { userId?: string } | undefined;
      if (user?.userId) return `user:${user.userId}`;
      return request.ip;
    },

    errorResponseBuilder: (_request, context) => {
      const retryAfterSeconds = Math.ceil(context.ttl / 1000);
      return createErrorResponse(
        ErrorCode.RATE_LIMIT_EXCEEDED,
        `Too many requests. Please wait ${retryAfterSeconds} seconds.`,
        _request.url,
        {
          limit: context.max,
          remaining: 0,
          retryAfterSeconds,
        }
      );
    },

    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
    },
    addHeadersOnExceeding: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
    },
  });

  fastify.log.info(
    `Rate limiting registered: auth=${AUTHENTICATED_WRITE_MAX}/min (writes only), unauth=${UNAUTHENTICATED_MAX}/min, GET=exempt`
  );
}

/**
 * Helper: create Tier 3 route-level rate limit config.
 *
 * Usage:
 *   fastify.post('/generate', { config: routeRateLimit(RATE_LIMITS.llm) }, handler)
 */
export function routeRateLimit(preset: { max: number; timeWindow: string }) {
  return { rateLimit: preset };
}

declare module 'fastify' {
  interface RouteShorthandOptions {
    rateLimit?: {
      max: number;
      timeWindow: string | number;
    };
  }
}
