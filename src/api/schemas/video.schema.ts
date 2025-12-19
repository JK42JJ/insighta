/**
 * Video API Schemas
 *
 * Validation schemas and OpenAPI documentation for video endpoints
 */

import { z } from 'zod';
import { FastifySchema } from 'fastify';
import { errorResponseSchema } from './common.schema';

// ============================================================================
// Zod Validation Schemas (Runtime)
// ============================================================================

/**
 * List videos query parameters
 */
export const ListVideosQuerySchema = z.object({
  playlistId: z.string().uuid('Invalid playlist ID format').optional(),
  search: z.string().min(1).optional(),
  tags: z.array(z.string()).optional(),
  status: z.enum(['UNWATCHED', 'WATCHING', 'COMPLETED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sortBy: z.enum(['title', 'publishedAt', 'duration', 'viewCount']).optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type ListVideosQuery = z.infer<typeof ListVideosQuerySchema>;

/**
 * Get video params
 */
export const GetVideoParamsSchema = z.object({
  id: z.string().uuid('Invalid video ID format'),
});

export type GetVideoParams = z.infer<typeof GetVideoParamsSchema>;

/**
 * Get captions query parameters
 */
export const GetCaptionsQuerySchema = z.object({
  language: z.string().optional().default('en'),
});

export type GetCaptionsQuery = z.infer<typeof GetCaptionsQuerySchema>;

/**
 * Generate summary request
 */
export const GenerateSummaryRequestSchema = z.object({
  level: z.enum(['brief', 'detailed', 'comprehensive']).optional().default('brief'),
  language: z.string().optional().default('en'),
});

export type GenerateSummaryRequest = z.infer<typeof GenerateSummaryRequestSchema>;

// ============================================================================
// Response Types
// ============================================================================

export interface VideoResponse {
  id: string;
  youtubeId: string;
  title: string;
  description: string | null;
  channelId: string;
  channelTitle: string;
  duration: number;
  thumbnailUrls: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  publishedAt: string;
  tags: string | null;
  categoryId: string | null;
  language: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VideoWithStateResponse extends VideoResponse {
  userState: {
    watchStatus: string;
    lastPosition: number;
    watchCount: number;
    notes: string | null;
    summary: string | null;
    tags: string | null;
    rating: number | null;
    createdAt: string;
    updatedAt: string;
  } | null;
}

export interface ListVideosResponse {
  videos: VideoResponse[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CaptionSegment {
  text: string;
  start: number;
  duration: number;
}

export interface CaptionResponse {
  videoId: string;
  language: string;
  fullText: string;
  segments: CaptionSegment[];
}

export interface AvailableLanguagesResponse {
  videoId: string;
  languages: string[];
}

export interface SummaryResponse {
  videoId: string;
  summary: string;
  level: string;
  language: string;
  generatedAt: string;
}

// ============================================================================
// Fastify OpenAPI Schemas (Documentation)
// ============================================================================

/**
 * Video schema for responses
 */
const videoResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    youtubeId: { type: 'string' },
    title: { type: 'string' },
    description: { type: ['string', 'null'] },
    channelId: { type: 'string' },
    channelTitle: { type: 'string' },
    duration: { type: 'integer', description: 'Duration in seconds' },
    thumbnailUrls: { type: 'string', description: 'JSON string of thumbnail URLs' },
    viewCount: { type: 'integer' },
    likeCount: { type: 'integer' },
    commentCount: { type: 'integer' },
    publishedAt: { type: 'string', format: 'date-time' },
    tags: { type: ['string', 'null'], description: 'JSON string array' },
    categoryId: { type: ['string', 'null'] },
    language: { type: ['string', 'null'] },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'youtubeId', 'title', 'channelId', 'channelTitle', 'duration', 'thumbnailUrls', 'viewCount', 'publishedAt', 'createdAt', 'updatedAt'],
} as const;

/**
 * User video state schema
 */
const userVideoStateSchema = {
  type: 'object',
  properties: {
    watchStatus: { type: 'string', enum: ['UNWATCHED', 'WATCHING', 'COMPLETED'] },
    lastPosition: { type: 'integer', description: 'Last watched position in seconds' },
    watchCount: { type: 'integer' },
    notes: { type: ['string', 'null'] },
    summary: { type: ['string', 'null'] },
    tags: { type: ['string', 'null'], description: 'JSON string array' },
    rating: { type: ['integer', 'null'], minimum: 1, maximum: 5 },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
  required: ['watchStatus', 'lastPosition', 'watchCount', 'createdAt', 'updatedAt'],
} as const;

/**
 * Video with state schema
 */
const videoWithStateResponseSchema = {
  type: 'object',
  properties: {
    ...videoResponseSchema.properties,
    userState: {
      oneOf: [userVideoStateSchema, { type: 'null' }],
    },
  },
  required: [...videoResponseSchema.required, 'userState'],
} as const;

/**
 * Caption segment schema
 */
const captionSegmentSchema = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    start: { type: 'number', description: 'Start time in seconds' },
    duration: { type: 'number', description: 'Duration in seconds' },
  },
  required: ['text', 'start', 'duration'],
} as const;

/**
 * Caption response schema
 */
const captionResponseSchema = {
  type: 'object',
  properties: {
    videoId: { type: 'string' },
    language: { type: 'string' },
    fullText: { type: 'string' },
    segments: {
      type: 'array',
      items: captionSegmentSchema,
    },
  },
  required: ['videoId', 'language', 'fullText', 'segments'],
} as const;

/**
 * GET /api/v1/videos - List videos
 */
export const listVideosSchema: FastifySchema = {
  description: 'List videos with filtering, search, and pagination',
  tags: ['videos'],
  security: [{ bearerAuth: [] }],
  querystring: {
    type: 'object',
    properties: {
      playlistId: { type: 'string', format: 'uuid', description: 'Filter by playlist ID' },
      search: { type: 'string', description: 'Search in title and description' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
      status: { type: 'string', enum: ['UNWATCHED', 'WATCHING', 'COMPLETED'], description: 'Filter by watch status' },
      page: { type: 'integer', minimum: 1, default: 1, description: 'Page number' },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20, description: 'Items per page' },
      sortBy: { type: 'string', enum: ['title', 'publishedAt', 'duration', 'viewCount'], description: 'Sort field' },
      sortOrder: { type: 'string', enum: ['asc', 'desc'], default: 'desc', description: 'Sort order' },
    },
  },
  response: {
    200: {
      description: 'List of videos',
      type: 'object',
      properties: {
        videos: {
          type: 'array',
          items: videoResponseSchema,
        },
        total: { type: 'integer' },
        page: { type: 'integer' },
        limit: { type: 'integer' },
        totalPages: { type: 'integer' },
      },
      required: ['videos', 'total', 'page', 'limit', 'totalPages'],
    },
    401: errorResponseSchema,
    500: errorResponseSchema,
  },
};

/**
 * GET /api/v1/videos/:id - Get video details
 */
export const getVideoSchema: FastifySchema = {
  description: 'Get video details with user state',
  tags: ['videos'],
  security: [{ bearerAuth: [] }],
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid', description: 'Video ID' },
    },
  },
  response: {
    200: {
      description: 'Video details with user state',
      type: 'object',
      properties: {
        video: videoWithStateResponseSchema,
      },
      required: ['video'],
    },
    401: errorResponseSchema,
    404: errorResponseSchema,
    500: errorResponseSchema,
  },
};

/**
 * GET /api/v1/videos/:id/captions - Get captions
 */
export const getCaptionsSchema: FastifySchema = {
  description: 'Get video captions in specified language',
  tags: ['videos'],
  security: [{ bearerAuth: [] }],
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid', description: 'Video ID' },
    },
  },
  querystring: {
    type: 'object',
    properties: {
      language: { type: 'string', default: 'en', description: 'Caption language code (e.g., en, ko, ja)' },
    },
  },
  response: {
    200: {
      description: 'Video captions',
      type: 'object',
      properties: {
        caption: captionResponseSchema,
      },
      required: ['caption'],
    },
    401: errorResponseSchema,
    404: errorResponseSchema,
    500: errorResponseSchema,
  },
};

/**
 * GET /api/v1/videos/:id/captions/languages - Get available caption languages
 */
export const getCaptionLanguagesSchema: FastifySchema = {
  description: 'Get available caption languages for a video',
  tags: ['videos'],
  security: [{ bearerAuth: [] }],
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid', description: 'Video ID' },
    },
  },
  response: {
    200: {
      description: 'Available caption languages',
      type: 'object',
      properties: {
        videoId: { type: 'string' },
        languages: { type: 'array', items: { type: 'string' } },
      },
      required: ['videoId', 'languages'],
    },
    401: errorResponseSchema,
    404: errorResponseSchema,
    500: errorResponseSchema,
  },
};

/**
 * GET /api/v1/videos/:id/summary - Get summary
 */
export const getSummarySchema: FastifySchema = {
  description: 'Get existing video summary',
  tags: ['videos'],
  security: [{ bearerAuth: [] }],
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid', description: 'Video ID' },
    },
  },
  response: {
    200: {
      description: 'Video summary',
      type: 'object',
      properties: {
        summary: {
          type: 'object',
          properties: {
            videoId: { type: 'string' },
            summary: { type: 'string' },
            level: { type: 'string', enum: ['brief', 'detailed', 'comprehensive'] },
            language: { type: 'string' },
            generatedAt: { type: 'string', format: 'date-time' },
          },
          required: ['videoId', 'summary', 'level', 'language', 'generatedAt'],
        },
      },
      required: ['summary'],
    },
    401: errorResponseSchema,
    404: errorResponseSchema,
    500: errorResponseSchema,
  },
};

/**
 * POST /api/v1/videos/:id/summary - Generate summary
 */
export const generateSummarySchema: FastifySchema = {
  description: 'Generate video summary using captions',
  tags: ['videos'],
  security: [{ bearerAuth: [] }],
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid', description: 'Video ID' },
    },
  },
  body: {
    type: 'object',
    properties: {
      level: { type: 'string', enum: ['brief', 'detailed', 'comprehensive'], default: 'brief', description: 'Summary detail level' },
      language: { type: 'string', default: 'en', description: 'Summary language' },
    },
  },
  response: {
    200: {
      description: 'Generated summary',
      type: 'object',
      properties: {
        summary: {
          type: 'object',
          properties: {
            videoId: { type: 'string' },
            summary: { type: 'string' },
            level: { type: 'string', enum: ['brief', 'detailed', 'comprehensive'] },
            language: { type: 'string' },
            generatedAt: { type: 'string', format: 'date-time' },
          },
          required: ['videoId', 'summary', 'level', 'language', 'generatedAt'],
        },
      },
      required: ['summary'],
    },
    401: errorResponseSchema,
    404: errorResponseSchema,
    500: errorResponseSchema,
  },
};
