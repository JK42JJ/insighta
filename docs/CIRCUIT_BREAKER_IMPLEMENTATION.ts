/**
 * Circuit Breaker Pattern Implementation
 *
 * Complete, production-ready implementation for preventing cascading failures.
 * Copy this to: src/utils/circuit-breaker.ts
 *
 * Features:
 * - Automatic state transitions (CLOSED → OPEN → HALF_OPEN)
 * - Configurable failure/success thresholds
 * - Time-based recovery attempts
 * - Comprehensive logging and monitoring
 * - TypeScript type safety
 *
 * @version 1.0.0
 * @since 2025-12-18
 */

import { logger } from './logger';

// ============================================================================
// Types and Enums
// ============================================================================

/**
 * Circuit breaker states
 */
export enum CircuitState {
  CLOSED = 'CLOSED', // Normal operation
  OPEN = 'OPEN', // Failing, reject all requests
  HALF_OPEN = 'HALF_OPEN', // Testing if service recovered
}

/**
 * Circuit breaker configuration options
 */
export interface CircuitBreakerOptions {
  /**
   * Number of failures before opening circuit
   * @default 5
   */
  failureThreshold: number;

  /**
   * Number of successes to close circuit from half-open
   * @default 2
   */
  successThreshold: number;

  /**
   * Time in ms before attempting to close circuit (transition to HALF_OPEN)
   * @default 60000 (1 minute)
   */
  timeout: number;

  /**
   * Time window for counting failures (ms)
   * Failures older than this are ignored
   * @default 120000 (2 minutes)
   */
  monitoringPeriod: number;
}

/**
 * Circuit breaker statistics
 */
export interface CircuitStats {
  name: string;
  state: CircuitState;
  recentFailureCount: number;
  successCount: number;
  lastFailureTime: string | null;
  nextAttemptTime: string | null;
  totalExecutions: number;
  totalFailures: number;
  totalSuccesses: number;
}

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Error thrown when circuit breaker is OPEN
 */
export class CircuitBreakerError extends Error {
  constructor(
    message: string = 'Circuit breaker is OPEN',
    public readonly circuitName: string,
    public readonly nextAttemptTime?: Date
  ) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

// ============================================================================
// Circuit Breaker Implementation
// ============================================================================

/**
 * Circuit Breaker
 *
 * Protects against cascading failures by automatically stopping
 * operations when failure rate exceeds threshold.
 *
 * **State Machine:**
 * ```
 * CLOSED --[failure threshold exceeded]--> OPEN
 * OPEN --[timeout expired]--> HALF_OPEN
 * HALF_OPEN --[success threshold met]--> CLOSED
 * HALF_OPEN --[any failure]--> OPEN
 * ```
 *
 * **Usage:**
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
 *     console.error('Service unavailable, circuit breaker is open');
 *   } else {
 *     // Actual operation error
 *     console.error('Operation failed:', error);
 *   }
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Initialize with custom options
 * const breaker = new CircuitBreaker('critical-service', {
 *   failureThreshold: 3, // Open after 3 failures
 *   successThreshold: 2, // Need 2 successes to close
 *   timeout: 30000, // Try recovery after 30 seconds
 *   monitoringPeriod: 60000, // Count failures in 1 minute window
 * });
 *
 * // Execute protected operation
 * const data = await breaker.execute(() => apiCall());
 *
 * // Monitor circuit state
 * console.log(breaker.getState()); // CLOSED, OPEN, or HALF_OPEN
 * console.log(breaker.getStats()); // Detailed statistics
 *
 * // Manual control
 * breaker.reset(); // Force close circuit
 * ```
 */
export class CircuitBreaker {
  // State
  private state: CircuitState = CircuitState.CLOSED;
  private successCount: number = 0;
  private nextAttemptTime: number = 0;

  // Failure tracking
  private failures: number[] = []; // Timestamps of recent failures

  // Statistics
  private totalExecutions: number = 0;
  private totalFailures: number = 0;
  private totalSuccesses: number = 0;

  constructor(
    private readonly name: string,
    private readonly options: CircuitBreakerOptions
  ) {
    this.validateOptions();
    logger.info('Circuit breaker initialized', {
      name,
      state: this.state,
      options,
    });
  }

  // ============================================================================
  // Public Methods
  // ============================================================================

  /**
   * Execute operation with circuit breaker protection
   *
   * @param operation - Async function to execute
   * @returns Result of the operation
   * @throws CircuitBreakerError if circuit is OPEN
   * @throws Original error if operation fails
   *
   * @example
   * ```typescript
   * const result = await breaker.execute(async () => {
   *   return await someAsyncOperation();
   * });
   * ```
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    this.totalExecutions++;

    // Check if circuit is open
    if (this.state === CircuitState.OPEN) {
      const now = Date.now();

      if (now < this.nextAttemptTime) {
        // Circuit still open, fail fast
        throw new CircuitBreakerError(
          `Circuit breaker '${this.name}' is OPEN. Next attempt at ${new Date(this.nextAttemptTime).toISOString()}`,
          this.name,
          new Date(this.nextAttemptTime)
        );
      }

      // Timeout expired, try half-open state
      this.transitionToHalfOpen();
    }

    try {
      // Execute operation
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  /**
   * Get current circuit state
   *
   * @returns Current state (CLOSED, OPEN, or HALF_OPEN)
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get circuit breaker statistics
   *
   * @returns Detailed statistics
   */
  getStats(): CircuitStats {
    const now = Date.now();
    const lastFailureTime = this.failures[this.failures.length - 1];

    return {
      name: this.name,
      state: this.state,
      recentFailureCount: this.failures.length,
      successCount: this.successCount,
      lastFailureTime: lastFailureTime ? new Date(lastFailureTime).toISOString() : null,
      nextAttemptTime:
        this.nextAttemptTime > now ? new Date(this.nextAttemptTime).toISOString() : null,
      totalExecutions: this.totalExecutions,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
    };
  }

  /**
   * Manually reset circuit to CLOSED state
   *
   * Useful for:
   * - Manual recovery after known issues are fixed
   * - Testing
   * - Administrative override
   *
   * @example
   * ```typescript
   * // After fixing the underlying issue
   * breaker.reset();
   * console.log(breaker.getState()); // 'CLOSED'
   * ```
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.successCount = 0;
    this.failures = [];
    this.nextAttemptTime = 0;

    logger.info('Circuit breaker manually reset to CLOSED', {
      name: this.name,
      stats: this.getStats(),
    });
  }

  /**
   * Force circuit to OPEN state
   *
   * Useful for:
   * - Planned maintenance
   * - Gradual service degradation
   * - Emergency shutoff
   *
   * @param timeoutMs - Optional custom timeout (overrides default)
   */
  forceOpen(timeoutMs?: number): void {
    const timeout = timeoutMs ?? this.options.timeout;
    this.state = CircuitState.OPEN;
    this.nextAttemptTime = Date.now() + timeout;

    logger.warn('Circuit breaker forcibly opened', {
      name: this.name,
      timeout,
      nextAttemptTime: new Date(this.nextAttemptTime).toISOString(),
    });
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Validate configuration options
   */
  private validateOptions(): void {
    const { failureThreshold, successThreshold, timeout, monitoringPeriod } = this.options;

    if (failureThreshold < 1) {
      throw new Error('failureThreshold must be >= 1');
    }
    if (successThreshold < 1) {
      throw new Error('successThreshold must be >= 1');
    }
    if (timeout < 0) {
      throw new Error('timeout must be >= 0');
    }
    if (monitoringPeriod < 0) {
      throw new Error('monitoringPeriod must be >= 0');
    }
  }

  /**
   * Handle successful operation
   */
  private onSuccess(): void {
    this.totalSuccesses++;

    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;

      logger.debug('Circuit breaker success in HALF_OPEN', {
        name: this.name,
        successCount: this.successCount,
        threshold: this.options.successThreshold,
      });

      if (this.successCount >= this.options.successThreshold) {
        this.transitionToClosed();
      }
    }
  }

  /**
   * Handle failed operation
   */
  private onFailure(error: unknown): void {
    this.totalFailures++;
    const now = Date.now();

    // Add failure timestamp
    this.failures.push(now);

    // Clean old failures outside monitoring period
    this.cleanOldFailures(now);

    logger.warn('Circuit breaker operation failed', {
      name: this.name,
      state: this.state,
      recentFailures: this.failures.length,
      threshold: this.options.failureThreshold,
      error: error instanceof Error ? error.message : String(error),
    });

    if (this.state === CircuitState.HALF_OPEN) {
      // Failed in half-open, go back to open
      this.transitionToOpen('Failed in HALF_OPEN state');
      return;
    }

    // Check if we should open the circuit
    if (this.failures.length >= this.options.failureThreshold) {
      this.transitionToOpen('Failure threshold exceeded');
    }
  }

  /**
   * Remove failures older than monitoring period
   */
  private cleanOldFailures(now: number): void {
    const cutoff = now - this.options.monitoringPeriod;
    this.failures = this.failures.filter((time) => time > cutoff);
  }

  /**
   * Transition to CLOSED state
   */
  private transitionToClosed(): void {
    this.state = CircuitState.CLOSED;
    this.successCount = 0;
    this.failures = [];
    this.nextAttemptTime = 0;

    logger.info('Circuit breaker transitioned to CLOSED', {
      name: this.name,
      stats: this.getStats(),
    });
  }

  /**
   * Transition to OPEN state
   */
  private transitionToOpen(reason: string): void {
    const now = Date.now();
    this.state = CircuitState.OPEN;
    this.successCount = 0;
    this.nextAttemptTime = now + this.options.timeout;

    logger.error('Circuit breaker transitioned to OPEN', {
      name: this.name,
      reason,
      failures: this.failures.length,
      threshold: this.options.failureThreshold,
      nextAttemptTime: new Date(this.nextAttemptTime).toISOString(),
      stats: this.getStats(),
    });
  }

  /**
   * Transition to HALF_OPEN state
   */
  private transitionToHalfOpen(): void {
    this.state = CircuitState.HALF_OPEN;
    this.successCount = 0;

    logger.info('Circuit breaker transitioned to HALF_OPEN', {
      name: this.name,
      stats: this.getStats(),
    });
  }
}

// ============================================================================
// Default Options
// ============================================================================

/**
 * Default circuit breaker options
 */
export const DEFAULT_CIRCUIT_BREAKER_OPTIONS: CircuitBreakerOptions = {
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 60000, // 1 minute
  monitoringPeriod: 120000, // 2 minutes
};

// ============================================================================
// Circuit Breaker Registry (Optional)
// ============================================================================

/**
 * Global registry for managing multiple circuit breakers
 *
 * @example
 * ```typescript
 * // Register circuit breakers
 * circuitBreakerRegistry.register('youtube-api', {
 *   failureThreshold: 5,
 *   successThreshold: 2,
 *   timeout: 60000,
 *   monitoringPeriod: 120000,
 * });
 *
 * // Get circuit breaker
 * const breaker = circuitBreakerRegistry.get('youtube-api');
 *
 * // Get all stats
 * const allStats = circuitBreakerRegistry.getAllStats();
 * ```
 */
export class CircuitBreakerRegistry {
  private breakers: Map<string, CircuitBreaker> = new Map();

  /**
   * Register a new circuit breaker
   */
  register(name: string, options: CircuitBreakerOptions): CircuitBreaker {
    if (this.breakers.has(name)) {
      logger.warn('Circuit breaker already exists, replacing', { name });
    }

    const breaker = new CircuitBreaker(name, options);
    this.breakers.set(name, breaker);
    return breaker;
  }

  /**
   * Get circuit breaker by name
   */
  get(name: string): CircuitBreaker | undefined {
    return this.breakers.get(name);
  }

  /**
   * Get or create circuit breaker
   */
  getOrCreate(name: string, options: CircuitBreakerOptions): CircuitBreaker {
    let breaker = this.breakers.get(name);
    if (!breaker) {
      breaker = this.register(name, options);
    }
    return breaker;
  }

  /**
   * Check if circuit breaker exists
   */
  has(name: string): boolean {
    return this.breakers.has(name);
  }

  /**
   * Remove circuit breaker
   */
  unregister(name: string): boolean {
    return this.breakers.delete(name);
  }

  /**
   * Get all circuit breaker names
   */
  getNames(): string[] {
    return Array.from(this.breakers.keys());
  }

  /**
   * Get stats for all circuit breakers
   */
  getAllStats(): CircuitStats[] {
    return Array.from(this.breakers.values()).map((breaker) => breaker.getStats());
  }

  /**
   * Reset all circuit breakers
   */
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }

  /**
   * Clear all circuit breakers
   */
  clear(): void {
    this.breakers.clear();
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

/**
 * Global circuit breaker registry singleton
 */
export const circuitBreakerRegistry = new CircuitBreakerRegistry();
