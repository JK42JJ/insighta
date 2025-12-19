/**
 * Utils index exports test
 *
 * Ensures all utility exports are available
 */

import * as utils from '../../../src/utils';

describe('Utils Index', () => {
  describe('Logger exports', () => {
    it('should export logger', () => {
      expect(utils.logger).toBeDefined();
      expect(typeof utils.logger.info).toBe('function');
      expect(typeof utils.logger.error).toBe('function');
      expect(typeof utils.logger.warn).toBe('function');
      expect(typeof utils.logger.debug).toBe('function');
    });
  });

  describe('Error exports', () => {
    it('should export AppError', () => {
      expect(utils.AppError).toBeDefined();
      expect(typeof utils.AppError).toBe('function');
    });

    it('should export error types', () => {
      expect(utils.NetworkError).toBeDefined();
      expect(utils.ValidationError).toBeDefined();
      expect(utils.AuthenticationError).toBeDefined();
      expect(utils.QuotaExceededError).toBeDefined();
      expect(utils.SyncConflictError).toBeDefined();
      expect(utils.RateLimitError).toBeDefined();
    });

    it('should export error utility functions', () => {
      expect(typeof utils.isRetryableError).toBe('function');
      expect(typeof utils.getErrorMessage).toBe('function');
      expect(typeof utils.getErrorDetails).toBe('function');
      expect(typeof utils.isOperationalError).toBe('function');
    });
  });

  describe('Retry exports', () => {
    it('should export retry function', () => {
      expect(utils.retry).toBeDefined();
      expect(typeof utils.retry).toBe('function');
    });

    it('should export retryIf function', () => {
      expect(utils.retryIf).toBeDefined();
      expect(typeof utils.retryIf).toBe('function');
    });

    it('should export retryBatch function', () => {
      expect(utils.retryBatch).toBeDefined();
      expect(typeof utils.retryBatch).toBe('function');
    });
  });

  describe('Cache exports', () => {
    it('should export CacheService', () => {
      expect(utils.CacheService).toBeDefined();
      expect(typeof utils.CacheService).toBe('function');
    });

    it('should export getCacheService singleton', () => {
      expect(utils.getCacheService).toBeDefined();
      expect(typeof utils.getCacheService).toBe('function');
    });
  });

  describe('Export structure', () => {
    it('should export all expected utilities', () => {
      const exports = Object.keys(utils);

      // Logger
      expect(exports).toContain('logger');

      // Errors
      expect(exports).toContain('AppError');
      expect(exports).toContain('NetworkError');
      expect(exports).toContain('ValidationError');

      // Retry
      expect(exports).toContain('retry');
      expect(exports).toContain('retryIf');
      expect(exports).toContain('retryBatch');

      // Cache
      expect(exports).toContain('CacheService');
      expect(exports).toContain('getCacheService');
    });
  });
});
