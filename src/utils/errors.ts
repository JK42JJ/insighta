/**
 * Error Handling Utilities
 *
 * Provides custom error classes and error handling utilities
 */

/**
 * Error severity levels
 */
export enum ErrorSeverity {
  CRITICAL = 'critical', // System-critical errors requiring immediate attention
  HIGH = 'high',         // High-impact errors affecting core functionality
  MEDIUM = 'medium',     // Moderate errors with workarounds available
  LOW = 'low',          // Minor errors with minimal impact
}

/**
 * Base application error
 */
export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public isOperational: boolean = true,
    public details?: Record<string, any>,
    public severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    public recoverable: boolean = true
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * YouTube API specific errors
 */
export class YouTubeAPIError extends AppError {
  constructor(message: string, statusCode: number = 500, details?: Record<string, any>) {
    super(message, 'YOUTUBE_API_ERROR', statusCode, true, details, ErrorSeverity.HIGH, true);
  }
}

export class QuotaExceededError extends YouTubeAPIError {
  constructor(details?: Record<string, any>) {
    super('YouTube API quota exceeded', 429, details);
    this.code = 'QUOTA_EXCEEDED';
    this.severity = ErrorSeverity.HIGH;
    this.recoverable = false; // Needs to wait until quota resets
  }
}

export class AuthenticationError extends YouTubeAPIError {
  constructor(message: string = 'YouTube API authentication failed', details?: Record<string, any>) {
    super(message, 401, details);
    this.code = 'AUTHENTICATION_ERROR';
    this.severity = ErrorSeverity.HIGH;
    this.recoverable = true; // Can be recovered via token refresh
  }
}

export class InvalidCredentialsError extends AuthenticationError {
  constructor(details?: Record<string, any>) {
    super('Invalid or expired credentials', details);
    this.code = 'INVALID_CREDENTIALS';
    this.severity = ErrorSeverity.HIGH;
    this.recoverable = true; // Can be recovered via re-authentication
  }
}

/**
 * Network errors
 */
export class NetworkError extends AppError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'NETWORK_ERROR', 503, true, details, ErrorSeverity.MEDIUM, true);
  }
}

/**
 * Rate limit errors
 */
export class RateLimitError extends AppError {
  constructor(message: string = 'Rate limit exceeded', details?: Record<string, any>) {
    super(message, 'RATE_LIMIT_ERROR', 429, true, details, ErrorSeverity.MEDIUM, true);
  }
}

/**
 * Database errors
 */
export class DatabaseError extends AppError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'DATABASE_ERROR', 500, true, details);
  }
}

export class RecordNotFoundError extends DatabaseError {
  constructor(entity: string, id: string, details?: Record<string, any>) {
    super(`${entity} not found: ${id}`, { entity, id, ...details });
    this.code = 'RECORD_NOT_FOUND';
    this.statusCode = 404;
  }
}

/**
 * Validation errors
 */
export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'VALIDATION_ERROR', 400, true, details);
  }
}

export class InvalidPlaylistError extends ValidationError {
  constructor(playlistId: string, details?: Record<string, any>) {
    super(`Invalid playlist: ${playlistId}`, { playlistId, ...details });
    this.code = 'INVALID_PLAYLIST';
  }
}

/**
 * Sync errors
 */
export class SyncError extends AppError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'SYNC_ERROR', 500, true, details, ErrorSeverity.HIGH, true);
  }
}

export class ConcurrentSyncError extends SyncError {
  constructor(playlistId: string, details?: Record<string, any>) {
    super(`Playlist already being synced: ${playlistId}`, { playlistId, ...details });
    this.code = 'CONCURRENT_SYNC';
    this.statusCode = 409;
    this.severity = ErrorSeverity.MEDIUM;
    this.recoverable = true; // Can retry after current sync completes
  }
}

export class SyncConflictError extends SyncError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, { ...details });
    this.code = 'SYNC_CONFLICT';
    this.statusCode = 409;
    this.severity = ErrorSeverity.MEDIUM;
    this.recoverable = true; // Can be resolved via conflict resolution
  }
}

/**
 * Check if error is operational (expected and recoverable)
 */
export function isOperationalError(error: Error): boolean {
  if (error instanceof AppError) {
    return error.isOperational;
  }
  return false;
}

/**
 * Extract error message safely
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown error occurred';
}

/**
 * Extract error details safely
 */
export function getErrorDetails(error: unknown): Record<string, any> {
  if (error instanceof AppError) {
    return error.details || {};
  }
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return {};
}

/**
 * Check if error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof QuotaExceededError) {
    return false; // Don't retry quota errors
  }

  if (error instanceof AuthenticationError) {
    return false; // Don't retry auth errors
  }

  if (error instanceof ValidationError) {
    return false; // Don't retry validation errors
  }

  if (error instanceof YouTubeAPIError) {
    // Retry on server errors (5xx) but not client errors (4xx)
    return error.statusCode >= 500;
  }

  // Retry unknown errors
  return true;
}
