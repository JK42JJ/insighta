/**
 * Retry Utility with Exponential Backoff
 *
 * Provides retry logic for operations that may fail temporarily
 */

import { config } from '../config';
import { logger } from './logger';
import { isRetryableError, getErrorMessage } from './errors';

export interface RetryOptions {
  maxAttempts?: number;
  backoffMultiplier?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (attempt: number, error: Error) => void;
}

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(attempt: number, options: Required<RetryOptions>): number {
  const exponentialDelay = options.initialDelayMs * Math.pow(options.backoffMultiplier, attempt - 1);
  const jitter = Math.random() * 0.3 * exponentialDelay; // Add up to 30% jitter
  const delay = Math.min(exponentialDelay + jitter, options.maxDelayMs);
  return Math.floor(delay);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry an async operation with exponential backoff
 *
 * @param operation - Async function to retry
 * @param options - Retry configuration
 * @returns Result of the operation
 * @throws Last error if all retries fail
 */
export async function retry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts: Required<RetryOptions> = {
    maxAttempts: options.maxAttempts ?? config.sync.retryAttempts,
    backoffMultiplier: options.backoffMultiplier ?? config.sync.backoffMultiplier,
    initialDelayMs: options.initialDelayMs ?? 1000,
    maxDelayMs: options.maxDelayMs ?? 30000,
    onRetry: options.onRetry ?? (() => {}),
  };

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry if error is not retryable
      if (!isRetryableError(lastError)) {
        throw lastError;
      }

      // Don't retry if this was the last attempt
      if (attempt >= opts.maxAttempts) {
        break;
      }

      const delay = calculateDelay(attempt, opts);

      logger.warn('Operation failed, retrying...', {
        attempt,
        maxAttempts: opts.maxAttempts,
        delayMs: delay,
        error: getErrorMessage(lastError),
      });

      opts.onRetry(attempt, lastError);

      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Retry with custom condition
 *
 * @param operation - Async function to retry
 * @param shouldRetry - Function to determine if retry should happen
 * @param options - Retry configuration
 */
export async function retryIf<T>(
  operation: () => Promise<T>,
  shouldRetry: (error: Error) => boolean,
  options: RetryOptions = {}
): Promise<T> {
  const opts: Required<RetryOptions> = {
    maxAttempts: options.maxAttempts ?? config.sync.retryAttempts,
    backoffMultiplier: options.backoffMultiplier ?? config.sync.backoffMultiplier,
    initialDelayMs: options.initialDelayMs ?? 1000,
    maxDelayMs: options.maxDelayMs ?? 30000,
    onRetry: options.onRetry ?? (() => {}),
  };

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry if custom condition fails
      if (!shouldRetry(lastError)) {
        throw lastError;
      }

      // Don't retry if this was the last attempt
      if (attempt >= opts.maxAttempts) {
        break;
      }

      const delay = calculateDelay(attempt, opts);

      logger.warn('Operation failed, retrying...', {
        attempt,
        maxAttempts: opts.maxAttempts,
        delayMs: delay,
        error: getErrorMessage(lastError),
      });

      opts.onRetry(attempt, lastError);

      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Batch retry - retry multiple operations with backoff
 */
export async function retryBatch<T>(
  operations: (() => Promise<T>)[],
  options: RetryOptions = {}
): Promise<T[]> {
  return Promise.all(operations.map(op => retry(op, options)));
}
