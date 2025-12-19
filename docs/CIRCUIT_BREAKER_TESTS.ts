/**
 * Circuit Breaker Unit Tests
 *
 * Comprehensive test suite for circuit breaker pattern implementation.
 * Copy this to: tests/unit/utils/circuit-breaker.test.ts
 *
 * Test Coverage:
 * - State transitions (CLOSED → OPEN → HALF_OPEN → CLOSED)
 * - Failure threshold logic
 * - Success threshold logic
 * - Timeout and monitoring period
 * - Manual reset and force open
 * - Statistics and monitoring
 * - Edge cases and error scenarios
 * - Circuit breaker registry
 *
 * @version 1.0.0
 * @since 2025-12-18
 */

import {
  CircuitBreaker,
  CircuitState,
  CircuitBreakerError,
  CircuitBreakerOptions,
  circuitBreakerRegistry,
  CircuitBreakerRegistry,
  DEFAULT_CIRCUIT_BREAKER_OPTIONS,
} from '../../../src/utils/circuit-breaker';
import { logger } from '../../../src/utils/logger';

// Mock logger
jest.mock('../../../src/utils/logger');

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;
  const defaultOptions: CircuitBreakerOptions = {
    failureThreshold: 3,
    successThreshold: 2,
    timeout: 1000,
    monitoringPeriod: 5000,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    breaker = new CircuitBreaker('test-service', defaultOptions);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ============================================================================
  // Initialization
  // ============================================================================

  describe('Initialization', () => {
    test('should initialize in CLOSED state', () => {
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    test('should validate options', () => {
      expect(() => {
        new CircuitBreaker('invalid', {
          ...defaultOptions,
          failureThreshold: 0,
        });
      }).toThrow('failureThreshold must be >= 1');

      expect(() => {
        new CircuitBreaker('invalid', {
          ...defaultOptions,
          successThreshold: 0,
        });
      }).toThrow('successThreshold must be >= 1');

      expect(() => {
        new CircuitBreaker('invalid', {
          ...defaultOptions,
          timeout: -1,
        });
      }).toThrow('timeout must be >= 0');

      expect(() => {
        new CircuitBreaker('invalid', {
          ...defaultOptions,
          monitoringPeriod: -1,
        });
      }).toThrow('monitoringPeriod must be >= 0');
    });

    test('should log initialization', () => {
      expect(logger.info).toHaveBeenCalledWith(
        'Circuit breaker initialized',
        expect.objectContaining({
          name: 'test-service',
          state: CircuitState.CLOSED,
        })
      );
    });
  });

  // ============================================================================
  // State Transitions: CLOSED → OPEN
  // ============================================================================

  describe('State Transition: CLOSED → OPEN', () => {
    test('should open circuit after failure threshold exceeded', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Fail'));

      // Execute failures
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(operation)).rejects.toThrow('Fail');
      }

      expect(breaker.getState()).toBe(CircuitState.OPEN);
      expect(logger.error).toHaveBeenCalledWith(
        'Circuit breaker transitioned to OPEN',
        expect.objectContaining({
          name: 'test-service',
          reason: 'Failure threshold exceeded',
        })
      );
    });

    test('should not open circuit if failures below threshold', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Fail'));

      // Execute failures below threshold
      for (let i = 0; i < 2; i++) {
        await expect(breaker.execute(operation)).rejects.toThrow('Fail');
      }

      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    test('should fail fast when circuit is OPEN', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Fail'));

      // Trigger circuit open
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(operation)).rejects.toThrow('Fail');
      }

      // Try to execute - should fail fast
      await expect(breaker.execute(operation)).rejects.toThrow(CircuitBreakerError);

      // Operation should not be called
      expect(operation).toHaveBeenCalledTimes(3); // Only initial failures
    });

    test('should include next attempt time in error', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Fail'));

      // Trigger circuit open
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(operation)).rejects.toThrow('Fail');
      }

      // Try to execute
      try {
        await breaker.execute(operation);
        fail('Should have thrown CircuitBreakerError');
      } catch (error) {
        expect(error).toBeInstanceOf(CircuitBreakerError);
        expect((error as CircuitBreakerError).nextAttemptTime).toBeInstanceOf(Date);
        expect((error as CircuitBreakerError).circuitName).toBe('test-service');
      }
    });
  });

  // ============================================================================
  // State Transitions: OPEN → HALF_OPEN
  // ============================================================================

  describe('State Transition: OPEN → HALF_OPEN', () => {
    test('should transition to HALF_OPEN after timeout', async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error('Fail'))
        .mockRejectedValueOnce(new Error('Fail'))
        .mockRejectedValueOnce(new Error('Fail'))
        .mockResolvedValue('success');

      // Trigger circuit open
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(operation)).rejects.toThrow('Fail');
      }

      expect(breaker.getState()).toBe(CircuitState.OPEN);

      // Advance time past timeout
      jest.advanceTimersByTime(1000);

      // Try to execute - should transition to HALF_OPEN
      const result = await breaker.execute(operation);

      expect(result).toBe('success');
      expect(logger.info).toHaveBeenCalledWith(
        'Circuit breaker transitioned to HALF_OPEN',
        expect.objectContaining({
          name: 'test-service',
        })
      );
    });

    test('should not transition to HALF_OPEN before timeout', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Fail'));

      // Trigger circuit open
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(operation)).rejects.toThrow('Fail');
      }

      // Advance time but not past timeout
      jest.advanceTimersByTime(500);

      // Try to execute - should still fail fast
      await expect(breaker.execute(operation)).rejects.toThrow(CircuitBreakerError);

      expect(breaker.getState()).toBe(CircuitState.OPEN);
    });
  });

  // ============================================================================
  // State Transitions: HALF_OPEN → CLOSED
  // ============================================================================

  describe('State Transition: HALF_OPEN → CLOSED', () => {
    test('should close circuit after success threshold in HALF_OPEN', async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error('Fail'))
        .mockRejectedValueOnce(new Error('Fail'))
        .mockRejectedValueOnce(new Error('Fail'))
        .mockResolvedValueOnce('success1')
        .mockResolvedValue('success2');

      // Open circuit
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(operation)).rejects.toThrow('Fail');
      }

      // Advance past timeout
      jest.advanceTimersByTime(1000);

      // Execute successes to close circuit
      await breaker.execute(operation); // success1
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

      await breaker.execute(operation); // success2
      expect(breaker.getState()).toBe(CircuitState.CLOSED);

      expect(logger.info).toHaveBeenCalledWith(
        'Circuit breaker transitioned to CLOSED',
        expect.objectContaining({
          name: 'test-service',
        })
      );
    });

    test('should not close circuit if success threshold not met', async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error('Fail'))
        .mockRejectedValueOnce(new Error('Fail'))
        .mockRejectedValueOnce(new Error('Fail'))
        .mockResolvedValue('success');

      // Open circuit
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(operation)).rejects.toThrow('Fail');
      }

      // Advance past timeout
      jest.advanceTimersByTime(1000);

      // Execute one success (below threshold)
      await breaker.execute(operation);

      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);
    });
  });

  // ============================================================================
  // State Transitions: HALF_OPEN → OPEN
  // ============================================================================

  describe('State Transition: HALF_OPEN → OPEN', () => {
    test('should reopen circuit if failure occurs in HALF_OPEN', async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error('Fail'))
        .mockRejectedValueOnce(new Error('Fail'))
        .mockRejectedValueOnce(new Error('Fail'))
        .mockRejectedValue(new Error('Fail again'));

      // Open circuit
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(operation)).rejects.toThrow('Fail');
      }

      // Advance past timeout
      jest.advanceTimersByTime(1000);

      // Fail in HALF_OPEN
      await expect(breaker.execute(operation)).rejects.toThrow('Fail again');

      expect(breaker.getState()).toBe(CircuitState.OPEN);
      expect(logger.error).toHaveBeenCalledWith(
        'Circuit breaker transitioned to OPEN',
        expect.objectContaining({
          reason: 'Failed in HALF_OPEN state',
        })
      );
    });

    test('should reset success count when reopening from HALF_OPEN', async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error('Fail'))
        .mockRejectedValueOnce(new Error('Fail'))
        .mockRejectedValueOnce(new Error('Fail'))
        .mockResolvedValueOnce('success1')
        .mockRejectedValueOnce(new Error('Fail again'))
        .mockResolvedValueOnce('success2')
        .mockResolvedValue('success3');

      // Open circuit
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(operation)).rejects.toThrow('Fail');
      }

      // Advance past timeout
      jest.advanceTimersByTime(1000);

      // One success in HALF_OPEN
      await breaker.execute(operation);
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

      // Fail - should reopen
      await expect(breaker.execute(operation)).rejects.toThrow('Fail again');
      expect(breaker.getState()).toBe(CircuitState.OPEN);

      // Advance past timeout again
      jest.advanceTimersByTime(1000);

      // Need full success threshold again (not just 1 more)
      await breaker.execute(operation); // success2
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

      await breaker.execute(operation); // success3
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });
  });

  // ============================================================================
  // Monitoring Period
  // ============================================================================

  describe('Monitoring Period', () => {
    test('should ignore failures outside monitoring period', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Fail'));

      // First failure
      await expect(breaker.execute(operation)).rejects.toThrow('Fail');

      // Advance time past monitoring period
      jest.advanceTimersByTime(6000);

      // Two more failures (should not trigger circuit open since first is expired)
      await expect(breaker.execute(operation)).rejects.toThrow('Fail');
      await expect(breaker.execute(operation)).rejects.toThrow('Fail');

      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    test('should count only recent failures within monitoring period', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Fail'));

      // Two failures
      await expect(breaker.execute(operation)).rejects.toThrow('Fail');
      await expect(breaker.execute(operation)).rejects.toThrow('Fail');

      // Advance time but within monitoring period
      jest.advanceTimersByTime(4000);

      // One more failure - should trigger circuit open
      await expect(breaker.execute(operation)).rejects.toThrow('Fail');

      expect(breaker.getState()).toBe(CircuitState.OPEN);
    });

    test('should clean old failures when adding new ones', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Fail'));

      // Add failure
      await expect(breaker.execute(operation)).rejects.toThrow('Fail');

      let stats = breaker.getStats();
      expect(stats.recentFailureCount).toBe(1);

      // Advance past monitoring period
      jest.advanceTimersByTime(6000);

      // Add another failure - should clean old one
      await expect(breaker.execute(operation)).rejects.toThrow('Fail');

      stats = breaker.getStats();
      expect(stats.recentFailureCount).toBe(1); // Old failure cleaned
    });
  });

  // ============================================================================
  // Statistics
  // ============================================================================

  describe('Statistics', () => {
    test('should track total executions', async () => {
      const operation = jest
        .fn()
        .mockResolvedValueOnce('success1')
        .mockResolvedValueOnce('success2')
        .mockRejectedValue(new Error('Fail'));

      await breaker.execute(operation);
      await breaker.execute(operation);
      await expect(breaker.execute(operation)).rejects.toThrow('Fail');

      const stats = breaker.getStats();
      expect(stats.totalExecutions).toBe(3);
    });

    test('should track successes and failures separately', async () => {
      const operation = jest
        .fn()
        .mockResolvedValueOnce('success1')
        .mockResolvedValueOnce('success2')
        .mockRejectedValueOnce(new Error('Fail1'))
        .mockRejectedValue(new Error('Fail2'));

      await breaker.execute(operation);
      await breaker.execute(operation);
      await expect(breaker.execute(operation)).rejects.toThrow('Fail1');
      await expect(breaker.execute(operation)).rejects.toThrow('Fail2');

      const stats = breaker.getStats();
      expect(stats.totalSuccesses).toBe(2);
      expect(stats.totalFailures).toBe(2);
    });

    test('should include last failure time', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Fail'));

      const beforeFailure = breaker.getStats();
      expect(beforeFailure.lastFailureTime).toBeNull();

      await expect(breaker.execute(operation)).rejects.toThrow('Fail');

      const afterFailure = breaker.getStats();
      expect(afterFailure.lastFailureTime).not.toBeNull();
      expect(new Date(afterFailure.lastFailureTime!).getTime()).toBeLessThanOrEqual(Date.now());
    });

    test('should include next attempt time when circuit is OPEN', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Fail'));

      // Open circuit
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(operation)).rejects.toThrow('Fail');
      }

      const stats = breaker.getStats();
      expect(stats.nextAttemptTime).not.toBeNull();
      expect(new Date(stats.nextAttemptTime!).getTime()).toBeGreaterThan(Date.now());
    });

    test('should show correct state in stats', async () => {
      expect(breaker.getStats().state).toBe(CircuitState.CLOSED);

      const operation = jest.fn().mockRejectedValue(new Error('Fail'));

      // Open circuit
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(operation)).rejects.toThrow('Fail');
      }

      expect(breaker.getStats().state).toBe(CircuitState.OPEN);

      // Advance to HALF_OPEN
      jest.advanceTimersByTime(1000);
      operation.mockResolvedValueOnce('success');
      await breaker.execute(operation);

      expect(breaker.getStats().state).toBe(CircuitState.HALF_OPEN);
    });
  });

  // ============================================================================
  // Manual Control
  // ============================================================================

  describe('Manual Control', () => {
    test('should manually reset circuit to CLOSED', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Fail'));

      // Open circuit
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(operation)).rejects.toThrow('Fail');
      }

      expect(breaker.getState()).toBe(CircuitState.OPEN);

      // Manual reset
      breaker.reset();

      expect(breaker.getState()).toBe(CircuitState.CLOSED);
      expect(logger.info).toHaveBeenCalledWith(
        'Circuit breaker manually reset to CLOSED',
        expect.objectContaining({
          name: 'test-service',
        })
      );
    });

    test('should clear failure counts on reset', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Fail'));

      // Add failures
      await expect(breaker.execute(operation)).rejects.toThrow('Fail');
      await expect(breaker.execute(operation)).rejects.toThrow('Fail');

      let stats = breaker.getStats();
      expect(stats.recentFailureCount).toBe(2);

      // Reset
      breaker.reset();

      stats = breaker.getStats();
      expect(stats.recentFailureCount).toBe(0);
      expect(stats.successCount).toBe(0);
    });

    test('should force circuit to OPEN state', async () => {
      expect(breaker.getState()).toBe(CircuitState.CLOSED);

      breaker.forceOpen();

      expect(breaker.getState()).toBe(CircuitState.OPEN);
      expect(logger.warn).toHaveBeenCalledWith(
        'Circuit breaker forcibly opened',
        expect.objectContaining({
          name: 'test-service',
        })
      );
    });

    test('should use custom timeout when forcing open', async () => {
      breaker.forceOpen(5000);

      const stats = breaker.getStats();
      expect(stats.nextAttemptTime).not.toBeNull();

      // Advance by default timeout (1000ms) - should still be closed
      jest.advanceTimersByTime(1000);

      const operation = jest.fn().mockResolvedValue('success');
      await expect(breaker.execute(operation)).rejects.toThrow(CircuitBreakerError);

      // Advance by custom timeout (5000ms total)
      jest.advanceTimersByTime(4000);
      await breaker.execute(operation); // Should succeed now
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('Edge Cases', () => {
    test('should handle operation returning different types', async () => {
      const stringOp = jest.fn().mockResolvedValue('string');
      const numberOp = jest.fn().mockResolvedValue(123);
      const objectOp = jest.fn().mockResolvedValue({ key: 'value' });
      const arrayOp = jest.fn().mockResolvedValue([1, 2, 3]);

      expect(await breaker.execute(stringOp)).toBe('string');
      expect(await breaker.execute(numberOp)).toBe(123);
      expect(await breaker.execute(objectOp)).toEqual({ key: 'value' });
      expect(await breaker.execute(arrayOp)).toEqual([1, 2, 3]);
    });

    test('should handle operation throwing different error types', async () => {
      const errorOp = jest.fn().mockRejectedValue(new Error('Error'));
      const stringOp = jest.fn().mockRejectedValue('String error');
      const objectOp = jest.fn().mockRejectedValue({ error: 'Object error' });

      await expect(breaker.execute(errorOp)).rejects.toThrow('Error');
      await expect(breaker.execute(stringOp)).rejects.toBe('String error');
      await expect(breaker.execute(objectOp)).rejects.toEqual({ error: 'Object error' });
    });

    test('should handle very high failure threshold', async () => {
      const highThresholdBreaker = new CircuitBreaker('high-threshold', {
        ...defaultOptions,
        failureThreshold: 100,
      });

      const operation = jest.fn().mockRejectedValue(new Error('Fail'));

      // Execute 99 failures
      for (let i = 0; i < 99; i++) {
        await expect(highThresholdBreaker.execute(operation)).rejects.toThrow('Fail');
      }

      expect(highThresholdBreaker.getState()).toBe(CircuitState.CLOSED);

      // 100th failure should open
      await expect(highThresholdBreaker.execute(operation)).rejects.toThrow('Fail');
      expect(highThresholdBreaker.getState()).toBe(CircuitState.OPEN);
    });

    test('should handle zero timeout (immediate recovery attempt)', async () => {
      const zeroTimeoutBreaker = new CircuitBreaker('zero-timeout', {
        ...defaultOptions,
        timeout: 0,
      });

      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error('Fail'))
        .mockRejectedValueOnce(new Error('Fail'))
        .mockRejectedValueOnce(new Error('Fail'))
        .mockResolvedValue('success');

      // Open circuit
      for (let i = 0; i < 3; i++) {
        await expect(zeroTimeoutBreaker.execute(operation)).rejects.toThrow('Fail');
      }

      // Should immediately allow retry (no timeout)
      const result = await zeroTimeoutBreaker.execute(operation);
      expect(result).toBe('success');
    });
  });
});

// ============================================================================
// Circuit Breaker Registry Tests
// ============================================================================

describe('CircuitBreakerRegistry', () => {
  let registry: CircuitBreakerRegistry;

  beforeEach(() => {
    registry = new CircuitBreakerRegistry();
    jest.clearAllMocks();
  });

  describe('Registration', () => {
    test('should register circuit breaker', () => {
      const breaker = registry.register('service1', DEFAULT_CIRCUIT_BREAKER_OPTIONS);

      expect(breaker).toBeInstanceOf(CircuitBreaker);
      expect(registry.has('service1')).toBe(true);
    });

    test('should replace existing circuit breaker with warning', () => {
      registry.register('service1', DEFAULT_CIRCUIT_BREAKER_OPTIONS);
      registry.register('service1', DEFAULT_CIRCUIT_BREAKER_OPTIONS);

      expect(logger.warn).toHaveBeenCalledWith(
        'Circuit breaker already exists, replacing',
        expect.objectContaining({ name: 'service1' })
      );
    });

    test('should get circuit breaker by name', () => {
      const registered = registry.register('service1', DEFAULT_CIRCUIT_BREAKER_OPTIONS);
      const retrieved = registry.get('service1');

      expect(retrieved).toBe(registered);
    });

    test('should return undefined for non-existent circuit breaker', () => {
      expect(registry.get('non-existent')).toBeUndefined();
    });

    test('should get or create circuit breaker', () => {
      const breaker1 = registry.getOrCreate('service1', DEFAULT_CIRCUIT_BREAKER_OPTIONS);
      const breaker2 = registry.getOrCreate('service1', DEFAULT_CIRCUIT_BREAKER_OPTIONS);

      expect(breaker1).toBe(breaker2); // Should return same instance
    });

    test('should unregister circuit breaker', () => {
      registry.register('service1', DEFAULT_CIRCUIT_BREAKER_OPTIONS);

      expect(registry.unregister('service1')).toBe(true);
      expect(registry.has('service1')).toBe(false);
    });

    test('should return false when unregistering non-existent breaker', () => {
      expect(registry.unregister('non-existent')).toBe(false);
    });
  });

  describe('Querying', () => {
    beforeEach(() => {
      registry.register('service1', DEFAULT_CIRCUIT_BREAKER_OPTIONS);
      registry.register('service2', DEFAULT_CIRCUIT_BREAKER_OPTIONS);
      registry.register('service3', DEFAULT_CIRCUIT_BREAKER_OPTIONS);
    });

    test('should get all circuit breaker names', () => {
      const names = registry.getNames();

      expect(names).toHaveLength(3);
      expect(names).toContain('service1');
      expect(names).toContain('service2');
      expect(names).toContain('service3');
    });

    test('should get stats for all circuit breakers', () => {
      const stats = registry.getAllStats();

      expect(stats).toHaveLength(3);
      expect(stats[0]).toHaveProperty('name');
      expect(stats[0]).toHaveProperty('state');
      expect(stats[0]).toHaveProperty('totalExecutions');
    });

    test('should reset all circuit breakers', () => {
      const breaker1 = registry.get('service1')!;
      const breaker2 = registry.get('service2')!;

      breaker1.forceOpen();
      breaker2.forceOpen();

      registry.resetAll();

      expect(breaker1.getState()).toBe(CircuitState.CLOSED);
      expect(breaker2.getState()).toBe(CircuitState.CLOSED);
    });

    test('should clear all circuit breakers', () => {
      registry.clear();

      expect(registry.getNames()).toHaveLength(0);
      expect(registry.has('service1')).toBe(false);
    });
  });

  describe('Singleton Instance', () => {
    test('should have global singleton instance', () => {
      expect(circuitBreakerRegistry).toBeInstanceOf(CircuitBreakerRegistry);
    });
  });
});
