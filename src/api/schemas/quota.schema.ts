import { z } from 'zod';
import { errorResponseSchema } from './common.schema';

/**
 * Quota API Schemas
 *
 * This file contains schemas for quota usage tracking and rate limiting
 * endpoints.
 */

// ============================================================================
// Quota Usage Schemas
// ============================================================================

/**
 * Zod schema for quota usage response
 */
export const QuotaUsageResponseSchema = z.object({
  date: z.string().datetime().describe('Date of quota usage (ISO 8601)'),
  used: z.number().int().min(0).describe('Quota units used'),
  limit: z.number().int().min(0).describe('Daily quota limit'),
  remaining: z.number().int().min(0).describe('Remaining quota units'),
  percentage: z.number().min(0).max(100).describe('Percentage of quota used'),
  resetAt: z.string().datetime().describe('When quota resets (ISO 8601)'),
});

export type QuotaUsageResponse = z.infer<typeof QuotaUsageResponseSchema>;

/**
 * Fastify schema for quota usage response
 */
export const quotaUsageResponseSchema = {
  type: 'object',
  properties: {
    date: {
      type: 'string',
      format: 'date-time',
      description: 'Date of quota usage (ISO 8601)',
    },
    used: {
      type: 'integer',
      minimum: 0,
      description: 'Quota units used',
    },
    limit: {
      type: 'integer',
      minimum: 0,
      description: 'Daily quota limit',
    },
    remaining: {
      type: 'integer',
      minimum: 0,
      description: 'Remaining quota units',
    },
    percentage: {
      type: 'number',
      minimum: 0,
      maximum: 100,
      description: 'Percentage of quota used',
    },
    resetAt: {
      type: 'string',
      format: 'date-time',
      description: 'When quota resets (ISO 8601)',
    },
  },
  required: ['date', 'used', 'limit', 'remaining', 'percentage', 'resetAt'],
} as const;

// ============================================================================
// Quota Limits Schemas
// ============================================================================

/**
 * Rate limit configuration schema
 */
export const RateLimitConfigSchema = z.object({
  endpoint: z.string().describe('API endpoint pattern'),
  max: z.number().int().min(1).describe('Maximum requests'),
  timeWindow: z.string().describe('Time window (e.g., "1 minute", "1 hour")'),
  timeWindowMs: z.number().int().min(1).describe('Time window in milliseconds'),
});

export type RateLimitConfig = z.infer<typeof RateLimitConfigSchema>;

/**
 * Zod schema for quota limits response
 */
export const QuotaLimitsResponseSchema = z.object({
  youtube: z.object({
    dailyLimit: z.number().int().describe('YouTube API daily quota limit'),
    quotaCosts: z.record(z.number().int()).describe('Operation costs in quota units'),
  }),
  rateLimits: z.array(RateLimitConfigSchema).describe('Rate limit configurations'),
});

export type QuotaLimitsResponse = z.infer<typeof QuotaLimitsResponseSchema>;

/**
 * Fastify schema for rate limit configuration
 */
export const rateLimitConfigSchema = {
  type: 'object',
  properties: {
    endpoint: {
      type: 'string',
      description: 'API endpoint pattern',
      example: '/api/v1/auth/login',
    },
    max: {
      type: 'integer',
      minimum: 1,
      description: 'Maximum requests',
      example: 10,
    },
    timeWindow: {
      type: 'string',
      description: 'Time window (e.g., "1 minute", "1 hour")',
      example: '1 minute',
    },
    timeWindowMs: {
      type: 'integer',
      minimum: 1,
      description: 'Time window in milliseconds',
      example: 60000,
    },
  },
  required: ['endpoint', 'max', 'timeWindow', 'timeWindowMs'],
} as const;

/**
 * Fastify schema for quota limits response
 */
export const quotaLimitsResponseSchema = {
  type: 'object',
  properties: {
    youtube: {
      type: 'object',
      properties: {
        dailyLimit: {
          type: 'integer',
          description: 'YouTube API daily quota limit',
          example: 10000,
        },
        quotaCosts: {
          type: 'object',
          description: 'Operation costs in quota units',
          additionalProperties: {
            type: 'integer',
          },
          example: {
            'playlists.list': 1,
            'playlistItems.list': 1,
            'videos.list': 1,
            'search.list': 100,
          },
        },
      },
      required: ['dailyLimit', 'quotaCosts'],
    },
    rateLimits: {
      type: 'array',
      items: rateLimitConfigSchema,
      description: 'Rate limit configurations',
    },
  },
  required: ['youtube', 'rateLimits'],
} as const;

// ============================================================================
// Route Schemas
// ============================================================================

/**
 * GET /api/v1/quota/usage - Get current quota usage
 */
export const getQuotaUsageSchema = {
  description: 'Get current YouTube API quota usage',
  tags: ['quota'],
  security: [{ bearerAuth: [] }],
  response: {
    200: {
      description: 'Current quota usage',
      type: 'object',
      properties: {
        quota: quotaUsageResponseSchema,
      },
      required: ['quota'],
    },
    401: {
      description: 'Unauthorized',
      ...errorResponseSchema,
    },
    500: {
      description: 'Internal server error',
      ...errorResponseSchema,
    },
  },
} as const;

/**
 * GET /api/v1/quota/limits - Get quota limits
 */
export const getQuotaLimitsSchema = {
  description: 'Get YouTube API quota limits and rate limit configurations',
  tags: ['quota'],
  security: [{ bearerAuth: [] }],
  response: {
    200: {
      description: 'Quota limits and rate limit configurations',
      type: 'object',
      properties: {
        limits: quotaLimitsResponseSchema,
      },
      required: ['limits'],
    },
    401: {
      description: 'Unauthorized',
      ...errorResponseSchema,
    },
    500: {
      description: 'Internal server error',
      ...errorResponseSchema,
    },
  },
} as const;
