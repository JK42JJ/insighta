/**
 * Sync API Schemas
 *
 * Validation schemas and OpenAPI documentation for sync endpoints
 */

import { z } from 'zod';
import { FastifySchema } from 'fastify';
import { errorResponseSchema, successMessageResponseSchema } from './common.schema';

// ============================================================================
// Zod Validation Schemas (Runtime)
// ============================================================================

/**
 * Get playlist sync status params
 */
export const GetSyncStatusParamsSchema = z.object({
  playlistId: z.string().uuid('Invalid playlist ID format'),
});

export type GetSyncStatusParams = z.infer<typeof GetSyncStatusParamsSchema>;

/**
 * Get sync history query
 */
export const GetSyncHistoryQuerySchema = z.object({
  playlistId: z.string().uuid().optional(),
  status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type GetSyncHistoryQuery = z.infer<typeof GetSyncHistoryQuerySchema>;

/**
 * Get sync details params
 */
export const GetSyncDetailsParamsSchema = z.object({
  syncId: z.string().uuid('Invalid sync ID format'),
});

export type GetSyncDetailsParams = z.infer<typeof GetSyncDetailsParamsSchema>;

/**
 * Create schedule request
 */
export const CreateScheduleRequestSchema = z.object({
  playlistId: z.string().uuid('Invalid playlist ID format'),
  interval: z.number().int().min(60000, 'Interval must be at least 1 minute (60000ms)'),
  enabled: z.boolean().default(true),
});

export type CreateScheduleRequest = z.infer<typeof CreateScheduleRequestSchema>;

/**
 * Update schedule params
 */
export const UpdateScheduleParamsSchema = z.object({
  id: z.string().uuid('Invalid schedule ID format'),
});

export type UpdateScheduleParams = z.infer<typeof UpdateScheduleParamsSchema>;

/**
 * Update schedule request
 */
export const UpdateScheduleRequestSchema = z.object({
  interval: z.number().int().min(60000).optional(),
  enabled: z.boolean().optional(),
});

export type UpdateScheduleRequest = z.infer<typeof UpdateScheduleRequestSchema>;

/**
 * Delete schedule params
 */
export const DeleteScheduleParamsSchema = z.object({
  id: z.string().uuid('Invalid schedule ID format'),
});

export type DeleteScheduleParams = z.infer<typeof DeleteScheduleParamsSchema>;

// ============================================================================
// Response Types
// ============================================================================

export interface SyncStatusResponse {
  playlistId: string;
  status: string;
  lastSyncedAt: string | null;
  itemCount: number;
  isRunning: boolean;
}

export interface SyncHistoryItemResponse {
  id: string;
  playlistId: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  duration: number | null;
  itemsAdded: number;
  itemsRemoved: number;
  itemsReordered: number;
  quotaUsed: number;
  errorMessage: string | null;
}

export interface SyncHistoryResponse {
  history: SyncHistoryItemResponse[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface SyncDetailsResponse {
  id: string;
  playlistId: string;
  playlistTitle: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  duration: number | null;
  itemsAdded: number;
  itemsRemoved: number;
  itemsReordered: number;
  quotaUsed: number;
  errorMessage: string | null;
}

export interface ScheduleResponse {
  id: string;
  playlistId: string;
  interval: number;
  enabled: boolean;
  lastRun: string | null;
  nextRun: string;
  retryCount: number;
  maxRetries: number;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Fastify OpenAPI Schemas (Documentation)
// ============================================================================

/**
 * Sync status schema for responses
 */
const syncStatusResponseSchema = {
  type: 'object',
  properties: {
    playlistId: { type: 'string', format: 'uuid' },
    status: { type: 'string', enum: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED'] },
    lastSyncedAt: { type: ['string', 'null'], format: 'date-time' },
    itemCount: { type: 'integer' },
    isRunning: { type: 'boolean', description: 'Whether sync is currently in progress' },
  },
  required: ['playlistId', 'status', 'itemCount', 'isRunning'],
} as const;

/**
 * Sync history item schema
 */
const syncHistoryItemResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    playlistId: { type: 'string', format: 'uuid' },
    status: { type: 'string', enum: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED'] },
    startedAt: { type: 'string', format: 'date-time' },
    completedAt: { type: ['string', 'null'], format: 'date-time' },
    duration: { type: ['integer', 'null'], description: 'Duration in milliseconds' },
    itemsAdded: { type: 'integer' },
    itemsRemoved: { type: 'integer' },
    itemsReordered: { type: 'integer' },
    quotaUsed: { type: 'integer' },
    errorMessage: { type: ['string', 'null'] },
  },
  required: ['id', 'playlistId', 'status', 'startedAt', 'itemsAdded', 'itemsRemoved', 'itemsReordered', 'quotaUsed'],
} as const;

/**
 * Schedule schema for responses
 */
const scheduleResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    playlistId: { type: 'string', format: 'uuid' },
    interval: { type: 'integer', description: 'Interval in milliseconds' },
    enabled: { type: 'boolean' },
    lastRun: { type: ['string', 'null'], format: 'date-time' },
    nextRun: { type: 'string', format: 'date-time' },
    retryCount: { type: 'integer' },
    maxRetries: { type: 'integer' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'playlistId', 'interval', 'enabled', 'nextRun', 'retryCount', 'maxRetries', 'createdAt', 'updatedAt'],
} as const;

/**
 * GET /api/v1/sync/status - All sync statuses
 */
export const getSyncStatusesSchema: FastifySchema = {
  description: 'Get sync status for all playlists',
  tags: ['sync'],
  security: [{ bearerAuth: [] }],
  response: {
    200: {
      description: 'List of sync statuses',
      type: 'object',
      properties: {
        statuses: {
          type: 'array',
          items: syncStatusResponseSchema,
        },
      },
      required: ['statuses'],
    },
    401: errorResponseSchema,
    500: errorResponseSchema,
  },
};

/**
 * GET /api/v1/sync/status/:playlistId - Playlist sync status
 */
export const getPlaylistSyncStatusSchema: FastifySchema = {
  description: 'Get sync status for a specific playlist',
  tags: ['sync'],
  security: [{ bearerAuth: [] }],
  params: {
    type: 'object',
    required: ['playlistId'],
    properties: {
      playlistId: {
        type: 'string',
        format: 'uuid',
        description: 'Playlist ID',
      },
    },
  },
  response: {
    200: {
      description: 'Playlist sync status',
      type: 'object',
      properties: {
        status: syncStatusResponseSchema,
      },
      required: ['status'],
    },
    401: errorResponseSchema,
    404: errorResponseSchema,
    500: errorResponseSchema,
  },
};

/**
 * GET /api/v1/sync/history - Sync history
 */
export const getSyncHistorySchema: FastifySchema = {
  description: 'Get sync history with filters and pagination',
  tags: ['sync'],
  security: [{ bearerAuth: [] }],
  querystring: {
    type: 'object',
    properties: {
      playlistId: {
        type: 'string',
        format: 'uuid',
        description: 'Filter by playlist ID',
      },
      status: {
        type: 'string',
        enum: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED'],
        description: 'Filter by status',
      },
      page: {
        type: 'integer',
        minimum: 1,
        default: 1,
        description: 'Page number',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 100,
        default: 20,
        description: 'Items per page',
      },
    },
  },
  response: {
    200: {
      description: 'Sync history',
      type: 'object',
      properties: {
        history: {
          type: 'array',
          items: syncHistoryItemResponseSchema,
        },
        total: { type: 'integer' },
        page: { type: 'integer' },
        limit: { type: 'integer' },
        totalPages: { type: 'integer' },
      },
      required: ['history', 'total', 'page', 'limit', 'totalPages'],
    },
    401: errorResponseSchema,
    500: errorResponseSchema,
  },
};

/**
 * GET /api/v1/sync/history/:syncId - Sync details
 */
export const getSyncDetailsSchema: FastifySchema = {
  description: 'Get details for a specific sync',
  tags: ['sync'],
  security: [{ bearerAuth: [] }],
  params: {
    type: 'object',
    required: ['syncId'],
    properties: {
      syncId: {
        type: 'string',
        format: 'uuid',
        description: 'Sync history ID',
      },
    },
  },
  response: {
    200: {
      description: 'Sync details',
      type: 'object',
      properties: {
        sync: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            playlistId: { type: 'string', format: 'uuid' },
            playlistTitle: { type: 'string' },
            status: { type: 'string', enum: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED'] },
            startedAt: { type: 'string', format: 'date-time' },
            completedAt: { type: ['string', 'null'], format: 'date-time' },
            duration: { type: ['integer', 'null'], description: 'Duration in milliseconds' },
            itemsAdded: { type: 'integer' },
            itemsRemoved: { type: 'integer' },
            itemsReordered: { type: 'integer' },
            quotaUsed: { type: 'integer' },
            errorMessage: { type: ['string', 'null'] },
          },
          required: ['id', 'playlistId', 'playlistTitle', 'status', 'startedAt', 'itemsAdded', 'itemsRemoved', 'itemsReordered', 'quotaUsed'],
        },
      },
      required: ['sync'],
    },
    401: errorResponseSchema,
    404: errorResponseSchema,
    500: errorResponseSchema,
  },
};

/**
 * GET /api/v1/sync/schedule - List schedules
 */
export const getSchedulesSchema: FastifySchema = {
  description: 'List all sync schedules',
  tags: ['sync'],
  security: [{ bearerAuth: [] }],
  response: {
    200: {
      description: 'List of schedules',
      type: 'object',
      properties: {
        schedules: {
          type: 'array',
          items: scheduleResponseSchema,
        },
      },
      required: ['schedules'],
    },
    401: errorResponseSchema,
    500: errorResponseSchema,
  },
};

/**
 * POST /api/v1/sync/schedule - Create schedule
 */
export const createScheduleSchema: FastifySchema = {
  description: 'Create a sync schedule',
  tags: ['sync'],
  security: [{ bearerAuth: [] }],
  body: {
    type: 'object',
    required: ['playlistId', 'interval'],
    properties: {
      playlistId: {
        type: 'string',
        format: 'uuid',
        description: 'Playlist ID',
      },
      interval: {
        type: 'integer',
        minimum: 60000,
        description: 'Interval in milliseconds (minimum 1 minute)',
      },
      enabled: {
        type: 'boolean',
        default: true,
        description: 'Whether schedule is enabled',
      },
    },
  },
  response: {
    200: {
      description: 'Schedule created successfully',
      type: 'object',
      properties: {
        schedule: scheduleResponseSchema,
      },
      required: ['schedule'],
    },
    400: errorResponseSchema,
    401: errorResponseSchema,
    409: errorResponseSchema,
    500: errorResponseSchema,
  },
};

/**
 * PATCH /api/v1/sync/schedule/:id - Update schedule
 */
export const updateScheduleSchema: FastifySchema = {
  description: 'Update a sync schedule',
  tags: ['sync'],
  security: [{ bearerAuth: [] }],
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: {
        type: 'string',
        format: 'uuid',
        description: 'Schedule ID (playlist ID)',
      },
    },
  },
  body: {
    type: 'object',
    properties: {
      interval: {
        type: 'integer',
        minimum: 60000,
        description: 'Interval in milliseconds',
      },
      enabled: {
        type: 'boolean',
        description: 'Whether schedule is enabled',
      },
    },
  },
  response: {
    200: {
      description: 'Schedule updated successfully',
      type: 'object',
      properties: {
        schedule: scheduleResponseSchema,
      },
      required: ['schedule'],
    },
    400: errorResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema,
    500: errorResponseSchema,
  },
};

/**
 * DELETE /api/v1/sync/schedule/:id - Delete schedule
 */
export const deleteScheduleSchema: FastifySchema = {
  description: 'Delete a sync schedule',
  tags: ['sync'],
  security: [{ bearerAuth: [] }],
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: {
        type: 'string',
        format: 'uuid',
        description: 'Schedule ID (playlist ID)',
      },
    },
  },
  response: {
    200: successMessageResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema,
    500: errorResponseSchema,
  },
};
