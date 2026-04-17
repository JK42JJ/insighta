/**
 * Cost-Tier Rate Limiter — Fastify plugin
 *
 * Multi-dimensional rate limiting inspired by GitHub's API:
 *   Dimension 1: Per-user token bucket, tier-specific (A/B/C/D)
 *   Dimension 2: Per-user concurrency cap
 *   Dimension 3: Observability headers (X-RateLimit-*)
 *
 * Uses rate-limiter-flexible in-memory mode. When Insighta moves to
 * multi-instance, swap RateLimiterMemory → RateLimiterRedis (config only).
 */

import fp from 'fastify-plugin';
import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  TIER_CONFIG,
  MAX_CONCURRENCY_PER_USER,
  getTierForRoute,
  type CostTier,
} from '@/config/rate-limit-tiers';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'cost-tier-limiter' });

// ── Per-tier token buckets ────────────────────────────────────────────

const buckets: Record<CostTier, RateLimiterMemory> = {
  A: new RateLimiterMemory({ keyPrefix: 'rl-A', ...TIER_CONFIG.A }),
  B: new RateLimiterMemory({ keyPrefix: 'rl-B', ...TIER_CONFIG.B }),
  C: new RateLimiterMemory({ keyPrefix: 'rl-C', ...TIER_CONFIG.C }),
  D: new RateLimiterMemory({ keyPrefix: 'rl-D', ...TIER_CONFIG.D }),
};

// ── Per-user concurrency counter ──────────────────────────────────────

const concurrency = new Map<string, number>();

function acquireConcurrency(userId: string): boolean {
  const current = concurrency.get(userId) ?? 0;
  if (current >= MAX_CONCURRENCY_PER_USER) return false;
  concurrency.set(userId, current + 1);
  return true;
}

function releaseConcurrency(userId: string): void {
  const current = concurrency.get(userId) ?? 0;
  if (current <= 1) {
    concurrency.delete(userId);
  } else {
    concurrency.set(userId, current - 1);
  }
}

// ── Observability headers ─────────────────────────────────────────────

function setRateLimitHeaders(reply: FastifyReply, tier: CostTier, res: RateLimiterRes): void {
  const config = TIER_CONFIG[tier];
  void reply.header('X-RateLimit-Tier', tier);
  void reply.header('X-RateLimit-Limit', config.points);
  void reply.header('X-RateLimit-Remaining', Math.max(0, res.remainingPoints));
  void reply.header('X-RateLimit-Reset', new Date(Date.now() + res.msBeforeNext).toISOString());
}

function send429(reply: FastifyReply, tier: CostTier, rej: RateLimiterRes): void {
  const config = TIER_CONFIG[tier];
  const retryAfterSec = Math.ceil(rej.msBeforeNext / 1000);
  void reply.header('Retry-After', retryAfterSec);
  void reply.header('X-RateLimit-Tier', tier);
  void reply.header('X-RateLimit-Remaining', 0);
  void reply.code(429).send({
    status: 429,
    error: 'rate_limited',
    code: 'RATE_LIMIT_EXCEEDED',
    tier,
    retry_after_ms: rej.msBeforeNext,
    limit: { rate: config.points, per_seconds: config.duration },
    message: `Rate limit exceeded (tier ${tier}). Retry after ${retryAfterSec}s.`,
  });
}

// ── Plugin ────────────────────────────────────────────────────────────

function costTierLimiterPlugin(fastify: FastifyInstance): void {
  const isProd = process.env['NODE_ENV'] === 'production';
  if (!isProd) {
    log.info('Cost-tier rate limiter disabled in development');
    return;
  }

  log.info('Cost-tier rate limiter enabled', {
    tiers: Object.fromEntries(
      Object.entries(TIER_CONFIG).map(([k, v]) => [k, `${v.points}/${v.duration}s`])
    ),
    maxConcurrency: MAX_CONCURRENCY_PER_USER,
  });

  // ── onRequest: consume token + check concurrency ──
  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const tier = getTierForRoute(request.method, request.routeOptions?.url ?? request.url);
    if (!tier) return; // unmatched routes (health, public) bypass

    // User identification: authenticated userId preferred, fallback to IP
    const userId: string =
      (request as unknown as { user?: { userId?: string } }).user?.userId ?? request.ip;

    // Concurrency check
    if (!acquireConcurrency(userId)) {
      void reply.code(429).send({
        status: 429,
        error: 'too_many_concurrent_requests',
        code: 'CONCURRENCY_LIMIT',
        message: `Max ${MAX_CONCURRENCY_PER_USER} concurrent requests. Wait for in-flight requests to complete.`,
      });
      return;
    }

    // Store for onResponse cleanup
    (request as unknown as { _rlUserId?: string })._rlUserId = userId;
    (request as unknown as { _rlTier?: CostTier })._rlTier = tier;

    // Token bucket consume
    try {
      const res = await buckets[tier].consume(userId, 1);
      setRateLimitHeaders(reply, tier, res);
    } catch (rej) {
      releaseConcurrency(userId);
      send429(reply, tier, rej as RateLimiterRes);
    }
  });

  // ── onResponse: release concurrency ──
  fastify.addHook(
    'onResponse',
    (request: FastifyRequest, _reply: FastifyReply, done: () => void) => {
      const userId = (request as unknown as { _rlUserId?: string })._rlUserId;
      if (userId) releaseConcurrency(userId);
      done();
    }
  );
}

export default fp(costTierLimiterPlugin, {
  name: 'cost-tier-limiter',
  fastify: '5.x',
});
