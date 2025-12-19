/**
 * Error Recovery Manager Unit Tests
 *
 * Tests for error recovery system with automatic strategies:
 * - Exponential backoff with jitter
 * - Circuit breaker pattern
 * - Error-specific recovery strategies
 * - Recovery state tracking
 */

import {
  ErrorRecoveryManager,
  getErrorRecoveryManager,
  resetErrorRecoveryManager,
  RecoveryStrategy,
  CircuitState,
} from '../../../src/utils/error-recovery';
import {
  NetworkError,
  RateLimitError,
  AuthenticationError,
  SyncConflictError,
  QuotaExceededError,
  AppError,
  ErrorSeverity,
} from '../../../src/utils/errors';
import { logger } from '../../../src/utils/logger';

// Mock logger
jest.mock('../../../src/utils/logger');

describe('ErrorRecoveryManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    resetErrorRecoveryManager();
  });

  describe('Constructor and initialization', () => {
    test('should create manager with default options', () => {
      const manager = new ErrorRecoveryManager();
      expect(manager).toBeInstanceOf(ErrorRecoveryManager);
      expect(manager.getCircuitState()).toBe(CircuitState.CLOSED);
    });

    test('should create manager with custom options', () => {
      const manager = new ErrorRecoveryManager({
        maxRetries: 10,
        initialDelayMs: 500,
        maxDelayMs: 60000,
        enableCircuitBreaker: false,
      });
      expect(manager).toBeInstanceOf(ErrorRecoveryManager);
    });

    test('should merge custom options with defaults', () => {
      const onRetry = jest.fn();
      const manager = new ErrorRecoveryManager({
        maxRetries: 7,
        onRecoveryAttempt: onRetry,
      });
      expect(manager).toBeInstanceOf(ErrorRecoveryManager);
    });
  });

  describe('executeWithRecovery - Success cases', () => {
    test('should return success on first attempt', async () => {
      const manager = new ErrorRecoveryManager();
      const operation = jest.fn().mockResolvedValue('success');

      const result = await manager.executeWithRecovery(operation);

      expect(result.success).toBe(true);
      expect(result.data).toBe('success');
      expect(result.attemptsUsed).toBe(1);
      expect(result.strategy).toBe(RecoveryStrategy.RETRY);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    test('should recover after network errors', async () => {
      const manager = new ErrorRecoveryManager();
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new NetworkError('Connection failed'))
        .mockRejectedValueOnce(new NetworkError('Connection failed'))
        .mockResolvedValue('success');

      const promise = manager.executeWithRecovery(operation);
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.data).toBe('success');
      expect(result.attemptsUsed).toBe(3);
      expect(operation).toHaveBeenCalledTimes(3);
    });

    test('should track recovery time', async () => {
      const manager = new ErrorRecoveryManager();
      const operation = jest.fn().mockResolvedValue('success');

      const result = await manager.executeWithRecovery(operation);

      expect(result.recoveryTime).toBeGreaterThanOrEqual(0);
    });

    test('should invoke onRecoverySuccess callback', async () => {
      const onSuccess = jest.fn();
      const manager = new ErrorRecoveryManager({
        onRecoverySuccess: onSuccess,
      });
      const operation = jest.fn().mockResolvedValue('success');

      await manager.executeWithRecovery(operation);

      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(onSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: 'success',
          attemptsUsed: 1,
        })
      );
    });
  });

  describe('executeWithRecovery - Failure cases', () => {
    test('should fail after max retries', async () => {
      const manager = new ErrorRecoveryManager({ maxRetries: 3 });
      const error = new NetworkError('Persistent failure');
      const operation = jest.fn().mockRejectedValue(error);

      const promise = manager.executeWithRecovery(operation);
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toBe(error);
      expect(result.attemptsUsed).toBe(3);
      expect(result.strategy).toBe(RecoveryStrategy.FAIL);
      expect(operation).toHaveBeenCalledTimes(3);
    });

    test('should fail immediately on non-recoverable errors', async () => {
      const manager = new ErrorRecoveryManager();
      const error = new QuotaExceededError();
      const operation = jest.fn().mockRejectedValue(error);

      const result = await manager.executeWithRecovery(operation);

      expect(result.success).toBe(false);
      expect(result.error).toBe(error);
      expect(result.attemptsUsed).toBe(1);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    test('should invoke onRecoveryFailure callback', async () => {
      const onFailure = jest.fn();
      const manager = new ErrorRecoveryManager({
        maxRetries: 2,
        onRecoveryFailure: onFailure,
      });
      const error = new NetworkError('Failure');
      const operation = jest.fn().mockRejectedValue(error);

      const promise = manager.executeWithRecovery(operation);
      await jest.runAllTimersAsync();
      await promise;

      expect(onFailure).toHaveBeenCalledTimes(1);
      expect(onFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error,
          attemptsUsed: 2,
        })
      );
    });
  });

  describe('Recovery strategies', () => {
    test('should apply RETRY strategy for NetworkError', async () => {
      const manager = new ErrorRecoveryManager();
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new NetworkError('Connection failed'))
        .mockResolvedValue('success');

      const promise = manager.executeWithRecovery(operation);
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        'Operation failed, determining recovery strategy',
        expect.objectContaining({
          strategy: RecoveryStrategy.RETRY,
        })
      );
    });

    test('should apply WAIT_AND_RETRY strategy for RateLimitError', async () => {
      const manager = new ErrorRecoveryManager();
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new RateLimitError('Rate limited'))
        .mockResolvedValue('success');

      const promise = manager.executeWithRecovery(operation);
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        'Operation failed, determining recovery strategy',
        expect.objectContaining({
          strategy: RecoveryStrategy.WAIT_AND_RETRY,
        })
      );
    });

    test('should apply REFRESH_AND_RETRY strategy for AuthenticationError', async () => {
      const manager = new ErrorRecoveryManager();
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new AuthenticationError())
        .mockResolvedValue('success');

      const promise = manager.executeWithRecovery(operation);
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        'Operation failed, determining recovery strategy',
        expect.objectContaining({
          strategy: RecoveryStrategy.REFRESH_AND_RETRY,
        })
      );
    });

    test('should apply RESOLVE_AND_RETRY strategy for SyncConflictError', async () => {
      const manager = new ErrorRecoveryManager();
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new SyncConflictError('Conflict detected'))
        .mockResolvedValue('success');

      const promise = manager.executeWithRecovery(operation);
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        'Operation failed, determining recovery strategy',
        expect.objectContaining({
          strategy: RecoveryStrategy.RESOLVE_AND_RETRY,
        })
      );
    });

    test('should apply FAIL strategy for QuotaExceededError', async () => {
      const manager = new ErrorRecoveryManager();
      const operation = jest.fn().mockRejectedValue(new QuotaExceededError());

      const result = await manager.executeWithRecovery(operation);

      expect(result.success).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        'Operation failed, determining recovery strategy',
        expect.objectContaining({
          strategy: RecoveryStrategy.FAIL,
        })
      );
    });

    test('should apply RETRY strategy for recoverable AppError', async () => {
      const manager = new ErrorRecoveryManager();
      const error = new AppError(
        'Recoverable error',
        'TEST_ERROR',
        500,
        true,
        {},
        ErrorSeverity.MEDIUM,
        true
      );
      const operation = jest.fn().mockRejectedValueOnce(error).mockResolvedValue('success');

      const promise = manager.executeWithRecovery(operation);
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
    });

    test('should apply FAIL strategy for non-recoverable AppError', async () => {
      const manager = new ErrorRecoveryManager();
      const error = new AppError(
        'Non-recoverable error',
        'TEST_ERROR',
        500,
        true,
        {},
        ErrorSeverity.CRITICAL,
        false
      );
      const operation = jest.fn().mockRejectedValue(error);

      const result = await manager.executeWithRecovery(operation);

      expect(result.success).toBe(false);
      expect(result.attemptsUsed).toBe(1);
    });

    test('should apply RETRY strategy for unknown errors', async () => {
      const manager = new ErrorRecoveryManager();
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error('Unknown error'))
        .mockResolvedValue('success');

      const promise = manager.executeWithRecovery(operation);
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
    });
  });

  describe('Exponential backoff', () => {
    test('should apply exponential backoff between retries', async () => {
      const manager = new ErrorRecoveryManager({
        initialDelayMs: 1000,
        backoffMultiplier: 2,
      });
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new NetworkError('Fail 1'))
        .mockRejectedValueOnce(new NetworkError('Fail 2'))
        .mockResolvedValue('success');

      const promise = manager.executeWithRecovery(operation);
      await jest.runAllTimersAsync();
      await promise;

      expect(logger.debug).toHaveBeenCalledWith(
        'Applying exponential backoff',
        expect.objectContaining({ attempt: 1, delayMs: 1150 })
      );
      expect(logger.debug).toHaveBeenCalledWith(
        'Applying exponential backoff',
        expect.objectContaining({ attempt: 2, delayMs: 2300 })
      );
    });

    test('should respect maxDelayMs cap', async () => {
      const manager = new ErrorRecoveryManager({
        initialDelayMs: 1000,
        backoffMultiplier: 100,
        maxDelayMs: 5000,
      });
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new NetworkError('Fail'))
        .mockResolvedValue('success');

      const promise = manager.executeWithRecovery(operation);
      await jest.runAllTimersAsync();
      await promise;

      expect(logger.debug).toHaveBeenCalledWith(
        'Applying exponential backoff',
        expect.objectContaining({ delayMs: 1150 })
      );
    });

    test('should add jitter to delays', async () => {
      const manager = new ErrorRecoveryManager({ initialDelayMs: 1000 });

      // Test with different jitter values
      jest.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(1);

      const operation1 = jest
        .fn()
        .mockRejectedValueOnce(new NetworkError('Fail'))
        .mockResolvedValue('success');
      const promise1 = manager.executeWithRecovery(operation1);
      await jest.runAllTimersAsync();
      await promise1;

      // 1000 + (0 * 0.3 * 1000) = 1000
      expect(logger.debug).toHaveBeenCalledWith(
        'Applying exponential backoff',
        expect.objectContaining({ delayMs: 1000 })
      );

      jest.clearAllMocks();

      const operation2 = jest
        .fn()
        .mockRejectedValueOnce(new NetworkError('Fail'))
        .mockResolvedValue('success');
      const promise2 = manager.executeWithRecovery(operation2);
      await jest.runAllTimersAsync();
      await promise2;

      // 1000 + (1 * 0.3 * 1000) = 1300
      expect(logger.debug).toHaveBeenCalledWith(
        'Applying exponential backoff',
        expect.objectContaining({ delayMs: 1300 })
      );
    });
  });

  describe('Circuit breaker', () => {
    test('should start in CLOSED state', () => {
      const manager = new ErrorRecoveryManager();
      expect(manager.getCircuitState()).toBe(CircuitState.CLOSED);
    });

    test('should open circuit after failure threshold', async () => {
      jest.useRealTimers(); // Need real timers for exponential backoff
      const manager = new ErrorRecoveryManager({
        maxRetries: 1,
        initialDelayMs: 1, // Use minimal delay
        circuitBreakerOptions: {
          failureThreshold: 3,
          successThreshold: 2,
          timeout: 5000,
        },
      });
      const operation = jest.fn().mockRejectedValue(new NetworkError('Failure'));

      // Trigger 3 failures
      await manager.executeWithRecovery(operation);
      await manager.executeWithRecovery(operation);
      await manager.executeWithRecovery(operation);

      expect(manager.getCircuitState()).toBe(CircuitState.OPEN);
      expect(logger.error).toHaveBeenCalledWith(
        'Circuit breaker opened due to repeated failures',
        expect.objectContaining({ failureCount: 3, threshold: 3 })
      );
    });

    test('should block requests when circuit is OPEN', async () => {
      jest.useRealTimers(); // Need real timers for exponential backoff
      const manager = new ErrorRecoveryManager({
        maxRetries: 1,
        initialDelayMs: 1, // Use minimal delay
        circuitBreakerOptions: {
          failureThreshold: 2,
          successThreshold: 2,
          timeout: 5000,
        },
      });
      const operation = jest.fn().mockRejectedValue(new NetworkError('Failure'));

      // Open the circuit
      await manager.executeWithRecovery(operation);
      await manager.executeWithRecovery(operation);

      expect(manager.getCircuitState()).toBe(CircuitState.OPEN);

      // Try another operation
      const result = await manager.executeWithRecovery(operation);

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Circuit breaker is open');
      expect(result.attemptsUsed).toBe(0);
    });

    test('should transition to HALF_OPEN after timeout', async () => {
      jest.useRealTimers();
      const manager = new ErrorRecoveryManager({
        maxRetries: 1,
        circuitBreakerOptions: {
          failureThreshold: 2,
          successThreshold: 2,
          timeout: 100,
        },
      });
      const operation = jest.fn().mockRejectedValue(new NetworkError('Failure'));

      // Open the circuit
      await manager.executeWithRecovery(operation);
      await manager.executeWithRecovery(operation);

      expect(manager.getCircuitState()).toBe(CircuitState.OPEN);

      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Next request should be allowed
      const successOp = jest.fn().mockResolvedValue('success');
      await manager.executeWithRecovery(successOp);

      expect(logger.info).toHaveBeenCalledWith('Circuit breaker transitioning to HALF_OPEN');
    });

    test('should close circuit after success threshold in HALF_OPEN', async () => {
      jest.useRealTimers();
      const manager = new ErrorRecoveryManager({
        maxRetries: 1,
        circuitBreakerOptions: {
          failureThreshold: 2,
          successThreshold: 2,
          timeout: 100,
        },
      });

      // Open the circuit
      const failOp = jest.fn().mockRejectedValue(new NetworkError('Failure'));
      await manager.executeWithRecovery(failOp);
      await manager.executeWithRecovery(failOp);

      expect(manager.getCircuitState()).toBe(CircuitState.OPEN);

      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Succeed twice
      const successOp = jest.fn().mockResolvedValue('success');
      await manager.executeWithRecovery(successOp);
      await manager.executeWithRecovery(successOp);

      expect(manager.getCircuitState()).toBe(CircuitState.CLOSED);
      expect(logger.info).toHaveBeenCalledWith('Circuit breaker closed after successful recovery');
    });

    test('should reopen circuit on failure in HALF_OPEN', async () => {
      jest.useRealTimers();
      const manager = new ErrorRecoveryManager({
        maxRetries: 1,
        circuitBreakerOptions: {
          failureThreshold: 2,
          successThreshold: 2,
          timeout: 100,
        },
      });

      // Open the circuit
      const failOp = jest.fn().mockRejectedValue(new NetworkError('Failure'));
      await manager.executeWithRecovery(failOp);
      await manager.executeWithRecovery(failOp);

      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Fail again
      await manager.executeWithRecovery(failOp);

      expect(manager.getCircuitState()).toBe(CircuitState.OPEN);
      expect(logger.warn).toHaveBeenCalledWith(
        'Circuit breaker reopened after failure in HALF_OPEN state'
      );
    });

    test('should allow disabling circuit breaker', async () => {
      jest.useRealTimers(); // Need real timers for exponential backoff
      const manager = new ErrorRecoveryManager({
        maxRetries: 1,
        initialDelayMs: 1, // Use minimal delay
        enableCircuitBreaker: false,
      });
      const operation = jest.fn().mockRejectedValue(new NetworkError('Failure'));

      // Multiple failures should not affect circuit state
      await manager.executeWithRecovery(operation);
      await manager.executeWithRecovery(operation);
      await manager.executeWithRecovery(operation);

      // Circuit should remain closed
      expect(manager.getCircuitState()).toBe(CircuitState.CLOSED);
    });

    test('should reset circuit breaker', () => {
      const manager = new ErrorRecoveryManager();
      manager.resetCircuit();
      expect(manager.getCircuitState()).toBe(CircuitState.CLOSED);
    });
  });

  describe('Callbacks', () => {
    test('should invoke onRecoveryAttempt for each retry', async () => {
      const onAttempt = jest.fn();
      const manager = new ErrorRecoveryManager({
        maxRetries: 3,
        onRecoveryAttempt: onAttempt,
      });
      const error = new NetworkError('Failure');
      const operation = jest.fn().mockRejectedValue(error);

      const promise = manager.executeWithRecovery(operation);
      await jest.runAllTimersAsync();
      await promise;

      expect(onAttempt).toHaveBeenCalledTimes(3);
      expect(onAttempt).toHaveBeenCalledWith(1, error, RecoveryStrategy.RETRY);
      expect(onAttempt).toHaveBeenCalledWith(2, error, RecoveryStrategy.RETRY);
      expect(onAttempt).toHaveBeenCalledWith(3, error, RecoveryStrategy.RETRY);
    });

    test('should pass context to callbacks', async () => {
      const onAttempt = jest.fn();
      const manager = new ErrorRecoveryManager({
        onRecoveryAttempt: onAttempt,
      });
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new NetworkError('Fail'))
        .mockResolvedValue('success');

      const promise = manager.executeWithRecovery(operation, { userId: '123' });
      await jest.runAllTimersAsync();
      await promise;

      expect(logger.warn).toHaveBeenCalledWith(
        'Operation failed, determining recovery strategy',
        expect.objectContaining({ context: { userId: '123' } })
      );
    });
  });

  describe('Singleton pattern', () => {
    test('should return same instance', () => {
      const manager1 = getErrorRecoveryManager();
      const manager2 = getErrorRecoveryManager();
      expect(manager1).toBe(manager2);
    });

    test('should reset singleton instance', () => {
      const manager1 = getErrorRecoveryManager();
      resetErrorRecoveryManager();
      const manager2 = getErrorRecoveryManager();
      expect(manager1).not.toBe(manager2);
    });

    test('should accept options on first call', () => {
      const manager = getErrorRecoveryManager({ maxRetries: 10 });
      expect(manager).toBeInstanceOf(ErrorRecoveryManager);
    });
  });

  describe('Edge cases', () => {
    test('should handle non-Error rejections', async () => {
      const manager = new ErrorRecoveryManager();
      const operation = jest.fn().mockRejectedValue('string error');

      const promise = manager.executeWithRecovery(operation);
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message).toBe('string error');
    });

    test('should handle operations that return undefined', async () => {
      const manager = new ErrorRecoveryManager();
      const operation = jest.fn().mockResolvedValue(undefined);

      const result = await manager.executeWithRecovery(operation);

      expect(result.success).toBe(true);
      expect(result.data).toBeUndefined();
    });

    test('should handle operations that return null', async () => {
      const manager = new ErrorRecoveryManager();
      const operation = jest.fn().mockResolvedValue(null);

      const result = await manager.executeWithRecovery(operation);

      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });

    test('should handle rate limit with custom retry time', async () => {
      const manager = new ErrorRecoveryManager();
      const error = new RateLimitError('Rate limited', { retryAfter: 5000 });
      const operation = jest.fn().mockRejectedValueOnce(error).mockResolvedValue('success');

      const promise = manager.executeWithRecovery(operation);
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(logger.info).toHaveBeenCalledWith(
        'Waiting for rate limit reset',
        expect.objectContaining({ waitTimeMs: 5000 })
      );
    });

    test('should handle maxRetries = 1', async () => {
      jest.useRealTimers(); // Need real timers for exponential backoff
      const manager = new ErrorRecoveryManager({
        maxRetries: 1,
        initialDelayMs: 1, // Use minimal delay
      });
      const operation = jest.fn().mockRejectedValue(new NetworkError('Failure'));

      const result = await manager.executeWithRecovery(operation);

      expect(result.success).toBe(false);
      expect(result.attemptsUsed).toBe(1);
      expect(operation).toHaveBeenCalledTimes(1);
    });
  });
});
