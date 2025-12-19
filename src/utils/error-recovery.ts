/**
 * Error Recovery Manager
 *
 * Implements automatic error recovery strategies:
 * - Exponential backoff with jitter for retries
 * - Circuit breaker pattern for failing services
 * - Error-specific recovery strategies
 * - Recovery state tracking and logging
 */

import { logger } from './logger';
import {
  AppError,
  NetworkError,
  RateLimitError,
  AuthenticationError,
  SyncConflictError,
  QuotaExceededError,
} from './errors';

/**
 * Circuit breaker states
 */
export enum CircuitState {
  CLOSED = 'closed',     // Normal operation
  OPEN = 'open',         // Circuit is open, blocking requests
  HALF_OPEN = 'half_open', // Testing if service recovered
}

/**
 * Recovery strategy types
 */
export enum RecoveryStrategy {
  RETRY = 'retry',                      // Retry with exponential backoff
  WAIT_AND_RETRY = 'wait_and_retry',    // Wait specified time then retry
  REFRESH_AND_RETRY = 'refresh_and_retry', // Refresh credentials then retry
  RESOLVE_AND_RETRY = 'resolve_and_retry', // Resolve conflict then retry
  SKIP = 'skip',                        // Skip operation
  FAIL = 'fail',                        // Fail immediately
}

/**
 * Recovery attempt result
 */
export interface RecoveryResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  attemptsUsed: number;
  strategy: RecoveryStrategy;
  recoveryTime: number;
}

/**
 * Circuit breaker options
 */
export interface CircuitBreakerOptions {
  failureThreshold: number;  // Number of failures before opening circuit
  successThreshold: number;  // Number of successes to close circuit
  timeout: number;           // Time in ms to wait before attempting half-open
}

/**
 * Recovery manager options
 */
export interface ErrorRecoveryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  enableCircuitBreaker?: boolean;
  circuitBreakerOptions?: Partial<CircuitBreakerOptions>;
  onRecoveryAttempt?: (attempt: number, error: Error, strategy: RecoveryStrategy) => void;
  onRecoverySuccess?: (result: RecoveryResult<any>) => void;
  onRecoveryFailure?: (result: RecoveryResult<any>) => void;
}

/**
 * Default options
 */
const DEFAULT_OPTIONS: Required<ErrorRecoveryOptions> = {
  maxRetries: 5,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  enableCircuitBreaker: true,
  circuitBreakerOptions: {
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 60000,
  },
  onRecoveryAttempt: () => {},
  onRecoverySuccess: () => {},
  onRecoveryFailure: () => {},
};

/**
 * Circuit breaker for service protection
 */
class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private nextAttemptTime: number = 0;
  private readonly options: CircuitBreakerOptions;

  constructor(options: Partial<CircuitBreakerOptions> = {}) {
    this.options = {
      failureThreshold: options.failureThreshold ?? 5,
      successThreshold: options.successThreshold ?? 2,
      timeout: options.timeout ?? 60000,
    };
  }

  /**
   * Check if request should be allowed
   */
  public allowRequest(): boolean {
    if (this.state === CircuitState.CLOSED) {
      return true;
    }

    if (this.state === CircuitState.OPEN) {
      if (Date.now() >= this.nextAttemptTime) {
        this.state = CircuitState.HALF_OPEN;
        this.successCount = 0;
        logger.info('Circuit breaker transitioning to HALF_OPEN');
        return true;
      }
      return false;
    }

    // HALF_OPEN state
    return true;
  }

  /**
   * Record successful request
   */
  public recordSuccess(): void {
    this.failureCount = 0;

    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.options.successThreshold) {
        this.state = CircuitState.CLOSED;
        this.successCount = 0;
        logger.info('Circuit breaker closed after successful recovery');
      }
    }
  }

  /**
   * Record failed request
   */
  public recordFailure(): void {
    this.failureCount++;

    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.OPEN;
      this.nextAttemptTime = Date.now() + this.options.timeout;
      logger.warn('Circuit breaker reopened after failure in HALF_OPEN state');
      return;
    }

    if (this.failureCount >= this.options.failureThreshold) {
      this.state = CircuitState.OPEN;
      this.nextAttemptTime = Date.now() + this.options.timeout;
      logger.error('Circuit breaker opened due to repeated failures', {
        failureCount: this.failureCount,
        threshold: this.options.failureThreshold,
      });
    }
  }

  /**
   * Get current state
   */
  public getState(): CircuitState {
    return this.state;
  }

  /**
   * Reset circuit breaker
   */
  public reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttemptTime = 0;
  }
}

/**
 * Error Recovery Manager
 */
export class ErrorRecoveryManager {
  private readonly options: Required<ErrorRecoveryOptions>;
  private readonly circuitBreaker: CircuitBreaker;

  constructor(options: ErrorRecoveryOptions = {}) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
      circuitBreakerOptions: {
        ...DEFAULT_OPTIONS.circuitBreakerOptions,
        ...options.circuitBreakerOptions,
      },
    };
    this.circuitBreaker = new CircuitBreaker(this.options.circuitBreakerOptions);
  }

  /**
   * Execute operation with automatic recovery
   */
  public async executeWithRecovery<T>(
    operation: () => Promise<T>,
    context?: Record<string, any>
  ): Promise<RecoveryResult<T>> {
    const startTime = Date.now();
    let attemptsUsed = 0;
    let lastError: Error | undefined;

    // Check circuit breaker
    if (this.options.enableCircuitBreaker && !this.circuitBreaker.allowRequest()) {
      return {
        success: false,
        error: new Error('Circuit breaker is open'),
        attemptsUsed: 0,
        strategy: RecoveryStrategy.FAIL,
        recoveryTime: Date.now() - startTime,
      };
    }

    for (let attempt = 1; attempt <= this.options.maxRetries; attempt++) {
      attemptsUsed++;

      try {
        const result = await operation();

        // Record success in circuit breaker
        if (this.options.enableCircuitBreaker) {
          this.circuitBreaker.recordSuccess();
        }

        const recoveryResult: RecoveryResult<T> = {
          success: true,
          data: result,
          attemptsUsed,
          strategy: attempt > 1 ? RecoveryStrategy.RETRY : RecoveryStrategy.RETRY,
          recoveryTime: Date.now() - startTime,
        };

        this.options.onRecoverySuccess(recoveryResult);

        return recoveryResult;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Record failure in circuit breaker
        if (this.options.enableCircuitBreaker) {
          this.circuitBreaker.recordFailure();
        }

        // Determine recovery strategy
        const strategy = this.determineRecoveryStrategy(lastError);

        logger.warn('Operation failed, determining recovery strategy', {
          attempt,
          maxRetries: this.options.maxRetries,
          errorCode: lastError instanceof AppError ? lastError.code : 'UNKNOWN',
          strategy,
          context,
        });

        this.options.onRecoveryAttempt(attempt, lastError, strategy);

        // Execute recovery strategy
        const shouldContinue = await this.executeRecoveryStrategy(
          strategy,
          lastError,
          attempt,
          context
        );

        if (!shouldContinue || attempt >= this.options.maxRetries) {
          break;
        }
      }
    }

    // Recovery failed
    const recoveryResult: RecoveryResult<T> = {
      success: false,
      error: lastError,
      attemptsUsed,
      strategy: RecoveryStrategy.FAIL,
      recoveryTime: Date.now() - startTime,
    };

    this.options.onRecoveryFailure(recoveryResult);

    logger.error('Recovery failed after all attempts', {
      attemptsUsed,
      error: lastError?.message,
      context,
    });

    return recoveryResult;
  }

  /**
   * Determine recovery strategy for error
   */
  private determineRecoveryStrategy(error: Error): RecoveryStrategy {
    if (error instanceof NetworkError) {
      return RecoveryStrategy.RETRY;
    }

    if (error instanceof RateLimitError) {
      return RecoveryStrategy.WAIT_AND_RETRY;
    }

    if (error instanceof AuthenticationError) {
      return RecoveryStrategy.REFRESH_AND_RETRY;
    }

    if (error instanceof SyncConflictError) {
      return RecoveryStrategy.RESOLVE_AND_RETRY;
    }

    if (error instanceof QuotaExceededError) {
      return RecoveryStrategy.FAIL; // Cannot recover from quota exhaustion
    }

    if (error instanceof AppError) {
      return error.recoverable ? RecoveryStrategy.RETRY : RecoveryStrategy.FAIL;
    }

    // Unknown errors are retryable by default
    return RecoveryStrategy.RETRY;
  }

  /**
   * Execute recovery strategy
   */
  private async executeRecoveryStrategy(
    strategy: RecoveryStrategy,
    error: Error,
    attempt: number,
    context?: Record<string, any>
  ): Promise<boolean> {
    switch (strategy) {
      case RecoveryStrategy.RETRY:
        await this.exponentialBackoff(attempt);
        return true;

      case RecoveryStrategy.WAIT_AND_RETRY:
        await this.waitForRateLimit(error as RateLimitError);
        return true;

      case RecoveryStrategy.REFRESH_AND_RETRY:
        await this.refreshAuthentication(context);
        await this.exponentialBackoff(attempt);
        return true;

      case RecoveryStrategy.RESOLVE_AND_RETRY:
        await this.resolveConflict(error as SyncConflictError, context);
        await this.exponentialBackoff(attempt);
        return true;

      case RecoveryStrategy.SKIP:
      case RecoveryStrategy.FAIL:
        return false;

      default:
        return false;
    }
  }

  /**
   * Exponential backoff with jitter
   */
  private async exponentialBackoff(attempt: number): Promise<void> {
    const exponentialDelay =
      this.options.initialDelayMs * Math.pow(this.options.backoffMultiplier, attempt - 1);
    const jitter = Math.random() * 0.3 * exponentialDelay;
    const delay = Math.min(exponentialDelay + jitter, this.options.maxDelayMs);

    logger.debug('Applying exponential backoff', {
      attempt,
      delayMs: Math.floor(delay),
    });

    await this.sleep(delay);
  }

  /**
   * Wait for rate limit to reset
   */
  private async waitForRateLimit(error: RateLimitError): Promise<void> {
    const retryAfter = error.details?.['retryAfter'] ?? 60000; // Default 1 minute
    const waitTime = Math.min(retryAfter as number, this.options.maxDelayMs);

    logger.info('Waiting for rate limit reset', {
      waitTimeMs: waitTime,
    });

    await this.sleep(waitTime);
  }

  /**
   * Refresh authentication credentials
   */
  private async refreshAuthentication(context?: Record<string, any>): Promise<void> {
    logger.info('Attempting to refresh authentication', { context });

    // This would integrate with the authentication system
    // For now, just log the attempt
    // TODO: Implement actual token refresh logic
  }

  /**
   * Resolve sync conflict
   */
  private async resolveConflict(
    error: SyncConflictError,
    context?: Record<string, any>
  ): Promise<void> {
    logger.info('Attempting to resolve sync conflict', {
      error: error.message,
      context,
    });

    // This would implement conflict resolution logic
    // For now, just log the attempt
    // TODO: Implement actual conflict resolution logic
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get circuit breaker state
   */
  public getCircuitState(): CircuitState {
    return this.circuitBreaker.getState();
  }

  /**
   * Reset circuit breaker
   */
  public resetCircuit(): void {
    this.circuitBreaker.reset();
  }
}

/**
 * Create singleton instance
 */
let managerInstance: ErrorRecoveryManager | null = null;

/**
 * Get error recovery manager instance
 */
export function getErrorRecoveryManager(options?: ErrorRecoveryOptions): ErrorRecoveryManager {
  if (!managerInstance) {
    managerInstance = new ErrorRecoveryManager(options);
  }
  return managerInstance;
}

/**
 * Reset singleton instance (useful for testing)
 */
export function resetErrorRecoveryManager(): void {
  managerInstance = null;
}
