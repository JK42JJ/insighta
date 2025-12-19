# Error Handling Enhancement Plan

## Overview

This document outlines comprehensive error handling improvements for the sync-youtube-playlists project.

## Current Implementation

### Existing Error Classes (src/utils/errors.ts)

```typescript
// Base Errors
- AppError (base class)
- YouTubeAPIError extends AppError
- DatabaseError extends AppError
- ValidationError extends AppError
- SyncError extends AppError

// Specific Errors
- QuotaExceededError extends YouTubeAPIError
- AuthenticationError extends YouTubeAPIError
- InvalidCredentialsError extends AuthenticationError
- RecordNotFoundError extends DatabaseError
- InvalidPlaylistError extends ValidationError
- ConcurrentSyncError extends SyncError
```

### Existing Retry Utility (src/utils/retry.ts)

```typescript
- retry<T>(operation, options): Promise<T>
- retryIf<T>(operation, shouldRetry, options): Promise<T>
- retryBatch<T>(operations, options): Promise<T[]>
```

## Enhancements

### 1. Error Codes Enumeration

**File:** `src/utils/errors.ts` (add to existing file)

```typescript
/**
 * Comprehensive error codes for the entire application
 */
export const ERROR_CODES = {
  // Authentication & Authorization
  AUTH_FAILED: 'AUTH_FAILED',
  AUTH_EXPIRED: 'AUTH_EXPIRED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  OAUTH_ERROR: 'OAUTH_ERROR',
  TOKEN_REFRESH_FAILED: 'TOKEN_REFRESH_FAILED',

  // YouTube API Errors
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  RATE_LIMITED: 'RATE_LIMITED',
  PLAYLIST_NOT_FOUND: 'PLAYLIST_NOT_FOUND',
  VIDEO_NOT_FOUND: 'VIDEO_NOT_FOUND',
  PRIVATE_VIDEO: 'PRIVATE_VIDEO',
  DELETED_VIDEO: 'DELETED_VIDEO',
  INVALID_PLAYLIST: 'INVALID_PLAYLIST',
  INVALID_VIDEO_ID: 'INVALID_VIDEO_ID',
  EMPTY_PLAYLIST: 'EMPTY_PLAYLIST',

  // Network Errors
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
  CONNECTION_REFUSED: 'CONNECTION_REFUSED',
  DNS_LOOKUP_FAILED: 'DNS_LOOKUP_FAILED',

  // Database Errors
  DATABASE_ERROR: 'DATABASE_ERROR',
  RECORD_NOT_FOUND: 'RECORD_NOT_FOUND',
  DUPLICATE_RECORD: 'DUPLICATE_RECORD',
  TRANSACTION_FAILED: 'TRANSACTION_FAILED',

  // Sync Errors
  SYNC_ERROR: 'SYNC_ERROR',
  CONCURRENT_SYNC: 'CONCURRENT_SYNC',
  PARTIAL_SYNC: 'PARTIAL_SYNC',
  SYNC_TIMEOUT: 'SYNC_TIMEOUT',

  // Internal Errors
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  UNEXPECTED_ERROR: 'UNEXPECTED_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
```

**Migration:** Update all existing error classes to use `ERROR_CODES` constants instead of string literals.

### 2. New Error Classes

Add these new error classes to `src/utils/errors.ts`:

```typescript
/**
 * Rate limit exceeded (429 error)
 */
export class RateLimitError extends YouTubeAPIError {
  public readonly retryAfter?: number; // seconds

  constructor(retryAfter?: number, details?: Record<string, any>) {
    super('Rate limit exceeded. Please slow down your requests.', 429, details);
    this.code = ERROR_CODES.RATE_LIMITED;
    this.retryAfter = retryAfter;
  }
}

/**
 * Playlist not found on YouTube
 */
export class PlaylistNotFoundError extends YouTubeAPIError {
  constructor(playlistId: string, details?: Record<string, any>) {
    super(`Playlist not found: ${playlistId}`, 404, { playlistId, ...details });
    this.code = ERROR_CODES.PLAYLIST_NOT_FOUND;
  }
}

/**
 * Video not found on YouTube
 */
export class VideoNotFoundError extends YouTubeAPIError {
  constructor(videoId: string, details?: Record<string, any>) {
    super(`Video not found: ${videoId}`, 404, { videoId, ...details });
    this.code = ERROR_CODES.VIDEO_NOT_FOUND;
  }
}

/**
 * Private video (not accessible)
 */
export class PrivateVideoError extends YouTubeAPIError {
  constructor(videoId: string, details?: Record<string, any>) {
    super(`Video is private: ${videoId}`, 403, { videoId, ...details });
    this.code = ERROR_CODES.PRIVATE_VIDEO;
  }
}

/**
 * Deleted video
 */
export class DeletedVideoError extends YouTubeAPIError {
  constructor(videoId: string, details?: Record<string, any>) {
    super(`Video has been deleted: ${videoId}`, 410, { videoId, ...details });
    this.code = ERROR_CODES.DELETED_VIDEO;
  }
}

/**
 * Empty playlist
 */
export class EmptyPlaylistError extends YouTubeAPIError {
  constructor(playlistId: string, details?: Record<string, any>) {
    super(`Playlist is empty: ${playlistId}`, 200, { playlistId, ...details });
    this.code = ERROR_CODES.EMPTY_PLAYLIST;
  }
}

/**
 * Network timeout
 */
export class TimeoutError extends AppError {
  constructor(timeoutMs: number, details?: Record<string, any>) {
    super(ERROR_CODES.TIMEOUT, `Request timed out after ${timeoutMs}ms`, 503, true, {
      timeoutMs,
      ...details
    });
  }
}

/**
 * Connection refused
 */
export class ConnectionRefusedError extends AppError {
  constructor(host: string, details?: Record<string, any>) {
    super(ERROR_CODES.CONNECTION_REFUSED, `Connection refused: ${host}`, 503, true, {
      host,
      ...details
    });
  }
}

/**
 * Partial sync completed with errors
 */
export class PartialSyncError extends SyncError {
  public readonly successCount: number;
  public readonly failureCount: number;
  public readonly failures: Array<{ id: string; error: string }>;

  constructor(
    successCount: number,
    failureCount: number,
    failures: Array<{ id: string; error: string }>,
    details?: Record<string, any>
  ) {
    super(
      `Partial sync completed: ${successCount} succeeded, ${failureCount} failed`,
      { successCount, failureCount, failures, ...details }
    );
    this.code = ERROR_CODES.PARTIAL_SYNC;
    this.successCount = successCount;
    this.failureCount = failureCount;
    this.failures = failures;
  }
}

/**
 * Token refresh failed
 */
export class TokenRefreshError extends AuthenticationError {
  constructor(details?: Record<string, any>) {
    super('Failed to refresh access token. Please re-authenticate.', details);
    this.code = ERROR_CODES.TOKEN_REFRESH_FAILED;
  }
}

/**
 * Invalid video ID format
 */
export class InvalidVideoIdError extends ValidationError {
  constructor(videoId: string, details?: Record<string, any>) {
    super(`Invalid video ID: ${videoId}`, { videoId, ...details });
    this.code = ERROR_CODES.INVALID_VIDEO_ID;
  }
}

/**
 * Invalid URL format
 */
export class InvalidUrlError extends ValidationError {
  constructor(url: string, details?: Record<string, any>) {
    super(`Invalid URL format: ${url}`, { url, ...details });
    this.code = ERROR_CODES.INVALID_URL;
  }
}

/**
 * Database transaction failed
 */
export class TransactionError extends DatabaseError {
  constructor(message: string, details?: Record<string, any>) {
    super(`Transaction failed: ${message}`, details);
    this.code = ERROR_CODES.TRANSACTION_FAILED;
  }
}

/**
 * Duplicate record constraint violation
 */
export class DuplicateRecordError extends DatabaseError {
  constructor(entity: string, field: string, value: string, details?: Record<string, any>) {
    super(`${entity} with ${field} '${value}' already exists`, { entity, field, value, ...details });
    this.code = ERROR_CODES.DUPLICATE_RECORD;
    this.statusCode = 409;
  }
}
```

### 3. Enhanced Error Detection Utilities

Add to `src/utils/errors.ts`:

```typescript
/**
 * Check if error indicates a quota issue
 */
export function isQuotaError(error: unknown): boolean {
  return error instanceof QuotaExceededError || error instanceof RateLimitError;
}

/**
 * Check if error indicates authentication issue
 */
export function isAuthError(error: unknown): boolean {
  return error instanceof AuthenticationError;
}

/**
 * Check if error indicates a deleted/private video
 */
export function isUnavailableVideo(error: unknown): boolean {
  return error instanceof PrivateVideoError || error instanceof DeletedVideoError;
}

/**
 * Determine HTTP status code from error
 */
export function getErrorStatusCode(error: unknown): number {
  if (error instanceof AppError) {
    return error.statusCode;
  }
  return 500;
}

/**
 * Convert YouTube API error to application error
 */
export function parseYouTubeError(error: any, context?: string): YouTubeAPIError {
  const statusCode = error.response?.status || error.code || 500;
  const message = error.message || 'YouTube API error';

  // Quota exceeded
  if (statusCode === 403 && message.includes('quota')) {
    return new QuotaExceededError(undefined, { originalError: error, context });
  }

  // Rate limited
  if (statusCode === 429) {
    const retryAfter = error.response?.headers?.['retry-after']
      ? parseInt(error.response.headers['retry-after'])
      : undefined;
    return new RateLimitError(retryAfter, { originalError: error, context });
  }

  // Not found
  if (statusCode === 404) {
    if (context?.includes('playlist')) {
      return new PlaylistNotFoundError('unknown', { originalError: error, context });
    }
    if (context?.includes('video')) {
      return new VideoNotFoundError('unknown', { originalError: error, context });
    }
  }

  // Authentication errors
  if (statusCode === 401) {
    return new InvalidCredentialsError({ originalError: error, context });
  }

  // Generic YouTube API error
  return new YouTubeAPIError(message, statusCode, { originalError: error, context });
}

/**
 * Enhanced toJSON for AppError base class
 */
// Add this method to AppError class
toJSON(): Record<string, any> {
  return {
    name: this.name,
    code: this.code,
    message: this.message,
    statusCode: this.statusCode,
    isOperational: this.isOperational,
    timestamp: this.timestamp.toISOString(),
    details: this.details,
    stack: this.stack,
  };
}
```

### 4. Circuit Breaker Pattern

**New File:** `src/utils/circuit-breaker.ts`

```typescript
/**
 * Circuit Breaker Pattern Implementation
 *
 * Prevents cascading failures by stopping operations
 * when failure rate exceeds threshold.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Failing, all requests fail fast
 * - HALF_OPEN: Testing if service recovered
 */

import { logger } from './logger';

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerOptions {
  failureThreshold: number; // Number of failures before opening circuit
  successThreshold: number; // Number of successes to close circuit from half-open
  timeout: number; // Time in ms before attempting to close circuit
  monitoringPeriod: number; // Time window for failure counting (ms)
}

export class CircuitBreakerError extends Error {
  constructor(message: string = 'Circuit breaker is OPEN') {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

/**
 * Circuit Breaker
 *
 * @example
 * ```typescript
 * const breaker = new CircuitBreaker('youtube-api', {
 *   failureThreshold: 5,
 *   successThreshold: 2,
 *   timeout: 60000,
 *   monitoringPeriod: 120000,
 * });
 *
 * try {
 *   const result = await breaker.execute(async () => {
 *     return await youtubeClient.getPlaylist(id);
 *   });
 * } catch (error) {
 *   if (error instanceof CircuitBreakerError) {
 *     // Circuit is open, fail fast
 *   }
 * }
 * ```
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: number = 0;
  private nextAttemptTime: number = 0;
  private failures: number[] = []; // Timestamps of failures

  constructor(
    private name: string,
    private options: CircuitBreakerOptions
  ) {
    logger.info('Circuit breaker initialized', { name, options });
  }

  /**
   * Execute operation with circuit breaker protection
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.state === CircuitState.OPEN) {
      if (Date.now() < this.nextAttemptTime) {
        throw new CircuitBreakerError(`Circuit breaker '${this.name}' is OPEN`);
      }
      // Try half-open state
      this.state = CircuitState.HALF_OPEN;
      logger.info('Circuit breaker transitioning to HALF_OPEN', { name: this.name });
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Handle successful operation
   */
  private onSuccess(): void {
    this.failureCount = 0;

    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;

      if (this.successCount >= this.options.successThreshold) {
        this.state = CircuitState.CLOSED;
        this.successCount = 0;
        this.failures = [];
        logger.info('Circuit breaker CLOSED', { name: this.name });
      }
    }
  }

  /**
   * Handle failed operation
   */
  private onFailure(): void {
    const now = Date.now();
    this.lastFailureTime = now;
    this.failures.push(now);

    // Clean old failures outside monitoring period
    this.failures = this.failures.filter(
      (time) => now - time < this.options.monitoringPeriod
    );

    if (this.state === CircuitState.HALF_OPEN) {
      // Failed in half-open, go back to open
      this.state = CircuitState.OPEN;
      this.successCount = 0;
      this.nextAttemptTime = now + this.options.timeout;
      logger.warn('Circuit breaker reopened from HALF_OPEN', {
        name: this.name,
        nextAttemptAt: new Date(this.nextAttemptTime).toISOString(),
      });
      return;
    }

    // Check if we should open the circuit
    if (this.failures.length >= this.options.failureThreshold) {
      this.state = CircuitState.OPEN;
      this.nextAttemptTime = now + this.options.timeout;
      logger.error('Circuit breaker OPENED', {
        name: this.name,
        failures: this.failures.length,
        threshold: this.options.failureThreshold,
        nextAttemptAt: new Date(this.nextAttemptTime).toISOString(),
      });
    }
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get circuit statistics
   */
  getStats() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failures.length,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime
        ? new Date(this.lastFailureTime).toISOString()
        : null,
      nextAttemptTime: this.nextAttemptTime
        ? new Date(this.nextAttemptTime).toISOString()
        : null,
    };
  }

  /**
   * Manually reset circuit to CLOSED state
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.failures = [];
    this.lastFailureTime = 0;
    this.nextAttemptTime = 0;
    logger.info('Circuit breaker manually reset', { name: this.name });
  }
}
```

### 5. Enhanced Retry Logic

**Update:** `src/utils/retry.ts` - add timestamp property to AppError constructor

Add to existing retry utility:

```typescript
/**
 * Update isRetryableError to handle new error types
 */
export function isRetryableError(error: unknown): boolean {
  // Non-retryable errors
  if (error instanceof QuotaExceededError) return false;
  if (error instanceof AuthenticationError) return false;
  if (error instanceof ValidationError) return false;
  if (error instanceof RecordNotFoundError) return false;
  if (error instanceof PlaylistNotFoundError) return false;
  if (error instanceof VideoNotFoundError) return false;
  if (error instanceof InvalidPlaylistError) return false;
  if (error instanceof PrivateVideoError) return false; // Private videos won't become public
  if (error instanceof DeletedVideoError) return false; // Deleted videos won't come back

  // Retryable YouTube API errors (5xx server errors)
  if (error instanceof YouTubeAPIError) {
    return error.statusCode >= 500;
  }

  // Retryable network errors
  if (error instanceof TimeoutError) return true;
  if (error instanceof ConnectionRefusedError) return true;

  // Retryable database errors
  if (error instanceof DatabaseError) {
    return error.code === ERROR_CODES.CONNECTION_POOL_EXHAUSTED;
  }

  // Retry unknown errors cautiously
  return true;
}
```

### 6. Edge Case Handling

**Update:** YouTube API client to handle edge cases

```typescript
// In src/api/client.ts

/**
 * Get playlist with empty playlist handling
 */
public async getPlaylist(playlistId: string, useCache: boolean = true): Promise<youtube_v3.Schema$Playlist> {
  // ... existing code ...

  const playlist = /* fetch playlist */;

  // Check for empty playlist
  if (playlist.contentDetails?.itemCount === 0) {
    throw new EmptyPlaylistError(playlistId, {
      title: playlist.snippet?.title,
    });
  }

  return playlist;
}

/**
 * Get videos with unavailable video handling
 */
public async getVideos(
  videoIds: string[],
  useCache: boolean = true
): Promise<youtube_v3.Schema$Video[]> {
  // ... existing code ...

  const videos = /* fetch videos */;
  const foundIds = new Set(videos.map(v => v.id));
  const missingIds = videoIds.filter(id => !foundIds.has(id));

  // Mark missing videos as unavailable
  if (missingIds.length > 0) {
    logger.warn('Some videos are unavailable', {
      requested: videoIds.length,
      found: videos.length,
      missing: missingIds,
    });

    // Don't throw error, return what we found
    // Let caller decide how to handle partial results
  }

  return videos;
}
```

### 7. Usage Examples

#### Example 1: Sync with Circuit Breaker and Retry

```typescript
import { CircuitBreaker } from '../utils/circuit-breaker';
import { retry } from '../utils/retry';
import {
  parseYouTubeError,
  isUnavailableVideo,
  PartialSyncError,
} from '../utils/errors';

// Initialize circuit breaker
const youtubeBreaker = new CircuitBreaker('youtube-api', {
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 60000,
  monitoringPeriod: 120000,
});

// Sync playlist with full error handling
async function syncPlaylist(playlistId: string) {
  try {
    const videos = await youtubeBreaker.execute(async () => {
      return await retry(async () => {
        return await youtubeClient.getPlaylistVideos(playlistId);
      });
    });

    // Process videos with partial failure tracking
    const results = await processVideos(videos);

    if (results.failures.length > 0) {
      throw new PartialSyncError(
        results.successes.length,
        results.failures.length,
        results.failures
      );
    }

    return results.successes;
  } catch (error) {
    const appError = parseYouTubeError(error, 'playlist-sync');
    logger.error('Playlist sync failed', {
      playlistId,
      error: appError.toJSON()
    });
    throw appError;
  }
}

// Process videos with unavailable video handling
async function processVideos(videos: Video[]) {
  const successes = [];
  const failures = [];

  for (const video of videos) {
    try {
      await processVideo(video);
      successes.push(video);
    } catch (error) {
      if (isUnavailableVideo(error)) {
        // Mark video as unavailable in database
        await markVideoUnavailable(video.id);
        logger.info('Video marked as unavailable', { videoId: video.id });
      } else {
        failures.push({
          id: video.id,
          error: getErrorMessage(error),
        });
      }
    }
  }

  return { successes, failures };
}
```

#### Example 2: API Route Error Handling

```typescript
import { getErrorStatusCode, getErrorDetails, ERROR_CODES } from '../utils/errors';

// Express/Fastify error handler
app.post('/playlists/sync', async (req, res) => {
  try {
    const result = await syncPlaylist(req.body.playlistId);
    res.json({ success: true, data: result });
  } catch (error) {
    const statusCode = getErrorStatusCode(error);
    const details = getErrorDetails(error);

    res.status(statusCode).json({
      success: false,
      error: {
        code: error.code || ERROR_CODES.INTERNAL_ERROR,
        message: getErrorMessage(error),
        details,
      },
    });
  }
});
```

## Testing Strategy

### Unit Tests

1. **Test new error classes**
   - Inheritance chain
   - Error codes
   - Custom properties (retryAfter, failures, etc.)

2. **Test error detection utilities**
   - isQuotaError()
   - isAuthError()
   - isUnavailableVideo()
   - parseYouTubeError()

3. **Test circuit breaker**
   - State transitions (CLOSED → OPEN → HALF_OPEN → CLOSED)
   - Failure threshold
   - Success threshold
   - Timeout behavior

4. **Test enhanced retry logic**
   - New error types in retry decisions
   - Integration with circuit breaker

### Integration Tests

1. **YouTube API error scenarios**
   - Quota exceeded handling
   - Rate limit with retry-after
   - Private/deleted videos
   - Empty playlists

2. **Sync edge cases**
   - Partial sync with failures
   - Concurrent sync prevention
   - Empty playlist handling
   - All videos unavailable

### Test Files to Create/Update

```
tests/unit/utils/
  - circuit-breaker.test.ts (new)
  - errors.test.ts (update with new error classes)
  - retry.test.ts (update with new error types)

tests/integration/
  - youtube-error-handling.test.ts (new)
  - partial-sync.test.ts (new)
```

## Migration Guide

### Step 1: Update Error Classes

1. Update `AppError` constructor to add `timestamp` property
2. Add `ERROR_CODES` constant
3. Update existing error codes to use `ERROR_CODES.*`
4. Add new error classes

### Step 2: Update Error Detection

1. Update `isRetryableError()` to handle new error types
2. Add new utility functions (isQuotaError, isAuthError, etc.)

### Step 3: Implement Circuit Breaker

1. Create `src/utils/circuit-breaker.ts`
2. Add circuit breaker to YouTubeClient
3. Configure circuit breaker settings in config

### Step 4: Update API Client

1. Add edge case handling for empty playlists
2. Add unavailable video detection
3. Use `parseYouTubeError()` for consistent error transformation

### Step 5: Update Sync Logic

1. Add partial sync error handling
2. Mark unavailable videos in database
3. Return detailed sync results

## Configuration

Add to `src/config/index.ts`:

```typescript
export const config = {
  // ... existing config ...

  circuitBreaker: {
    youtube: {
      failureThreshold: env.YOUTUBE_CB_FAILURE_THRESHOLD ?? 5,
      successThreshold: env.YOUTUBE_CB_SUCCESS_THRESHOLD ?? 2,
      timeout: env.YOUTUBE_CB_TIMEOUT ?? 60000,
      monitoringPeriod: env.YOUTUBE_CB_MONITORING_PERIOD ?? 120000,
    },
  },

  retry: {
    maxAttempts: env.RETRY_MAX_ATTEMPTS ?? 5,
    initialDelay: env.RETRY_INITIAL_DELAY ?? 1000,
    maxDelay: env.RETRY_MAX_DELAY ?? 30000,
    backoffMultiplier: env.RETRY_BACKOFF_MULTIPLIER ?? 2,
  },
};
```

Add to `.env.example`:

```bash
# Circuit Breaker Settings
YOUTUBE_CB_FAILURE_THRESHOLD=5
YOUTUBE_CB_SUCCESS_THRESHOLD=2
YOUTUBE_CB_TIMEOUT=60000
YOUTUBE_CB_MONITORING_PERIOD=120000

# Retry Settings
RETRY_MAX_ATTEMPTS=5
RETRY_INITIAL_DELAY=1000
RETRY_MAX_DELAY=30000
RETRY_BACKOFF_MULTIPLIER=2
```

## Rollout Plan

### Phase 1: Foundation (Week 1)
- Add ERROR_CODES enumeration
- Add new error classes
- Add error detection utilities
- Update tests

### Phase 2: Circuit Breaker (Week 2)
- Implement CircuitBreaker class
- Add to YouTubeClient
- Add configuration
- Integration testing

### Phase 3: Edge Cases (Week 3)
- Handle empty playlists
- Handle private/deleted videos
- Partial sync error handling
- Update sync logic

### Phase 4: Validation (Week 4)
- End-to-end testing
- Performance testing
- Documentation updates
- Production deployment

## Success Metrics

1. **Error Handling Coverage**: 100% of error scenarios covered
2. **Test Coverage**: Maintain >80% coverage
3. **Mean Time to Recovery (MTTR)**: <5 minutes for transient failures
4. **Circuit Breaker Effectiveness**: >95% of cascading failures prevented
5. **Retry Success Rate**: >90% of retryable operations succeed within 3 attempts

## References

- [Google API Error Responses](https://developers.google.com/youtube/v3/docs/errors)
- [Circuit Breaker Pattern](https://martinfowler.com/bliki/CircuitBreaker.html)
- [Exponential Backoff](https://en.wikipedia.org/wiki/Exponential_backoff)
- [Prisma Error Handling](https://www.prisma.io/docs/reference/api-reference/error-reference)
