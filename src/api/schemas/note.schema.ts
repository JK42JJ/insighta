/**
 * Note API Schemas
 *
 * Validation schemas and OpenAPI documentation for note endpoints
 */

import { z } from 'zod';
import { FastifySchema } from 'fastify';
import { errorResponseSchema, successMessageResponseSchema } from './common.schema';

// ============================================================================
// Zod Validation Schemas (Runtime)
// ============================================================================

/**
 * Get video notes params
 */
export const GetVideoNotesParamsSchema = z.object({
  id: z.string().uuid('Invalid video ID format'),
});

export type GetVideoNotesParams = z.infer<typeof GetVideoNotesParamsSchema>;

/**
 * Get video notes query parameters
 */
export const GetVideoNotesQuerySchema = z.object({
  tags: z.array(z.string()).optional(),
  timestampStart: z.coerce.number().int().min(0).optional(),
  timestampEnd: z.coerce.number().int().min(0).optional(),
});

export type GetVideoNotesQuery = z.infer<typeof GetVideoNotesQuerySchema>;

/**
 * Create note request
 */
export const CreateNoteRequestSchema = z.object({
  timestamp: z.number().int().min(0, 'Timestamp must be non-negative'),
  content: z.string().min(1, 'Content is required').max(5000, 'Content must be less than 5000 characters'),
  tags: z.array(z.string()).optional(),
});

export type CreateNoteRequest = z.infer<typeof CreateNoteRequestSchema>;

/**
 * Get note params
 */
export const GetNoteParamsSchema = z.object({
  noteId: z.string().uuid('Invalid note ID format'),
});

export type GetNoteParams = z.infer<typeof GetNoteParamsSchema>;

/**
 * Update note request
 */
export const UpdateNoteRequestSchema = z.object({
  content: z.string().min(1).max(5000).optional(),
  tags: z.array(z.string()).optional(),
  timestamp: z.number().int().min(0).optional(),
});

export type UpdateNoteRequest = z.infer<typeof UpdateNoteRequestSchema>;

/**
 * Delete note params
 */
export const DeleteNoteParamsSchema = z.object({
  noteId: z.string().uuid('Invalid note ID format'),
});

export type DeleteNoteParams = z.infer<typeof DeleteNoteParamsSchema>;

/**
 * Export notes query parameters
 */
export const ExportNotesQuerySchema = z.object({
  videoId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  format: z.enum(['markdown', 'json', 'csv']).default('markdown'),
});

export type ExportNotesQuery = z.infer<typeof ExportNotesQuerySchema>;

// ============================================================================
// Response Types
// ============================================================================

export interface NoteResponse {
  id: string;
  videoId: string;
  timestamp: number;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ListNotesResponse {
  notes: NoteResponse[];
  total: number;
}

export interface ExportNotesResponse {
  content: string;
  format: string;
}

// ============================================================================
// Fastify OpenAPI Schemas (Documentation)
// ============================================================================

/**
 * Note schema for responses
 */
const noteResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    videoId: { type: 'string', format: 'uuid' },
    timestamp: { type: 'integer', description: 'Timestamp in seconds' },
    content: { type: 'string', description: 'Markdown content' },
    tags: { type: 'array', items: { type: 'string' } },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'videoId', 'timestamp', 'content', 'tags', 'createdAt', 'updatedAt'],
} as const;

/**
 * GET /api/v1/videos/:id/notes - List notes for video
 */
export const listVideoNotesSchema: FastifySchema = {
  description: 'List all notes for a video with optional filtering',
  tags: ['notes'],
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
      tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
      timestampStart: { type: 'integer', minimum: 0, description: 'Filter by start timestamp (seconds)' },
      timestampEnd: { type: 'integer', minimum: 0, description: 'Filter by end timestamp (seconds)' },
    },
  },
  response: {
    200: {
      description: 'List of notes',
      type: 'object',
      properties: {
        notes: {
          type: 'array',
          items: noteResponseSchema,
        },
        total: { type: 'integer' },
      },
      required: ['notes', 'total'],
    },
    401: errorResponseSchema,
    404: errorResponseSchema,
    500: errorResponseSchema,
  },
};

/**
 * POST /api/v1/videos/:id/notes - Create note
 */
export const createNoteSchema: FastifySchema = {
  description: 'Create a new note for a video',
  tags: ['notes'],
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
    required: ['timestamp', 'content'],
    properties: {
      timestamp: { type: 'integer', minimum: 0, description: 'Timestamp in seconds' },
      content: { type: 'string', minLength: 1, maxLength: 5000, description: 'Note content (Markdown)' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' },
    },
  },
  response: {
    200: {
      description: 'Created note',
      type: 'object',
      properties: {
        note: noteResponseSchema,
      },
      required: ['note'],
    },
    400: errorResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema,
    500: errorResponseSchema,
  },
};

/**
 * GET /api/v1/notes/:noteId - Get specific note
 */
export const getNoteSchema: FastifySchema = {
  description: 'Get a specific note by ID',
  tags: ['notes'],
  security: [{ bearerAuth: [] }],
  params: {
    type: 'object',
    required: ['noteId'],
    properties: {
      noteId: { type: 'string', format: 'uuid', description: 'Note ID' },
    },
  },
  response: {
    200: {
      description: 'Note details',
      type: 'object',
      properties: {
        note: noteResponseSchema,
      },
      required: ['note'],
    },
    401: errorResponseSchema,
    404: errorResponseSchema,
    500: errorResponseSchema,
  },
};

/**
 * PATCH /api/v1/notes/:noteId - Update note
 */
export const updateNoteSchema: FastifySchema = {
  description: 'Update an existing note',
  tags: ['notes'],
  security: [{ bearerAuth: [] }],
  params: {
    type: 'object',
    required: ['noteId'],
    properties: {
      noteId: { type: 'string', format: 'uuid', description: 'Note ID' },
    },
  },
  body: {
    type: 'object',
    properties: {
      content: { type: 'string', minLength: 1, maxLength: 5000, description: 'Note content (Markdown)' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' },
      timestamp: { type: 'integer', minimum: 0, description: 'Timestamp in seconds' },
    },
  },
  response: {
    200: {
      description: 'Updated note',
      type: 'object',
      properties: {
        note: noteResponseSchema,
      },
      required: ['note'],
    },
    400: errorResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema,
    500: errorResponseSchema,
  },
};

/**
 * DELETE /api/v1/notes/:noteId - Delete note
 */
export const deleteNoteSchema: FastifySchema = {
  description: 'Delete a note',
  tags: ['notes'],
  security: [{ bearerAuth: [] }],
  params: {
    type: 'object',
    required: ['noteId'],
    properties: {
      noteId: { type: 'string', format: 'uuid', description: 'Note ID' },
    },
  },
  response: {
    200: successMessageResponseSchema,
    401: errorResponseSchema,
    404: errorResponseSchema,
    500: errorResponseSchema,
  },
};

/**
 * GET /api/v1/notes/export - Export notes
 */
export const exportNotesSchema: FastifySchema = {
  description: 'Export notes in specified format',
  tags: ['notes'],
  security: [{ bearerAuth: [] }],
  querystring: {
    type: 'object',
    properties: {
      videoId: { type: 'string', description: 'Filter by video ID (YouTube ID)' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
      format: { type: 'string', enum: ['markdown', 'json', 'csv'], default: 'markdown', description: 'Export format' },
    },
  },
  response: {
    200: {
      description: 'Exported notes',
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Exported content' },
        format: { type: 'string', enum: ['markdown', 'json', 'csv'] },
      },
      required: ['content', 'format'],
    },
    401: errorResponseSchema,
    404: errorResponseSchema,
    500: errorResponseSchema,
  },
};
