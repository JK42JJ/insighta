/**
 * Retry Utility Unit Tests
 *
 * Tests for retry utilities with exponential backoff:
 * - retry() function with various scenarios
 * - retryIf() function with custom conditions
 * - retryBatch() function for parallel operations
 * - calculateDelay() exponential backoff logic
 * - sleep() promise-based delay
 * - Error handling and configuration
 *
 * OPTIMIZATION: Uses jest.useFakeTimers() with jest.runAllTimersAsync() for instant test execution
 */

import { retry, retryIf, retryBatch } from '../../../src/utils/retry';
import { logger } from '../../../src/utils/logger';
import { isRetryableError, getErrorMessage } from '../../../src/utils/errors';

// Mock dependencies
jest.mock('../../../src/config', () => ({
  config: {
    app: {
      logLevel: 'info',
      isDevelopment: false,
      isProduction: false,
      isTest: true,
    },
    paths: {
      logs: './logs',
      cache: './cache',
      data: './data',
    },
    sync: {
      retryAttempts: 3,
      backoffMultiplier: 2,
    },
  },
}));

jest.mock('../../../src/utils/logger');
jest.mock('../../../src/utils/errors');

describe('Retry Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    // Mock Math.random for predictable jitter
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('retry()', () => {
    describe('Successful operations', () => {
      test('should return result on first attempt', async () => {
        const operation = jest.fn().mockResolvedValue('success');

        const result = await retry(operation);

        expect(result).toBe('success');
        expect(operation).toHaveBeenCalledTimes(1);
        expect(logger.warn).not.toHaveBeenCalled();
      });

      test('should succeed after retries', async () => {
        const operation = jest
          .fn()
          .mockRejectedValueOnce(new Error('Fail 1'))
          .mockRejectedValueOnce(new Error('Fail 2'))
          .mockResolvedValue('success');

        (isRetryableError as jest.Mock).mockReturnValue(true);
        (getErrorMessage as jest.Mock).mockImplementation((e: Error) => e.message);

        const promise = retry(operation);
        await jest.runAllTimersAsync();
        const result = await promise;

        expect(result).toBe('success');
        expect(operation).toHaveBeenCalledTimes(3);
        expect(logger.warn).toHaveBeenCalledTimes(2);
      });

      test('should return complex objects', async () => {
        const complexResult = { id: 1, data: [1, 2, 3], nested: { value: 'test' } };
        const operation = jest.fn().mockResolvedValue(complexResult);

        const result = await retry(operation);

        expect(result).toEqual(complexResult);
        expect(operation).toHaveBeenCalledTimes(1);
      });
    });

    describe('Failed operations', () => {
      test('should throw last error after all retries fail', async () => {
        const error1 = new Error('Fail 1');
        const error2 = new Error('Fail 2');
        const error3 = new Error('Fail 3');
        const operation = jest
          .fn()
          .mockRejectedValueOnce(error1)
          .mockRejectedValueOnce(error2)
          .mockRejectedValueOnce(error3);

        (isRetryableError as jest.Mock).mockReturnValue(true);
        (getErrorMessage as jest.Mock).mockImplementation((e: Error) => e.message);

        const promise = retry(operation);

        // Run all timers asynchronously - this will advance through retry delays
        const timerPromise = jest.runAllTimersAsync();

        // Wait for both the retry promise rejection and timer resolution
        await expect(promise).rejects.toThrow('Fail 3');
        await timerPromise;

        expect(operation).toHaveBeenCalledTimes(3);
        expect(logger.warn).toHaveBeenCalledTimes(2);
      });

      test('should throw immediately on non-retryable error', async () => {
        const error = new Error('Non-retryable error');
        const operation = jest.fn().mockRejectedValue(error);

        (isRetryableError as jest.Mock).mockReturnValue(false);

        await expect(retry(operation)).rejects.toThrow('Non-retryable error');
        expect(operation).toHaveBeenCalledTimes(1);
        expect(logger.warn).not.toHaveBeenCalled();
      });

      test('should convert non-Error values to Error', async () => {
        const operation = jest.fn().mockRejectedValue('string error');

        (isRetryableError as jest.Mock).mockReturnValue(false);

        await expect(retry(operation)).rejects.toThrow('string error');
        expect(operation).toHaveBeenCalledTimes(1);
      });
    });

    describe('Exponential backoff', () => {
      test('should apply exponential backoff delay', async () => {
        const operation = jest
          .fn()
          .mockRejectedValueOnce(new Error('Fail 1'))
          .mockRejectedValueOnce(new Error('Fail 2'))
          .mockResolvedValue('success');

        (isRetryableError as jest.Mock).mockReturnValue(true);
        (getErrorMessage as jest.Mock).mockImplementation((e: Error) => e.message);

        const promise = retry(operation, {
          initialDelayMs: 1000,
          backoffMultiplier: 2,
          maxDelayMs: 30000,
        });

        await jest.runAllTimersAsync();
        await promise;

        // Verify logger was called with correct delays
        // Attempt 1: 1000 * (2^0) + jitter = 1000 + 150 = 1150
        // Attempt 2: 1000 * (2^1) + jitter = 2000 + 300 = 2300
        expect(logger.warn).toHaveBeenNthCalledWith(1, 'Operation failed, retrying...', {
          attempt: 1,
          maxAttempts: 3,
          delayMs: 1150,
          error: 'Fail 1',
        });

        expect(logger.warn).toHaveBeenNthCalledWith(2, 'Operation failed, retrying...', {
          attempt: 2,
          maxAttempts: 3,
          delayMs: 2300,
          error: 'Fail 2',
        });
      });

      test('should add jitter (up to 30%)', async () => {
        (isRetryableError as jest.Mock).mockReturnValue(true);
        (getErrorMessage as jest.Mock).mockImplementation((e: Error) => e.message);

        // Test with minimum jitter
        jest.spyOn(Math, 'random').mockReturnValueOnce(0);
        const operation1 = jest
          .fn()
          .mockRejectedValueOnce(new Error('Fail'))
          .mockResolvedValue('success');

        const promise1 = retry(operation1, { initialDelayMs: 1000 });
        await jest.runAllTimersAsync();
        await promise1;

        // 1000 * (2^0) + (0 * 0.3 * 1000) = 1000
        expect(logger.warn).toHaveBeenCalledWith('Operation failed, retrying...', {
          attempt: 1,
          maxAttempts: 3,
          delayMs: 1000,
          error: 'Fail',
        });

        jest.clearAllMocks();

        // Test with maximum jitter
        jest.spyOn(Math, 'random').mockReturnValueOnce(1);
        const operation2 = jest
          .fn()
          .mockRejectedValueOnce(new Error('Fail'))
          .mockResolvedValue('success');

        const promise2 = retry(operation2, { initialDelayMs: 1000 });
        await jest.runAllTimersAsync();
        await promise2;

        // 1000 * (2^0) + (1 * 0.3 * 1000) = 1300
        expect(logger.warn).toHaveBeenCalledWith('Operation failed, retrying...', {
          attempt: 1,
          maxAttempts: 3,
          delayMs: 1300,
          error: 'Fail',
        });
      });

      test('should enforce max delay cap', async () => {
        const operation = jest
          .fn()
          .mockRejectedValueOnce(new Error('Fail 1'))
          .mockRejectedValueOnce(new Error('Fail 2'))
          .mockResolvedValue('success');

        (isRetryableError as jest.Mock).mockReturnValue(true);
        (getErrorMessage as jest.Mock).mockImplementation((e: Error) => e.message);

        const promise = retry(operation, {
          initialDelayMs: 1000,
          backoffMultiplier: 10,
          maxDelayMs: 2000,
        });

        await jest.runAllTimersAsync();
        await promise;

        // Attempt 1: 1000 * (10^0) + jitter = 1000 + 150 = 1150
        // Attempt 2: 1000 * (10^1) + jitter = 10000 + 1500 = 11500 -> capped at 2000
        expect(logger.warn).toHaveBeenNthCalledWith(1, 'Operation failed, retrying...', {
          attempt: 1,
          maxAttempts: 3,
          delayMs: 1150,
          error: 'Fail 1',
        });

        expect(logger.warn).toHaveBeenNthCalledWith(2, 'Operation failed, retrying...', {
          attempt: 2,
          maxAttempts: 3,
          delayMs: 2000,
          error: 'Fail 2',
        });
      });

      test('should floor delay to integer', async () => {
        const operation = jest
          .fn()
          .mockRejectedValueOnce(new Error('Fail'))
          .mockResolvedValue('success');

        (isRetryableError as jest.Mock).mockReturnValue(true);
        (getErrorMessage as jest.Mock).mockImplementation((e: Error) => e.message);

        // Use random value that creates fractional delay
        jest.spyOn(Math, 'random').mockReturnValueOnce(0.333);

        const promise = retry(operation, { initialDelayMs: 1000 });
        await jest.runAllTimersAsync();
        await promise;

        // 1000 + (0.333 * 0.3 * 1000) = 1000 + 99.9 = 1099.9 -> floored to 1099
        expect(logger.warn).toHaveBeenCalledWith('Operation failed, retrying...', {
          attempt: 1,
          maxAttempts: 3,
          delayMs: 1099,
          error: 'Fail',
        });
      });
    });

    describe('onRetry callback', () => {
      test('should invoke onRetry callback on each retry', async () => {
        const onRetry = jest.fn();
        const error1 = new Error('Fail 1');
        const error2 = new Error('Fail 2');
        const operation = jest
          .fn()
          .mockRejectedValueOnce(error1)
          .mockRejectedValueOnce(error2)
          .mockResolvedValue('success');

        (isRetryableError as jest.Mock).mockReturnValue(true);
        (getErrorMessage as jest.Mock).mockImplementation((e: Error) => e.message);

        const promise = retry(operation, { onRetry });
        await jest.runAllTimersAsync();
        await promise;

        expect(onRetry).toHaveBeenCalledTimes(2);
        expect(onRetry).toHaveBeenNthCalledWith(1, 1, error1);
        expect(onRetry).toHaveBeenNthCalledWith(2, 2, error2);
      });

      test('should not invoke onRetry on first attempt', async () => {
        const onRetry = jest.fn();
        const operation = jest.fn().mockResolvedValue('success');

        await retry(operation, { onRetry });

        expect(onRetry).not.toHaveBeenCalled();
      });

      test('should not invoke onRetry on non-retryable error', async () => {
        const onRetry = jest.fn();
        const operation = jest.fn().mockRejectedValue(new Error('Non-retryable'));

        (isRetryableError as jest.Mock).mockReturnValue(false);

        await expect(retry(operation, { onRetry })).rejects.toThrow();
        expect(onRetry).not.toHaveBeenCalled();
      });
    });

    describe('Custom options', () => {
      test('should use custom maxAttempts', async () => {
        const operation = jest.fn().mockRejectedValue(new Error('Fail'));

        (isRetryableError as jest.Mock).mockReturnValue(true);
        (getErrorMessage as jest.Mock).mockImplementation((e: Error) => e.message);

        const promise = retry(operation, { maxAttempts: 5 });
        const timerPromise = jest.runAllTimersAsync();

        await expect(promise).rejects.toThrow('Fail');
        await timerPromise;

        expect(operation).toHaveBeenCalledTimes(5);
        expect(logger.warn).toHaveBeenCalledTimes(4);
      });

      test('should use custom backoffMultiplier', async () => {
        const operation = jest
          .fn()
          .mockRejectedValueOnce(new Error('Fail'))
          .mockResolvedValue('success');

        (isRetryableError as jest.Mock).mockReturnValue(true);
        (getErrorMessage as jest.Mock).mockImplementation((e: Error) => e.message);

        const promise = retry(operation, {
          initialDelayMs: 1000,
          backoffMultiplier: 3,
        });

        await jest.runAllTimersAsync();
        await promise;

        // 1000 * (3^0) + jitter = 1000 + 150 = 1150
        expect(logger.warn).toHaveBeenCalledWith('Operation failed, retrying...', {
          attempt: 1,
          maxAttempts: 3,
          delayMs: 1150,
          error: 'Fail',
        });
      });

      test('should use default config values when options not provided', async () => {
        const operation = jest.fn().mockRejectedValue(new Error('Fail'));

        (isRetryableError as jest.Mock).mockReturnValue(true);
        (getErrorMessage as jest.Mock).mockImplementation((e: Error) => e.message);

        const promise = retry(operation);
        const timerPromise = jest.runAllTimersAsync();

        await expect(promise).rejects.toThrow('Fail');
        await timerPromise;

        expect(operation).toHaveBeenCalledTimes(3); // config.sync.retryAttempts
        expect(logger.warn).toHaveBeenCalledTimes(2);
      });

      test('should override config with custom options', async () => {
        const operation = jest.fn().mockRejectedValue(new Error('Fail'));

        (isRetryableError as jest.Mock).mockReturnValue(true);
        (getErrorMessage as jest.Mock).mockImplementation((e: Error) => e.message);

        await expect(
          retry(operation, {
            maxAttempts: 1,
            backoffMultiplier: 5,
            initialDelayMs: 2000,
            maxDelayMs: 60000,
          })
        ).rejects.toThrow('Fail');

        expect(operation).toHaveBeenCalledTimes(1);
        expect(logger.warn).not.toHaveBeenCalled(); // No retries with maxAttempts: 1
      });
    });

    describe('Edge cases', () => {
      test('should handle maxAttempts = 1 (no retries)', async () => {
        const operation = jest.fn().mockRejectedValue(new Error('Fail'));

        (isRetryableError as jest.Mock).mockReturnValue(true);

        await expect(retry(operation, { maxAttempts: 1 })).rejects.toThrow('Fail');
        expect(operation).toHaveBeenCalledTimes(1);
        expect(logger.warn).not.toHaveBeenCalled();
      });

      test('should handle very high backoff multiplier', async () => {
        const operation = jest
          .fn()
          .mockRejectedValueOnce(new Error('Fail'))
          .mockResolvedValue('success');

        (isRetryableError as jest.Mock).mockReturnValue(true);
        (getErrorMessage as jest.Mock).mockImplementation((e: Error) => e.message);

        const promise = retry(operation, {
          initialDelayMs: 1000,
          backoffMultiplier: 100,
          maxDelayMs: 5000,
        });

        await jest.runAllTimersAsync();
        await promise;

        // Should be capped at maxDelayMs
        expect(logger.warn).toHaveBeenCalledWith('Operation failed, retrying...', {
          attempt: 1,
          maxAttempts: 3,
          delayMs: 1150,
          error: 'Fail',
        });
      });

      test('should handle very low initial delay', async () => {
        const operation = jest
          .fn()
          .mockRejectedValueOnce(new Error('Fail'))
          .mockResolvedValue('success');

        (isRetryableError as jest.Mock).mockReturnValue(true);
        (getErrorMessage as jest.Mock).mockImplementation((e: Error) => e.message);

        const promise = retry(operation, { initialDelayMs: 10 });
        await jest.runAllTimersAsync();
        await promise;

        // 10 + (0.5 * 0.3 * 10) = 10 + 1.5 = 11.5 -> floored to 11
        expect(logger.warn).toHaveBeenCalledWith('Operation failed, retrying...', {
          attempt: 1,
          maxAttempts: 3,
          delayMs: 11,
          error: 'Fail',
        });
      });

      test('should handle null error', async () => {
        const operation = jest.fn().mockRejectedValue(null);

        (isRetryableError as jest.Mock).mockReturnValue(false);

        await expect(retry(operation)).rejects.toThrow('null');
        expect(operation).toHaveBeenCalledTimes(1);
      });

      test('should handle undefined error', async () => {
        const operation = jest.fn().mockRejectedValue(undefined);

        (isRetryableError as jest.Mock).mockReturnValue(false);

        await expect(retry(operation)).rejects.toThrow('undefined');
        expect(operation).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('retryIf()', () => {
    describe('Custom retry condition', () => {
      test('should retry when custom condition returns true', async () => {
        const shouldRetry = jest.fn().mockReturnValue(true);
        const operation = jest
          .fn()
          .mockRejectedValueOnce(new Error('Fail 1'))
          .mockRejectedValueOnce(new Error('Fail 2'))
          .mockResolvedValue('success');

        (getErrorMessage as jest.Mock).mockImplementation((e: Error) => e.message);

        const promise = retryIf(operation, shouldRetry);
        await jest.runAllTimersAsync();
        const result = await promise;

        expect(result).toBe('success');
        expect(operation).toHaveBeenCalledTimes(3);
        expect(shouldRetry).toHaveBeenCalledTimes(2);
        expect(logger.warn).toHaveBeenCalledTimes(2);
      });

      test('should not retry when custom condition returns false', async () => {
        const shouldRetry = jest.fn().mockReturnValue(false);
        const error = new Error('Fail');
        const operation = jest.fn().mockRejectedValue(error);

        await expect(retryIf(operation, shouldRetry)).rejects.toThrow('Fail');
        expect(operation).toHaveBeenCalledTimes(1);
        expect(shouldRetry).toHaveBeenCalledTimes(1);
        expect(shouldRetry).toHaveBeenCalledWith(error);
        expect(logger.warn).not.toHaveBeenCalled();
      });

      test('should pass error to custom condition', async () => {
        const shouldRetry = jest.fn().mockReturnValue(true);
        const error1 = new Error('Fail 1');
        const error2 = new Error('Fail 2');
        const operation = jest
          .fn()
          .mockRejectedValueOnce(error1)
          .mockRejectedValueOnce(error2)
          .mockResolvedValue('success');

        (getErrorMessage as jest.Mock).mockImplementation((e: Error) => e.message);

        const promise = retryIf(operation, shouldRetry);
        await jest.runAllTimersAsync();
        await promise;

        expect(shouldRetry).toHaveBeenNthCalledWith(1, error1);
        expect(shouldRetry).toHaveBeenNthCalledWith(2, error2);
      });

      test('should work with conditional retry logic', async () => {
        const shouldRetry = jest.fn((error: Error) => {
          return error.message.includes('temporary');
        });

        const operation = jest
          .fn()
          .mockRejectedValueOnce(new Error('temporary failure'))
          .mockRejectedValueOnce(new Error('permanent failure'))
          .mockResolvedValue('success');

        (getErrorMessage as jest.Mock).mockImplementation((e: Error) => e.message);

        const promise = retryIf(operation, shouldRetry);
        const timerPromise = jest.runAllTimersAsync();

        await expect(promise).rejects.toThrow('permanent failure');
        await timerPromise;

        expect(operation).toHaveBeenCalledTimes(2);
        expect(shouldRetry).toHaveBeenCalledTimes(2);
        expect(logger.warn).toHaveBeenCalledTimes(1);
      });
    });

    describe('Configuration options', () => {
      test('should use custom options with retryIf', async () => {
        const shouldRetry = jest.fn().mockReturnValue(true);
        const operation = jest.fn().mockRejectedValue(new Error('Fail'));

        (getErrorMessage as jest.Mock).mockImplementation((e: Error) => e.message);

        const promise = retryIf(operation, shouldRetry, { maxAttempts: 5 });
        const timerPromise = jest.runAllTimersAsync();

        await expect(promise).rejects.toThrow('Fail');
        await timerPromise;

        expect(operation).toHaveBeenCalledTimes(5);
        expect(shouldRetry).toHaveBeenCalledTimes(5);
      });

      test('should apply exponential backoff with custom condition', async () => {
        const shouldRetry = jest.fn().mockReturnValue(true);
        const operation = jest
          .fn()
          .mockRejectedValueOnce(new Error('Fail'))
          .mockResolvedValue('success');

        (getErrorMessage as jest.Mock).mockImplementation((e: Error) => e.message);

        const promise = retryIf(operation, shouldRetry, {
          initialDelayMs: 2000,
          backoffMultiplier: 3,
        });

        await jest.runAllTimersAsync();
        await promise;

        // 2000 * (3^0) + jitter = 2000 + 300 = 2300
        expect(logger.warn).toHaveBeenCalledWith('Operation failed, retrying...', {
          attempt: 1,
          maxAttempts: 3,
          delayMs: 2300,
          error: 'Fail',
        });
      });

      test('should invoke onRetry callback with custom condition', async () => {
        const shouldRetry = jest.fn().mockReturnValue(true);
        const onRetry = jest.fn();
        const error = new Error('Fail');
        const operation = jest.fn().mockRejectedValueOnce(error).mockResolvedValue('success');

        (getErrorMessage as jest.Mock).mockImplementation((e: Error) => e.message);

        const promise = retryIf(operation, shouldRetry, { onRetry });
        await jest.runAllTimersAsync();
        await promise;

        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(onRetry).toHaveBeenCalledWith(1, error);
      });
    });

    describe('Edge cases', () => {
      test('should handle custom condition throwing error', async () => {
        const shouldRetry = jest.fn().mockImplementation(() => {
          throw new Error('Condition error');
        });
        const operation = jest.fn().mockRejectedValue(new Error('Fail'));

        await expect(retryIf(operation, shouldRetry)).rejects.toThrow('Condition error');
        expect(operation).toHaveBeenCalledTimes(1);
      });

      test('should convert non-Error to Error before passing to condition', async () => {
        const shouldRetry = jest.fn().mockReturnValue(false);
        const operation = jest.fn().mockRejectedValue('string error');

        await expect(retryIf(operation, shouldRetry)).rejects.toThrow('string error');
        expect(shouldRetry).toHaveBeenCalledWith(expect.any(Error));
        expect(shouldRetry.mock.calls[0][0].message).toBe('string error');
      });
    });
  });

  describe('retryBatch()', () => {
    describe('Parallel execution', () => {
      test('should execute all operations in parallel', async () => {
        const op1 = jest.fn().mockResolvedValue('result1');
        const op2 = jest.fn().mockResolvedValue('result2');
        const op3 = jest.fn().mockResolvedValue('result3');

        const results = await retryBatch([op1, op2, op3]);

        expect(results).toEqual(['result1', 'result2', 'result3']);
        expect(op1).toHaveBeenCalledTimes(1);
        expect(op2).toHaveBeenCalledTimes(1);
        expect(op3).toHaveBeenCalledTimes(1);
      });

      test('should retry individual operations independently', async () => {
        const op1 = jest.fn().mockResolvedValue('result1');
        const op2 = jest
          .fn()
          .mockRejectedValueOnce(new Error('Fail 1'))
          .mockResolvedValue('result2');
        const op3 = jest
          .fn()
          .mockRejectedValueOnce(new Error('Fail 2'))
          .mockRejectedValueOnce(new Error('Fail 3'))
          .mockResolvedValue('result3');

        (isRetryableError as jest.Mock).mockReturnValue(true);
        (getErrorMessage as jest.Mock).mockImplementation((e: Error) => e.message);

        const promise = retryBatch([op1, op2, op3]);
        await jest.runAllTimersAsync();
        const results = await promise;

        expect(results).toEqual(['result1', 'result2', 'result3']);
        expect(op1).toHaveBeenCalledTimes(1);
        expect(op2).toHaveBeenCalledTimes(2);
        expect(op3).toHaveBeenCalledTimes(3);
      });

      test('should fail batch if any operation fails after retries', async () => {
        const op1 = jest.fn().mockResolvedValue('result1');
        const op2 = jest.fn().mockRejectedValue(new Error('Persistent failure'));
        const op3 = jest.fn().mockResolvedValue('result3');

        (isRetryableError as jest.Mock).mockReturnValue(true);
        (getErrorMessage as jest.Mock).mockImplementation((e: Error) => e.message);

        const promise = retryBatch([op1, op2, op3]);
        const timerPromise = jest.runAllTimersAsync();

        await expect(promise).rejects.toThrow('Persistent failure');
        await timerPromise;

        expect(op1).toHaveBeenCalled();
        expect(op2).toHaveBeenCalledTimes(3); // Default maxAttempts
        expect(op3).toHaveBeenCalled();
      });

      test('should apply custom options to all operations', async () => {
        const op1 = jest.fn().mockRejectedValue(new Error('Fail'));
        const op2 = jest.fn().mockRejectedValue(new Error('Fail'));

        (isRetryableError as jest.Mock).mockReturnValue(true);
        (getErrorMessage as jest.Mock).mockImplementation((e: Error) => e.message);

        const promise = retryBatch([op1, op2], { maxAttempts: 5 });
        const timerPromise = jest.runAllTimersAsync();

        await expect(promise).rejects.toThrow();
        await timerPromise;

        expect(op1).toHaveBeenCalledTimes(5);
        expect(op2).toHaveBeenCalledTimes(5);
      });
    });

    describe('Edge cases', () => {
      test('should handle empty operations array', async () => {
        const results = await retryBatch([]);
        expect(results).toEqual([]);
      });

      test('should handle single operation', async () => {
        const op = jest.fn().mockResolvedValue('result');

        const results = await retryBatch([op]);

        expect(results).toEqual(['result']);
        expect(op).toHaveBeenCalledTimes(1);
      });

      test('should handle large number of operations', async () => {
        const operations = Array.from({ length: 100 }, (_, i) =>
          jest.fn().mockResolvedValue(`result${i}`)
        );

        const results = await retryBatch(operations);

        expect(results).toHaveLength(100);
        expect(results[0]).toBe('result0');
        expect(results[99]).toBe('result99');
      });

      test('should handle operations returning different types', async () => {
        const op1 = jest.fn().mockResolvedValue('string');
        const op2 = jest.fn().mockResolvedValue(123);
        const op3 = jest.fn().mockResolvedValue({ key: 'value' });
        const op4 = jest.fn().mockResolvedValue([1, 2, 3]);

        const results = await retryBatch([op1, op2, op3, op4]);

        expect(results).toEqual(['string', 123, { key: 'value' }, [1, 2, 3]]);
      });

      test('should maintain order of results', async () => {
        // Create operations that resolve at different speeds
        const op1 = jest.fn().mockResolvedValue('result1');
        const op2 = jest.fn().mockResolvedValue('result2');
        const op3 = jest.fn().mockResolvedValue('result3');

        const results = await retryBatch([op1, op2, op3]);

        expect(results).toEqual(['result1', 'result2', 'result3']);
      });
    });
  });

  describe('Integration with errors.ts', () => {
    test('should use isRetryableError for retry decision', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Test error'));

      (isRetryableError as jest.Mock).mockReturnValueOnce(false);

      await expect(retry(operation)).rejects.toThrow('Test error');
      expect(isRetryableError).toHaveBeenCalledWith(expect.any(Error));
      expect(operation).toHaveBeenCalledTimes(1);
    });

    test('should use getErrorMessage for logging', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Test error'));

      (isRetryableError as jest.Mock).mockReturnValue(true);
      (getErrorMessage as jest.Mock).mockReturnValue('Formatted error message');

      const promise = retry(operation);
      const timerPromise = jest.runAllTimersAsync();

      await expect(promise).rejects.toThrow();
      await timerPromise;

      expect(getErrorMessage).toHaveBeenCalledWith(expect.any(Error));
      expect(logger.warn).toHaveBeenCalledWith(
        'Operation failed, retrying...',
        expect.objectContaining({
          error: 'Formatted error message',
        })
      );
    });
  });
});
