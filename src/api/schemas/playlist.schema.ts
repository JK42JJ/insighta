/**
 * Playlist API Schemas
 *
 * Validation schemas and OpenAPI documentation for playlist endpoints
 */

import { z } from 'zod';
import { FastifySchema } from 'fastify';
import { errorResponseSchema, successMessageResponseSchema } from './common.schema';

// ============================================================================
// Zod Validation Schemas (Runtime)
// ============================================================================

/**
 * Import playlist request
 */
export const ImportPlaylistRequestSchema = z.object({
  playlistUrl: z
    .string()
    .min(1, 'Playlist URL or ID is required')
    .max(500, 'Playlist URL must be less than 500 characters')
    .trim(),
});

export type ImportPlaylistRequest = z.infer<typeof ImportPlaylistRequestSchema>;

/**
 * List playlists query parameters
 */
export const ListPlaylistsQuerySchema = z.object({
  filter: z.string().optional(),
  sortBy: z.enum(['title', 'lastSyncedAt', 'createdAt']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export type ListPlaylistsQuery = z.infer<typeof ListPlaylistsQuerySchema>;

/**
 * Get playlist params
 */
export const GetPlaylistParamsSchema = z.object({
  id: z.string().uuid('Invalid playlist ID format'),
});

export type GetPlaylistParams = z.infer<typeof GetPlaylistParamsSchema>;

/**
 * Sync playlist params
 */
export const SyncPlaylistParamsSchema = z.object({
  id: z.string().uuid('Invalid playlist ID format'),
});

export type SyncPlaylistParams = z.infer<typeof SyncPlaylistParamsSchema>;

/**
 * Delete playlist params
 */
export const DeletePlaylistParamsSchema = z.object({
  id: z.string().uuid('Invalid playlist ID format'),
});

export type DeletePlaylistParams = z.infer<typeof DeletePlaylistParamsSchema>;

// ============================================================================
// Response Types
// ============================================================================

export interface PlaylistResponse {
  id: string;
  youtubeId: string;
  title: string;
  description: string | null;
  channelId: string;
  channelTitle: string;
  thumbnailUrl: string | null;
  itemCount: number;
  syncStatus: string;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistWithItemsResponse extends PlaylistResponse {
  items: Array<{
    id: string;
    position: number;
    addedAt: string;
    video: {
      id: string;
      youtubeId: string;
      title: string;
      description: string | null;
      channelTitle: string;
      duration: number;
      thumbnailUrls: string;
      viewCount: number;
      publishedAt: string;
    };
  }>;
}

export interface ListPlaylistsResponse {
  playlists: PlaylistResponse[];
  total: number;
  limit?: number;
  offset?: number;
}

export interface SyncResultResponse {
  playlistId: string;
  status: string;
  itemsAdded: number;
  itemsRemoved: number;
  itemsReordered: number;
  duration: number;
  quotaUsed: number;
  error?: string;
}

// ============================================================================
// Fastify OpenAPI Schemas (Documentation)
// ============================================================================

/**
 * Playlist schema for responses
 */
const playlistResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    youtubeId: { type: 'string' },
    title: { type: 'string' },
    description: { type: ['string', 'null'] },
    channelId: { type: 'string' },
    channelTitle: { type: 'string' },
    thumbnailUrl: { type: ['string', 'null'] },
    itemCount: { type: 'integer' },
    syncStatus: { type: 'string', enum: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED'] },
    lastSyncedAt: { type: ['string', 'null'], format: 'date-time' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'youtubeId', 'title', 'channelId', 'channelTitle', 'itemCount', 'syncStatus', 'createdAt', 'updatedAt'],
} as const;

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
    channelTitle: { type: 'string' },
    duration: { type: 'integer' },
    thumbnailUrls: { type: 'string' },
    viewCount: { type: 'integer' },
    publishedAt: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'youtubeId', 'title', 'channelTitle', 'duration', 'thumbnailUrls', 'viewCount', 'publishedAt'],
} as const;

/**
 * Playlist item schema for responses
 */
const playlistItemResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    position: { type: 'integer' },
    addedAt: { type: 'string', format: 'date-time' },
    video: videoResponseSchema,
  },
  required: ['id', 'position', 'addedAt', 'video'],
} as const;

/**
 * Playlist with items schema for responses
 */
const playlistWithItemsResponseSchema = {
  type: 'object',
  properties: {
    ...playlistResponseSchema.properties,
    items: {
      type: 'array',
      items: playlistItemResponseSchema,
    },
  },
  required: [...playlistResponseSchema.required, 'items'],
};

/**
 * Sync result schema for responses
 */
const syncResultResponseSchema = {
  type: 'object',
  properties: {
    playlistId: { type: 'string', format: 'uuid' },
    status: { type: 'string' },
    itemsAdded: { type: 'integer' },
    itemsRemoved: { type: 'integer' },
    itemsReordered: { type: 'integer' },
    duration: { type: 'integer' },
    quotaUsed: { type: 'integer' },
    error: { type: 'string' },
  },
  required: ['playlistId', 'status', 'itemsAdded', 'itemsRemoved', 'itemsReordered', 'duration', 'quotaUsed'],
} as const;

/**
 * POST /api/v1/playlists/import - Import playlist
 */
export const importPlaylistSchema: FastifySchema = {
  description: 'Import a YouTube playlist by URL or ID',
  tags: ['playlists'],
  security: [{ bearerAuth: [] }],
  body: {
    type: 'object',
    required: ['playlistUrl'],
    properties: {
      playlistUrl: {
        type: 'string',
        description: 'YouTube playlist URL or playlist ID',
        minLength: 1,
        maxLength: 500,
      },
    },
  },
  response: {
    200: {
      description: 'Playlist imported successfully',
      type: 'object',
      properties: {
        playlist: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            youtubeId: { type: 'string' },
            title: { type: 'string' },
            description: { type: ['string', 'null'] },
            channelId: { type: 'string' },
            channelTitle: { type: 'string' },
            thumbnailUrl: { type: ['string', 'null'] },
            itemCount: { type: 'integer' },
            syncStatus: { type: 'string', enum: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED'] },
            lastSyncedAt: { type: ['string', 'null'], format: 'date-time' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
          required: ['id', 'youtubeId', 'title', 'channelId', 'channelTitle', 'itemCount', 'syncStatus', 'createdAt', 'updatedAt'],
        },
      },
      required: ['playlist'],
    },
    400: errorResponseSchema,
    401: errorResponseSchema,
    500: errorResponseSchema,
  },
};

/**
 * GET /api/v1/playlists - List playlists
 */
export const listPlaylistsSchema: FastifySchema = {
  description: 'List all playlists with optional filtering and pagination',
  tags: ['playlists'],
  security: [{ bearerAuth: [] }],
  querystring: {
    type: 'object',
    properties: {
      filter: {
        type: 'string',
        description: 'Filter by title or channel name (case-insensitive)',
      },
      sortBy: {
        type: 'string',
        enum: ['title', 'lastSyncedAt', 'createdAt'],
        description: 'Sort by field',
      },
      sortOrder: {
        type: 'string',
        enum: ['asc', 'desc'],
        description: 'Sort order',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 100,
        description: 'Maximum number of results',
      },
      offset: {
        type: 'integer',
        minimum: 0,
        description: 'Number of results to skip',
      },
    },
  },
  response: {
    200: {
      description: 'List of playlists',
      type: 'object',
      properties: {
        playlists: {
          type: 'array',
          items: playlistResponseSchema,
        },
        total: { type: 'integer' },
        limit: { type: 'integer' },
        offset: { type: 'integer' },
      },
      required: ['playlists', 'total'],
    },
    401: errorResponseSchema,
    500: errorResponseSchema,
  },
};

/**
 * GET /api/v1/playlists/:id - Get playlist details
 */
export const getPlaylistSchema: FastifySchema = {
  description: 'Get playlist details with items and videos',
  tags: ['playlists'],
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
      description: 'Playlist details with items',
      type: 'object',
      properties: {
        playlist: playlistWithItemsResponseSchema,
      },
      required: ['playlist'],
    },
    401: errorResponseSchema,
    404: errorResponseSchema,
    500: errorResponseSchema,
  },
};

/**
 * POST /api/v1/playlists/:id/sync - Sync playlist
 */
export const syncPlaylistSchema: FastifySchema = {
  description: 'Trigger synchronization of playlist with YouTube',
  tags: ['playlists'],
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
      description: 'Sync completed successfully',
      type: 'object',
      properties: {
        result: syncResultResponseSchema,
      },
      required: ['result'],
    },
    401: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema,
    500: errorResponseSchema,
  },
};

/**
 * DELETE /api/v1/playlists/:id - Delete playlist
 */
export const deletePlaylistSchema: FastifySchema = {
  description: 'Delete a playlist and all its items',
  tags: ['playlists'],
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
    200: successMessageResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema,
    500: errorResponseSchema,
  },
};
