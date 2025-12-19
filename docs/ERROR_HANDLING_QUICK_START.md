# Error Handling Quick Start Guide

## Table of Contents

1. [Using Error Classes](#using-error-classes)
2. [Retry with Exponential Backoff](#retry-with-exponential-backoff)
3. [Circuit Breaker Pattern](#circuit-breaker-pattern)
4. [Edge Case Handling](#edge-case-handling)
5. [Testing Error Scenarios](#testing-error-scenarios)
6. [Common Patterns](#common-patterns)

---

## Using Error Classes

### Basic Error Handling

```typescript
import {
  YouTubeAPIError,
  QuotaExceededError,
  PlaylistNotFoundError,
  PrivateVideoError,
  parseYouTubeError,
  isQuotaError,
  isUnavailableVideo,
} from './utils/errors';

// Throw specific error
async function getPlaylist(id: string) {
  try {
    const playlist = await youtubeAPI.get(id);
    return playlist;
  } catch (error) {
    // Parse YouTube API error
    throw parseYouTubeError(error, 'getPlaylist');
  }
}

// Handle specific error types
try {
  const playlist = await getPlaylist('PLxxx');
} catch (error) {
  if (error instanceof PlaylistNotFoundError) {
    console.error('Playlist not found:', error.details);
  } else if (isQuotaError(error)) {
    console.error('API quota exceeded, retry at:', error.resetAt);
  } else if (error instanceof YouTubeAPIError) {
    console.error('YouTube API error:', error.statusCode, error.message);
  } else {
    throw error; // Re-throw unknown errors
  }
}
```

### Creating Custom Errors

```typescript
import { AppError, ERROR_CODES } from './utils/errors';

class CustomSyncError extends AppError {
  constructor(playlistId: string, details?: Record<string, any>) {
    super(
      ERROR_CODES.SYNC_ERROR,
      `Failed to sync playlist: ${playlistId}`,
      500,
      true,
      { playlistId, ...details }
    );
  }
}

// Usage
throw new CustomSyncError('PLxxx', {
  reason: 'Network timeout',
  attemptNumber: 3,
});
```

---

## Retry with Exponential Backoff

### Basic Retry

```typescript
import { retry } from './utils/retry';

// Simple retry
const data = await retry(async () => {
  return await youtubeClient.getPlaylist(id);
});

// Custom retry options
const data = await retry(
  async () => {
    return await youtubeClient.getPlaylist(id);
  },
  {
    maxAttempts: 5,
    initialDelayMs: 2000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
  }
);
```

### Retry with Callback

```typescript
import { retry } from './utils/retry';

const data = await retry(
  async () => {
    return await youtubeClient.getPlaylist(id);
  },
  {
    maxAttempts: 5,
    onRetry: (attempt, error) => {
      console.log(`Retry attempt ${attempt}:`, error.message);
      // Update UI, send metrics, etc.
    },
  }
);
```

### Conditional Retry

```typescript
import { retryIf } from './utils/retry';

const data = await retryIf(
  async () => {
    return await youtubeClient.getPlaylist(id);
  },
  (error) => {
    // Custom retry condition
    if (error instanceof QuotaExceededError) return false; // Don't retry
    if (error instanceof NetworkError) return true; // Retry network errors
    return error.statusCode >= 500; // Retry server errors
  },
  {
    maxAttempts: 3,
  }
);
```

### Batch Retry

```typescript
import { retryBatch } from './utils/retry';

const videoIds = ['vid1', 'vid2', 'vid3'];

const results = await retryBatch(
  videoIds.map((id) => async () => {
    return await youtubeClient.getVideo(id);
  }),
  {
    maxAttempts: 3,
  }
);
```

---

## Circuit Breaker Pattern

### Basic Circuit Breaker

```typescript
import { CircuitBreaker } from './utils/circuit-breaker';

// Initialize circuit breaker
const youtubeBreaker = new CircuitBreaker('youtube-api', {
  failureThreshold: 5, // Open after 5 failures
  successThreshold: 2, // Need 2 successes to close
  timeout: 60000, // Try recovery after 60 seconds
  monitoringPeriod: 120000, // Count failures in 2-minute window
});

// Execute with protection
try {
  const data = await youtubeBreaker.execute(async () => {
    return await youtubeClient.getPlaylist(id);
  });
} catch (error) {
  if (error instanceof CircuitBreakerError) {
    // Circuit is open - service unavailable
    console.error('YouTube API unavailable, retry at:', error.nextAttemptTime);
  } else {
    // Actual operation error
    console.error('Operation failed:', error);
  }
}
```

### Circuit Breaker with Retry

```typescript
import { CircuitBreaker } from './utils/circuit-breaker';
import { retry } from './utils/retry';

const youtubeBreaker = new CircuitBreaker('youtube-api', {
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 60000,
  monitoringPeriod: 120000,
});

async function fetchPlaylistWithProtection(id: string) {
  return await youtubeBreaker.execute(async () => {
    return await retry(async () => {
      return await youtubeClient.getPlaylist(id);
    });
  });
}
```

### Circuit Breaker Registry

```typescript
import { circuitBreakerRegistry } from './utils/circuit-breaker';

// Register circuit breakers at startup
circuitBreakerRegistry.register('youtube-api', {
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 60000,
  monitoringPeriod: 120000,
});

circuitBreakerRegistry.register('database', {
  failureThreshold: 3,
  successThreshold: 1,
  timeout: 30000,
  monitoringPeriod: 60000,
});

// Use circuit breaker
const youtubeBreaker = circuitBreakerRegistry.get('youtube-api')!;
const data = await youtubeBreaker.execute(() => apiCall());

// Monitor all circuit breakers
const stats = circuitBreakerRegistry.getAllStats();
console.log('Circuit breaker health:', stats);

// Manual control
circuitBreakerRegistry.resetAll(); // Reset all circuits
```

### Monitoring Circuit State

```typescript
import { CircuitBreaker, CircuitState } from './utils/circuit-breaker';

const breaker = new CircuitBreaker('service', options);

// Check state
if (breaker.getState() === CircuitState.OPEN) {
  console.warn('Service is unavailable');
}

// Get statistics
const stats = breaker.getStats();
console.log('Circuit breaker stats:', {
  state: stats.state,
  recentFailures: stats.recentFailureCount,
  totalExecutions: stats.totalExecutions,
  successRate: (stats.totalSuccesses / stats.totalExecutions) * 100,
});

// Manual reset if needed
if (stats.state === CircuitState.OPEN && serviceIsHealthyAgain) {
  breaker.reset();
}
```

---

## Edge Case Handling

### Empty Playlists

```typescript
import { EmptyPlaylistError } from './utils/errors';

async function syncPlaylist(id: string) {
  try {
    const playlist = await youtubeClient.getPlaylist(id);
    const items = await youtubeClient.getPlaylistItems(id);

    if (items.length === 0) {
      throw new EmptyPlaylistError(id, {
        title: playlist.title,
      });
    }

    return { playlist, items };
  } catch (error) {
    if (error instanceof EmptyPlaylistError) {
      // Handle empty playlist gracefully
      logger.info('Playlist is empty, skipping sync', {
        playlistId: id,
        title: error.details.title,
      });
      return { playlist, items: [] };
    }
    throw error;
  }
}
```

### Private/Deleted Videos

```typescript
import { PrivateVideoError, DeletedVideoError, isUnavailableVideo } from './utils/errors';

async function processVideo(videoId: string) {
  try {
    const video = await youtubeClient.getVideo(videoId);
    return video;
  } catch (error) {
    if (isUnavailableVideo(error)) {
      // Mark video as unavailable in database
      await db.video.update({
        where: { youtubeId: videoId },
        data: {
          isAvailable: false,
          unavailableReason:
            error instanceof PrivateVideoError ? 'PRIVATE' : 'DELETED',
          lastCheckedAt: new Date(),
        },
      });

      logger.info('Video marked as unavailable', {
        videoId,
        reason: error.code,
      });

      return null; // Skip unavailable video
    }
    throw error;
  }
}
```

### Partial Sync Handling

```typescript
import { PartialSyncError } from './utils/errors';

async function syncPlaylistVideos(playlistId: string, videoIds: string[]) {
  const successes = [];
  const failures = [];

  for (const videoId of videoIds) {
    try {
      const video = await processVideo(videoId);
      if (video) {
        successes.push(video);
      }
    } catch (error) {
      failures.push({
        id: videoId,
        error: getErrorMessage(error),
      });
    }
  }

  // Report results
  if (failures.length > 0) {
    throw new PartialSyncError(successes.length, failures.length, failures, {
      playlistId,
      totalVideos: videoIds.length,
    });
  }

  return successes;
}

// Handle partial sync
try {
  const videos = await syncPlaylistVideos(playlistId, videoIds);
  console.log('All videos synced successfully');
} catch (error) {
  if (error instanceof PartialSyncError) {
    console.warn(
      `Partial sync: ${error.successCount} succeeded, ${error.failureCount} failed`
    );
    console.error('Failed videos:', error.failures);

    // Update sync status
    await db.syncHistory.create({
      data: {
        playlistId,
        status: 'PARTIAL',
        successCount: error.successCount,
        failureCount: error.failureCount,
        failures: error.failures,
      },
    });
  } else {
    throw error;
  }
}
```

### Quota Queue Management

```typescript
import { QuotaExceededError, RateLimitError } from './utils/errors';

async function executeWithQuotaHandling<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      // Queue for next day
      const resetTime = error.resetAt || getNextMidnightPST();
      await queueManager.scheduleForLater(operation, resetTime);

      throw new Error(
        `API quota exceeded. Operation queued for ${resetTime.toISOString()}`
      );
    }

    if (error instanceof RateLimitError) {
      // Wait and retry
      const retryAfter = error.retryAfter || 60; // Default 60 seconds
      await sleep(retryAfter * 1000);
      return await operation();
    }

    throw error;
  }
}
```

---

## Testing Error Scenarios

### Mocking Errors

```typescript
import { QuotaExceededError, YouTubeAPIError } from '../src/utils/errors';

describe('Playlist Sync', () => {
  test('should handle quota exceeded', async () => {
    const mockClient = {
      getPlaylist: jest.fn().mockRejectedValue(new QuotaExceededError()),
    };

    await expect(syncPlaylist('PLxxx', mockClient)).rejects.toThrow(QuotaExceededError);
    expect(mockClient.getPlaylist).toHaveBeenCalledTimes(1);
  });

  test('should retry on server error', async () => {
    const mockClient = {
      getPlaylist: jest
        .fn()
        .mockRejectedValueOnce(new YouTubeAPIError('Server error', 500))
        .mockRejectedValueOnce(new YouTubeAPIError('Server error', 500))
        .mockResolvedValue({ id: 'PLxxx', title: 'Test' }),
    };

    const result = await syncPlaylist('PLxxx', mockClient);
    expect(result.title).toBe('Test');
    expect(mockClient.getPlaylist).toHaveBeenCalledTimes(3);
  });
});
```

### Testing Circuit Breaker

```typescript
import { CircuitBreaker, CircuitState } from '../src/utils/circuit-breaker';

describe('Circuit Breaker', () => {
  test('should open circuit after failures', async () => {
    const breaker = new CircuitBreaker('test', {
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 1000,
      monitoringPeriod: 5000,
    });

    const operation = jest.fn().mockRejectedValue(new Error('Fail'));

    // Trigger circuit open
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(operation)).rejects.toThrow('Fail');
    }

    expect(breaker.getState()).toBe(CircuitState.OPEN);

    // Should fail fast
    await expect(breaker.execute(operation)).rejects.toThrow(CircuitBreakerError);
  });
});
```

---

## Common Patterns

### Pattern 1: API Client with Full Protection

```typescript
import { CircuitBreaker } from './utils/circuit-breaker';
import { retry } from './utils/retry';
import { parseYouTubeError, isQuotaError } from './utils/errors';

class ProtectedYouTubeClient {
  private breaker: CircuitBreaker;

  constructor() {
    this.breaker = new CircuitBreaker('youtube-api', {
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 60000,
      monitoringPeriod: 120000,
    });
  }

  async getPlaylist(id: string) {
    return await this.breaker.execute(async () => {
      return await retry(
        async () => {
          try {
            return await youtubeAPI.playlists.get(id);
          } catch (error) {
            throw parseYouTubeError(error, 'getPlaylist');
          }
        },
        {
          maxAttempts: 3,
          onRetry: (attempt, error) => {
            logger.warn('Retrying playlist fetch', { attempt, error: error.message });
          },
        }
      );
    });
  }
}
```

### Pattern 2: Graceful Degradation

```typescript
import { CircuitBreakerError } from './utils/circuit-breaker';
import { QuotaExceededError } from './utils/errors';

async function getPlaylistWithFallback(id: string) {
  try {
    // Try to fetch from API
    return await youtubeClient.getPlaylist(id);
  } catch (error) {
    if (error instanceof CircuitBreakerError) {
      // Service unavailable, use cache
      logger.warn('API unavailable, using cached data');
      return await cache.get(`playlist:${id}`);
    }

    if (error instanceof QuotaExceededError) {
      // Quota exceeded, use stale data
      logger.warn('Quota exceeded, using stale data');
      return await db.playlist.findUnique({
        where: { youtubeId: id },
      });
    }

    throw error;
  }
}
```

### Pattern 3: Batch Processing with Error Recovery

```typescript
async function syncPlaylistBatch(playlistIds: string[]) {
  const results = {
    succeeded: [],
    failed: [],
    skipped: [],
  };

  for (const id of playlistIds) {
    try {
      const playlist = await syncPlaylist(id);
      results.succeeded.push({ id, playlist });
    } catch (error) {
      if (error instanceof QuotaExceededError) {
        // Stop processing, queue remaining
        const remaining = playlistIds.slice(playlistIds.indexOf(id));
        results.skipped.push(...remaining);
        break;
      }

      if (error instanceof CircuitBreakerError) {
        // Skip remaining until circuit closes
        const remaining = playlistIds.slice(playlistIds.indexOf(id));
        results.skipped.push(...remaining);
        break;
      }

      if (isUnavailableVideo(error)) {
        // Skip unavailable playlist
        results.skipped.push(id);
        continue;
      }

      // Record failure and continue
      results.failed.push({
        id,
        error: getErrorMessage(error),
      });
    }
  }

  return results;
}
```

### Pattern 4: Error-Aware Logging

```typescript
import { AppError, getErrorDetails, getErrorStatusCode } from './utils/errors';

function logError(error: unknown, context: string) {
  const statusCode = getErrorStatusCode(error);
  const details = getErrorDetails(error);

  if (error instanceof AppError) {
    logger.error('Application error', {
      context,
      code: error.code,
      statusCode: error.statusCode,
      message: error.message,
      isOperational: error.isOperational,
      timestamp: error.timestamp,
      details: error.details,
      stack: error.stack,
    });
  } else {
    logger.error('Unknown error', {
      context,
      statusCode,
      details,
    });
  }
}

// Usage
try {
  await syncPlaylist(id);
} catch (error) {
  logError(error, 'playlist-sync');
  throw error;
}
```

---

## Configuration

### Environment Variables

```bash
# .env
# Retry Configuration
RETRY_MAX_ATTEMPTS=5
RETRY_INITIAL_DELAY=1000
RETRY_MAX_DELAY=30000
RETRY_BACKOFF_MULTIPLIER=2

# Circuit Breaker Configuration
YOUTUBE_CB_FAILURE_THRESHOLD=5
YOUTUBE_CB_SUCCESS_THRESHOLD=2
YOUTUBE_CB_TIMEOUT=60000
YOUTUBE_CB_MONITORING_PERIOD=120000
```

### Config File

```typescript
// src/config/index.ts
export const config = {
  retry: {
    maxAttempts: parseInt(process.env.RETRY_MAX_ATTEMPTS || '5'),
    initialDelay: parseInt(process.env.RETRY_INITIAL_DELAY || '1000'),
    maxDelay: parseInt(process.env.RETRY_MAX_DELAY || '30000'),
    backoffMultiplier: parseFloat(process.env.RETRY_BACKOFF_MULTIPLIER || '2'),
  },
  circuitBreaker: {
    youtube: {
      failureThreshold: parseInt(process.env.YOUTUBE_CB_FAILURE_THRESHOLD || '5'),
      successThreshold: parseInt(process.env.YOUTUBE_CB_SUCCESS_THRESHOLD || '2'),
      timeout: parseInt(process.env.YOUTUBE_CB_TIMEOUT || '60000'),
      monitoringPeriod: parseInt(process.env.YOUTUBE_CB_MONITORING_PERIOD || '120000'),
    },
  },
};
```

---

## Best Practices

1. **Always use specific error types** - Don't throw generic `Error` objects
2. **Parse external API errors** - Use `parseYouTubeError()` for consistent error handling
3. **Combine retry and circuit breaker** - Circuit breaker prevents cascading failures, retry handles transient errors
4. **Log with context** - Include operation name, IDs, and relevant metadata
5. **Handle quota errors** - Queue operations for later instead of retrying immediately
6. **Mark unavailable content** - Don't repeatedly check private/deleted videos
7. **Track partial successes** - Use `PartialSyncError` to report mixed results
8. **Monitor circuit breaker stats** - Use stats to detect service degradation early
9. **Test error scenarios** - Mock errors in tests to verify error handling
10. **Document error codes** - Maintain list of error codes and their meanings

---

## Troubleshooting

### Circuit Breaker Won't Close

**Problem:** Circuit stays OPEN even after service recovers

**Solution:**
- Check if timeout is too long
- Verify success threshold is reachable
- Manually reset: `breaker.reset()`

### Retry Exhausted Quickly

**Problem:** Retries exhaust within seconds

**Solution:**
- Increase `maxAttempts`
- Increase `initialDelayMs` and `maxDelayMs`
- Check if errors are actually retryable

### Memory Leak from Failed Operations

**Problem:** Memory grows with failed operations

**Solution:**
- Set appropriate `monitoringPeriod` for circuit breaker
- Clear old failures periodically
- Use weak references for cached errors

### Quota Errors Not Detected

**Problem:** `isQuotaError()` returns false

**Solution:**
- Use `parseYouTubeError()` to convert raw errors
- Check error response format from API
- Verify error instanceof QuotaExceededError

---

## Additional Resources

- [ERROR_HANDLING_ENHANCEMENT.md](./ERROR_HANDLING_ENHANCEMENT.md) - Full implementation plan
- [CIRCUIT_BREAKER_IMPLEMENTATION.ts](./CIRCUIT_BREAKER_IMPLEMENTATION.ts) - Complete circuit breaker code
- [CIRCUIT_BREAKER_TESTS.ts](./CIRCUIT_BREAKER_TESTS.ts) - Comprehensive test suite
- [YouTube API Error Reference](https://developers.google.com/youtube/v3/docs/errors)
- [Circuit Breaker Pattern](https://martinfowler.com/bliki/CircuitBreaker.html)
