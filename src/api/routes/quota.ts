/**
 * Quota API Routes
 *
 * REST API endpoints for quota usage tracking and rate limit information
 */

import { FastifyPluginCallback } from 'fastify';
import { getPrismaClient } from '../../modules/database';
import {
  getQuotaUsageSchema,
  getQuotaLimitsSchema,
  type QuotaUsageResponse,
  type QuotaLimitsResponse,
} from '../schemas/quota.schema';
import { logger } from '../../utils/logger';

/**
 * YouTube API quota costs (in quota units)
 * Reference: https://developers.google.com/youtube/v3/determine_quota_cost
 */
const YOUTUBE_QUOTA_COSTS = {
  'playlists.list': 1,
  'playlistItems.list': 1,
  'videos.list': 1,
  'channels.list': 1,
  'search.list': 100,
  'captions.list': 50,
  'captions.download': 200,
  'activities.list': 1,
  'commentThreads.list': 1,
} as const;

/**
 * Rate limit configurations for different endpoint categories
 */
const RATE_LIMIT_CONFIGS = [
  {
    endpoint: '/api/v1/auth/login',
    max: 10,
    timeWindow: '1 minute',
    timeWindowMs: 60000,
  },
  {
    endpoint: '/api/v1/auth/register',
    max: 5,
    timeWindow: '1 minute',
    timeWindowMs: 60000,
  },
  {
    endpoint: '/api/v1/auth/refresh',
    max: 20,
    timeWindow: '1 minute',
    timeWindowMs: 60000,
  },
  {
    endpoint: '/api/v1/playlists/*',
    max: 50,
    timeWindow: '1 minute',
    timeWindowMs: 60000,
  },
  {
    endpoint: '/api/v1/videos/*',
    max: 100,
    timeWindow: '1 minute',
    timeWindowMs: 60000,
  },
  {
    endpoint: '/api/v1/analytics/*',
    max: 30,
    timeWindow: '1 minute',
    timeWindowMs: 60000,
  },
  {
    endpoint: '/api/v1/sync/*',
    max: 10,
    timeWindow: '1 minute',
    timeWindowMs: 60000,
  },
  {
    endpoint: 'global',
    max: 100,
    timeWindow: '1 minute',
    timeWindowMs: 60000,
  },
] as const;

/**
 * Quota routes plugin
 *
 * Note: Database client is lazily loaded in each route handler to avoid
 * initializing at plugin registration time.
 */
export const quotaRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // Lazy getter for database - only initialize when actually needed
  const getDb = () => getPrismaClient();

  // Guard against missing authenticate decorator (can happen in tests)
  if (!fastify.authenticate) {
    fastify.log.warn('authenticate decorator not found, quota routes skipped');
    done();
    return;
  }

  /**
   * GET /api/v1/quota/usage - Get current quota usage
   */
  fastify.get<{ Reply: { quota: QuotaUsageResponse } }>(
    '/usage',
    {
      schema: getQuotaUsageSchema,
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      // Type guard for authenticated user
      if (!request.user || !('userId' in request.user)) {
        throw new Error('Unauthorized');
      }

      logger.info('Getting quota usage', { userId: request.user.userId });

      // Get today's date at midnight UTC
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      // Get or create today's quota usage record
      let quotaUsage = await getDb().quotaUsage.findUnique({
        where: { date: today },
      });

      if (!quotaUsage) {
        quotaUsage = await getDb().quotaUsage.create({
          data: {
            date: today,
            used: 0,
            limit: parseInt(process.env['YOUTUBE_QUOTA_LIMIT'] || '10000', 10),
          },
        });
      }

      // Calculate reset time (next day at midnight UTC)
      const resetAt = new Date(today);
      resetAt.setUTCDate(resetAt.getUTCDate() + 1);

      const response: QuotaUsageResponse = {
        date: quotaUsage.date.toISOString(),
        used: quotaUsage.used,
        limit: quotaUsage.limit,
        remaining: Math.max(0, quotaUsage.limit - quotaUsage.used),
        percentage: Math.min(100, (quotaUsage.used / quotaUsage.limit) * 100),
        resetAt: resetAt.toISOString(),
      };

      logger.info('Quota usage retrieved', {
        userId: request.user.userId,
        used: response.used,
        limit: response.limit,
      });

      return reply.code(200).send({ quota: response });
    }
  );

  /**
   * GET /api/v1/quota/limits - Get quota limits
   */
  fastify.get<{ Reply: { limits: QuotaLimitsResponse } }>(
    '/limits',
    {
      schema: getQuotaLimitsSchema,
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      // Type guard for authenticated user
      if (!request.user || !('userId' in request.user)) {
        throw new Error('Unauthorized');
      }

      logger.info('Getting quota limits', { userId: request.user.userId });

      const response: QuotaLimitsResponse = {
        youtube: {
          dailyLimit: parseInt(process.env['YOUTUBE_QUOTA_LIMIT'] || '10000', 10),
          quotaCosts: YOUTUBE_QUOTA_COSTS,
        },
        rateLimits: RATE_LIMIT_CONFIGS.map((config) => ({
          endpoint: config.endpoint,
          max: config.max,
          timeWindow: config.timeWindow,
          timeWindowMs: config.timeWindowMs,
        })),
      };

      logger.info('Quota limits retrieved', { userId: request.user.userId });

      return reply.code(200).send({ limits: response });
    }
  );

  fastify.log.info('Quota routes registered');

  done();
};

export default quotaRoutes;
