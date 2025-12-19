/**
 * Analytics API Schemas
 *
 * Validation schemas and OpenAPI documentation for analytics endpoints
 */

import { z } from 'zod';
import { FastifySchema } from 'fastify';
import { errorResponseSchema } from './common.schema';

// ============================================================================
// Zod Validation Schemas (Runtime)
// ============================================================================

/**
 * Get video analytics params
 */
export const GetVideoAnalyticsParamsSchema = z.object({
  id: z.string().min(1, 'Video ID is required'),
});

export type GetVideoAnalyticsParams = z.infer<typeof GetVideoAnalyticsParamsSchema>;

/**
 * Get playlist analytics params
 */
export const GetPlaylistAnalyticsParamsSchema = z.object({
  id: z.string().uuid('Invalid playlist ID format'),
});

export type GetPlaylistAnalyticsParams = z.infer<typeof GetPlaylistAnalyticsParamsSchema>;

/**
 * Record watch session request
 */
export const RecordSessionRequestSchema = z.object({
  videoId: z.string().min(1, 'Video ID is required'),
  startPosition: z.number().int().min(0, 'Start position must be non-negative'),
  endPosition: z.number().int().min(0, 'End position must be non-negative'),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
});

export type RecordSessionRequest = z.infer<typeof RecordSessionRequestSchema>;

// ============================================================================
// Response Types
// ============================================================================

export interface VideoAnalyticsResponse {
  videoId: string;
  videoTitle: string;
  totalDuration: number;
  totalWatchTime: number;
  completionPercentage: number;
  watchCount: number;
  lastWatchedAt: string | null;
  firstWatchedAt: string | null;
  averageSessionDuration: number;
  rewatchCount: number;
}

export interface PlaylistAnalyticsResponse {
  playlistId: string;
  playlistTitle: string;
  totalVideos: number;
  watchedVideos: number;
  completedVideos: number;
  totalWatchTime: number;
  averageCompletion: number;
  lastActivity: string | null;
}

export interface RecentActivityResponse {
  videoId: string;
  videoTitle: string;
  watchedAt: string;
  duration: number;
  progress: number;
}

export interface TopVideoResponse {
  videoId: string;
  videoTitle: string;
  watchTime: number;
  sessionCount: number;
  completionRate: number;
}

export interface LearningStreakResponse {
  currentStreak: number;
  longestStreak: number;
  lastActiveDate: string | null;
}

export interface DashboardResponse {
  totalVideos: number;
  totalWatchTime: number;
  totalSessions: number;
  averageSessionDuration: number;
  completedVideos: number;
  inProgressVideos: number;
  notStartedVideos: number;
  recentActivity: RecentActivityResponse[];
  topVideos: TopVideoResponse[];
  learningStreak: LearningStreakResponse;
}

export interface WatchSessionResponse {
  id: string;
  videoId: string;
  startedAt: string;
  endedAt: string;
  startPos: number;
  endPos: number;
  duration: number;
  createdAt: string;
}

// ============================================================================
// Fastify OpenAPI Schemas (Documentation)
// ============================================================================

/**
 * Video analytics schema for responses
 */
const videoAnalyticsResponseSchema = {
  type: 'object',
  properties: {
    videoId: { type: 'string' },
    videoTitle: { type: 'string' },
    totalDuration: { type: 'integer', description: 'Video duration in seconds' },
    totalWatchTime: { type: 'integer', description: 'Total time spent watching (all sessions) in seconds' },
    completionPercentage: { type: 'number', description: 'Completion percentage (0-100)' },
    watchCount: { type: 'integer', description: 'Number of watch sessions' },
    lastWatchedAt: { type: ['string', 'null'], format: 'date-time' },
    firstWatchedAt: { type: ['string', 'null'], format: 'date-time' },
    averageSessionDuration: { type: 'integer', description: 'Average session duration in seconds' },
    rewatchCount: { type: 'integer', description: 'Sessions after first complete watch' },
  },
  required: [
    'videoId',
    'videoTitle',
    'totalDuration',
    'totalWatchTime',
    'completionPercentage',
    'watchCount',
    'averageSessionDuration',
    'rewatchCount',
  ],
} as const;

/**
 * Playlist analytics schema for responses
 */
const playlistAnalyticsResponseSchema = {
  type: 'object',
  properties: {
    playlistId: { type: 'string' },
    playlistTitle: { type: 'string' },
    totalVideos: { type: 'integer' },
    watchedVideos: { type: 'integer', description: 'Videos with at least one session' },
    completedVideos: { type: 'integer', description: 'Videos with >=80% completion' },
    totalWatchTime: { type: 'integer', description: 'Sum of all watch sessions in seconds' },
    averageCompletion: { type: 'number', description: 'Average completion across all videos (0-100)' },
    lastActivity: { type: ['string', 'null'], format: 'date-time' },
  },
  required: [
    'playlistId',
    'playlistTitle',
    'totalVideos',
    'watchedVideos',
    'completedVideos',
    'totalWatchTime',
    'averageCompletion',
  ],
} as const;

/**
 * Recent activity schema
 */
const recentActivityResponseSchema = {
  type: 'object',
  properties: {
    videoId: { type: 'string' },
    videoTitle: { type: 'string' },
    watchedAt: { type: 'string', format: 'date-time' },
    duration: { type: 'integer', description: 'Session duration in seconds' },
    progress: { type: 'number', description: 'Progress percentage (0-100)' },
  },
  required: ['videoId', 'videoTitle', 'watchedAt', 'duration', 'progress'],
} as const;

/**
 * Top video schema
 */
const topVideoResponseSchema = {
  type: 'object',
  properties: {
    videoId: { type: 'string' },
    videoTitle: { type: 'string' },
    watchTime: { type: 'integer', description: 'Total watch time in seconds' },
    sessionCount: { type: 'integer' },
    completionRate: { type: 'number', description: 'Completion rate (0-100)' },
  },
  required: ['videoId', 'videoTitle', 'watchTime', 'sessionCount', 'completionRate'],
} as const;

/**
 * Learning streak schema
 */
const learningStreakResponseSchema = {
  type: 'object',
  properties: {
    currentStreak: { type: 'integer', description: 'Consecutive days' },
    longestStreak: { type: 'integer', description: 'Longest consecutive days' },
    lastActiveDate: { type: ['string', 'null'], format: 'date-time' },
  },
  required: ['currentStreak', 'longestStreak'],
} as const;

/**
 * Watch session schema
 */
const watchSessionResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    videoId: { type: 'string' },
    startedAt: { type: 'string', format: 'date-time' },
    endedAt: { type: 'string', format: 'date-time' },
    startPos: { type: 'integer', description: 'Start position in seconds' },
    endPos: { type: 'integer', description: 'End position in seconds' },
    duration: { type: 'integer', description: 'Actual watch duration in seconds' },
    createdAt: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'videoId', 'startedAt', 'endedAt', 'startPos', 'endPos', 'duration', 'createdAt'],
} as const;

/**
 * GET /api/v1/analytics/dashboard - Learning dashboard
 */
export const getDashboardSchema: FastifySchema = {
  description: 'Get learning dashboard with overall statistics',
  tags: ['analytics'],
  security: [{ bearerAuth: [] }],
  response: {
    200: {
      description: 'Dashboard data',
      type: 'object',
      properties: {
        dashboard: {
          type: 'object',
          properties: {
            totalVideos: { type: 'integer' },
            totalWatchTime: { type: 'integer', description: 'Total watch time in seconds' },
            totalSessions: { type: 'integer' },
            averageSessionDuration: { type: 'integer', description: 'Average session duration in seconds' },
            completedVideos: { type: 'integer' },
            inProgressVideos: { type: 'integer' },
            notStartedVideos: { type: 'integer' },
            recentActivity: {
              type: 'array',
              items: recentActivityResponseSchema,
            },
            topVideos: {
              type: 'array',
              items: topVideoResponseSchema,
            },
            learningStreak: learningStreakResponseSchema,
          },
          required: [
            'totalVideos',
            'totalWatchTime',
            'totalSessions',
            'averageSessionDuration',
            'completedVideos',
            'inProgressVideos',
            'notStartedVideos',
            'recentActivity',
            'topVideos',
            'learningStreak',
          ],
        },
      },
      required: ['dashboard'],
    },
    401: errorResponseSchema,
    500: errorResponseSchema,
  },
};

/**
 * GET /api/v1/analytics/videos/:id - Video analytics
 */
export const getVideoAnalyticsSchema: FastifySchema = {
  description: 'Get analytics for a specific video',
  tags: ['analytics'],
  security: [{ bearerAuth: [] }],
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: {
        type: 'string',
        description: 'YouTube video ID',
      },
    },
  },
  response: {
    200: {
      description: 'Video analytics data',
      type: 'object',
      properties: {
        analytics: videoAnalyticsResponseSchema,
      },
      required: ['analytics'],
    },
    401: errorResponseSchema,
    404: errorResponseSchema,
    500: errorResponseSchema,
  },
};

/**
 * GET /api/v1/analytics/playlists/:id - Playlist analytics
 */
export const getPlaylistAnalyticsSchema: FastifySchema = {
  description: 'Get analytics for a specific playlist',
  tags: ['analytics'],
  security: [{ bearerAuth: [] }],
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: {
        type: 'string',
        format: 'uuid',
        description: 'Playlist ID',
      },
    },
  },
  response: {
    200: {
      description: 'Playlist analytics data',
      type: 'object',
      properties: {
        analytics: playlistAnalyticsResponseSchema,
      },
      required: ['analytics'],
    },
    401: errorResponseSchema,
    404: errorResponseSchema,
    500: errorResponseSchema,
  },
};

/**
 * POST /api/v1/analytics/sessions - Record watch session
 */
export const recordSessionSchema: FastifySchema = {
  description: 'Record a watch session',
  tags: ['analytics'],
  security: [{ bearerAuth: [] }],
  body: {
    type: 'object',
    required: ['videoId', 'startPosition', 'endPosition'],
    properties: {
      videoId: {
        type: 'string',
        description: 'YouTube video ID',
        minLength: 1,
      },
      startPosition: {
        type: 'integer',
        minimum: 0,
        description: 'Start position in seconds',
      },
      endPosition: {
        type: 'integer',
        minimum: 0,
        description: 'End position in seconds',
      },
      startTime: {
        type: 'string',
        format: 'date-time',
        description: 'Session start time (ISO 8601)',
      },
      endTime: {
        type: 'string',
        format: 'date-time',
        description: 'Session end time (ISO 8601)',
      },
    },
  },
  response: {
    200: {
      description: 'Session recorded successfully',
      type: 'object',
      properties: {
        session: watchSessionResponseSchema,
      },
      required: ['session'],
    },
    400: errorResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema,
    500: errorResponseSchema,
  },
};
