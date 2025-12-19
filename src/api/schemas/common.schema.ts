import { z } from 'zod';

/**
 * Common Schemas for API
 *
 * This file contains reusable schemas for pagination, error responses,
 * and other common API patterns.
 */

// ============================================================================
// Pagination Schemas
// ============================================================================

/**
 * Zod schema for pagination query parameters
 * Used for runtime validation
 */
export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1).describe('Page number (1-based)'),
  limit: z.coerce.number().int().min(1).max(100).default(20).describe('Items per page (max 100)'),
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

/**
 * Fastify schema for pagination query parameters
 * Used for OpenAPI documentation generation
 */
export const paginationQuerySchema = {
  type: 'object',
  properties: {
    page: {
      type: 'integer',
      minimum: 1,
      default: 1,
      description: 'Page number (1-based)',
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: 100,
      default: 20,
      description: 'Items per page (max 100)',
    },
  },
} as const;

/**
 * Pagination metadata response schema
 */
export const paginationResponseSchema = {
  type: 'object',
  properties: {
    page: { type: 'integer', description: 'Current page number' },
    limit: { type: 'integer', description: 'Items per page' },
    total: { type: 'integer', description: 'Total number of items' },
    totalPages: { type: 'integer', description: 'Total number of pages' },
    hasNext: { type: 'boolean', description: 'Whether there is a next page' },
    hasPrev: { type: 'boolean', description: 'Whether there is a previous page' },
  },
  required: ['page', 'limit', 'total', 'totalPages', 'hasNext', 'hasPrev'],
} as const;

// ============================================================================
// Error Response Schemas
// ============================================================================

/**
 * Standard error codes used across the API
 */
export enum ErrorCode {
  // Authentication errors (401)
  UNAUTHORIZED = 'UNAUTHORIZED',
  INVALID_TOKEN = 'INVALID_TOKEN',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',

  // Authorization errors (403)
  FORBIDDEN = 'FORBIDDEN',
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',

  // Resource errors (404)
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  PLAYLIST_NOT_FOUND = 'PLAYLIST_NOT_FOUND',
  VIDEO_NOT_FOUND = 'VIDEO_NOT_FOUND',

  // Validation errors (400)
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_INPUT = 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',

  // Business logic errors (409, 422)
  CONFLICT = 'CONFLICT',
  DUPLICATE_RESOURCE = 'DUPLICATE_RESOURCE',
  RESOURCE_ALREADY_EXISTS = 'RESOURCE_ALREADY_EXISTS',
  PLAYLIST_ALREADY_EXISTS = 'PLAYLIST_ALREADY_EXISTS',
  SYNC_IN_PROGRESS = 'SYNC_IN_PROGRESS',

  // Rate limiting (429)
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',

  // Server errors (500)
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  EXTERNAL_API_ERROR = 'EXTERNAL_API_ERROR',

  // Service errors (503)
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  YOUTUBE_API_UNAVAILABLE = 'YOUTUBE_API_UNAVAILABLE',
}

/**
 * Error response schema for OpenAPI documentation
 */
export const errorResponseSchema = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          enum: Object.values(ErrorCode),
          description: 'Error code identifying the type of error',
        },
        message: {
          type: 'string',
          description: 'Human-readable error message',
        },
        details: {
          type: 'object',
          description: 'Additional error details (optional)',
          additionalProperties: true,
        },
        timestamp: {
          type: 'string',
          format: 'date-time',
          description: 'ISO 8601 timestamp of when the error occurred',
        },
        path: {
          type: 'string',
          description: 'API path where the error occurred',
        },
      },
      required: ['code', 'message', 'timestamp', 'path'],
    },
  },
  required: ['error'],
} as const;

/**
 * Zod schema for error response validation
 */
export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.nativeEnum(ErrorCode),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    timestamp: z.string().datetime(),
    path: z.string(),
  }),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

// ============================================================================
// Success Response Schemas
// ============================================================================

/**
 * Generic success response wrapper
 */
export const successResponseSchema = <T extends Record<string, unknown>>(dataSchema: T) => ({
  type: 'object',
  properties: {
    success: { type: 'boolean', default: true },
    data: dataSchema,
  },
  required: ['success', 'data'],
} as const);

// ============================================================================
// Common Field Schemas
// ============================================================================

/**
 * ISO 8601 date-time string schema
 */
export const dateTimeSchema = {
  type: 'string',
  format: 'date-time',
  description: 'ISO 8601 date-time string',
} as const;

/**
 * UUID schema
 */
export const uuidSchema = {
  type: 'string',
  format: 'uuid',
  description: 'UUID v4',
} as const;

/**
 * URL schema
 */
export const urlSchema = {
  type: 'string',
  format: 'uri',
  description: 'Valid URL',
} as const;

// ============================================================================
// Sorting Schemas
// ============================================================================

/**
 * Common sort orders
 */
export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

/**
 * Sort query parameter schema
 */
export const sortQuerySchema = {
  type: 'object',
  properties: {
    sortBy: {
      type: 'string',
      description: 'Field to sort by',
    },
    sortOrder: {
      type: 'string',
      enum: [SortOrder.ASC, SortOrder.DESC],
      default: SortOrder.DESC,
      description: 'Sort order (asc or desc)',
    },
  },
} as const;

export const SortQuerySchema = z.object({
  sortBy: z.string().optional(),
  sortOrder: z.nativeEnum(SortOrder).default(SortOrder.DESC),
});

export type SortQuery = z.infer<typeof SortQuerySchema>;

// ============================================================================
// Search Schemas
// ============================================================================

/**
 * Search query parameter schema
 */
export const searchQuerySchema = {
  type: 'object',
  properties: {
    q: {
      type: 'string',
      description: 'Search query string',
      minLength: 1,
    },
  },
} as const;

export const SearchQuerySchema = z.object({
  q: z.string().min(1).optional().describe('Search query string'),
});

export type SearchQuery = z.infer<typeof SearchQuerySchema>;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a paginated response
 */
export function createPaginatedResponse<T>(
  items: T[],
  page: number,
  limit: number,
  total: number
) {
  const totalPages = Math.ceil(total / limit);

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
}

/**
 * Create a standardized error response
 */
export function createErrorResponse(
  code: ErrorCode,
  message: string,
  path: string,
  details?: Record<string, unknown>
): ErrorResponse {
  return {
    error: {
      code,
      message,
      details,
      timestamp: new Date().toISOString(),
      path,
    },
  };
}

/**
 * Create a success response
 */
export function createSuccessResponse<T>(data: T) {
  return {
    success: true,
    data,
  };
}

/**
 * Simple success message response schema for OpenAPI documentation
 */
export const successMessageResponseSchema = {
  type: 'object',
  properties: {
    message: {
      type: 'string',
      description: 'Success message',
    },
  },
  required: ['message'],
} as const;

/**
 * Zod schema for success message response validation
 */
export const SuccessMessageResponseSchema = z.object({
  message: z.string(),
});

export type SuccessMessageResponse = z.infer<typeof SuccessMessageResponseSchema>;
