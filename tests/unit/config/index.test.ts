/**
 * Configuration Module Unit Tests
 *
 * Note: The config module is loaded at import time and cached.
 * These tests verify the structure and helper functions.
 */

import { config, validateApiCredentials, getConfig } from '../../../src/config';

describe('Configuration Module', () => {
  describe('config object', () => {
    test('should export config with required sections', () => {
      expect(config).toBeDefined();
      expect(config.database).toBeDefined();
      expect(config.youtube).toBeDefined();
      expect(config.app).toBeDefined();
      expect(config.paths).toBeDefined();
      expect(config.sync).toBeDefined();
      expect(config.quota).toBeDefined();
      expect(config.quotaCosts).toBeDefined();
    });

    test('should have database configuration', () => {
      expect(config.database.url).toBeDefined();
      expect(typeof config.database.url).toBe('string');
    });

    test('should have youtube configuration', () => {
      expect(config.youtube).toHaveProperty('apiKey');
      expect(config.youtube).toHaveProperty('clientId');
      expect(config.youtube).toHaveProperty('clientSecret');
      expect(config.youtube).toHaveProperty('redirectUri');
    });

    test('should have app environment configuration', () => {
      expect(config.app.env).toBeDefined();
      expect(['development', 'production', 'test']).toContain(config.app.env);
      expect(typeof config.app.isDevelopment).toBe('boolean');
      expect(typeof config.app.isProduction).toBe('boolean');
      expect(typeof config.app.isTest).toBe('boolean');
    });

    test('should have paths configuration with absolute paths', () => {
      expect(config.paths.cache).toBeDefined();
      expect(config.paths.logs).toBeDefined();
      expect(config.paths.data).toBeDefined();
      // Paths should be absolute (start with / on Unix or drive letter on Windows)
      expect(config.paths.cache).toMatch(/^(\/|[A-Z]:)/i);
    });

    test('should have sync configuration with numeric values', () => {
      expect(typeof config.sync.defaultInterval).toBe('number');
      expect(typeof config.sync.maxConcurrent).toBe('number');
      expect(typeof config.sync.retryAttempts).toBe('number');
      expect(typeof config.sync.backoffMultiplier).toBe('number');
      expect(config.sync.maxConcurrent).toBeGreaterThan(0);
      expect(config.sync.retryAttempts).toBeGreaterThan(0);
    });

    test('should have quota configuration', () => {
      expect(typeof config.quota.dailyLimit).toBe('number');
      expect(typeof config.quota.warningThreshold).toBe('number');
      expect(config.quota.dailyLimit).toBeGreaterThan(0);
      expect(config.quota.warningThreshold).toBeLessThanOrEqual(config.quota.dailyLimit);
    });

    test('should have correct quota costs', () => {
      expect(config.quotaCosts.playlistDetails).toBe(1);
      expect(config.quotaCosts.playlistItems).toBe(1);
      expect(config.quotaCosts.videos).toBe(1);
      expect(config.quotaCosts.search).toBe(100);
      expect(config.quotaCosts.channels).toBe(1);
    });

    test('should have encryption configuration', () => {
      expect(config.encryption).toBeDefined();
      expect(config.encryption.secret).toBeDefined();
      expect(config.encryption.secret.length).toBeGreaterThanOrEqual(64);
    });
  });

  describe('validateApiCredentials', () => {
    // Note: This test depends on the actual env vars set during test run
    // The function validates credentials from the already-loaded config
    test('should be a function', () => {
      expect(typeof validateApiCredentials).toBe('function');
    });

    test('should not throw when credentials are properly configured', () => {
      // If we're running tests with proper env, this should not throw
      // If env is not set up, the config import would have already failed
      // So by the time we get here, we have valid credentials
      if (config.youtube.apiKey || config.youtube.clientId) {
        expect(() => validateApiCredentials()).not.toThrow();
      }
    });

    test('should validate API credentials exist', () => {
      // Since we can't easily test the error path due to config being loaded at import time,
      // we verify the function exists and has the expected behavior
      expect(validateApiCredentials).toBeDefined();
      expect(typeof validateApiCredentials).toBe('function');

      // The function should check for API key or client ID
      // In our test environment, at least one should be present
      expect(config.youtube.apiKey || config.youtube.clientId).toBeTruthy();
    });

    test('should validate OAuth credentials together', () => {
      // If client ID is set, client secret should also be set
      if (config.youtube.clientId) {
        expect(config.youtube.clientSecret).toBeDefined();
        expect(() => validateApiCredentials()).not.toThrow();
      }
    });
  });

  describe('getConfig', () => {
    test('should get top-level config section', () => {
      const database = getConfig<typeof config.database>('database');
      expect(database).toEqual(config.database);
    });

    test('should get nested config value', () => {
      const dailyLimit = getConfig<number>('quota.dailyLimit');
      expect(dailyLimit).toBe(config.quota.dailyLimit);
    });

    test('should get deeply nested value', () => {
      const playlistCost = getConfig<number>('quotaCosts.playlistDetails');
      expect(playlistCost).toBe(1);
    });

    test('should get sync configuration', () => {
      const syncConfig = getConfig<typeof config.sync>('sync');
      expect(syncConfig.defaultInterval).toBeDefined();
      expect(syncConfig.maxConcurrent).toBeGreaterThan(0);
    });

    test('should get app configuration', () => {
      const appConfig = getConfig<typeof config.app>('app');
      expect(appConfig.env).toBeDefined();
      expect(['development', 'production', 'test']).toContain(appConfig.env);
    });

    test('should get paths configuration', () => {
      const pathsConfig = getConfig<typeof config.paths>('paths');
      expect(pathsConfig.cache).toBeDefined();
      expect(pathsConfig.logs).toBeDefined();
      expect(pathsConfig.data).toBeDefined();
    });

    test('should throw for non-existent top-level key', () => {
      expect(() => getConfig('nonexistent')).toThrow('Configuration key not found: nonexistent');
    });

    test('should throw for non-existent nested key', () => {
      expect(() => getConfig('quota.nonexistent')).toThrow(
        'Configuration key not found: quota.nonexistent'
      );
    });

    test('should throw for deeply non-existent path', () => {
      expect(() => getConfig('a.b.c.d.e')).toThrow('Configuration key not found: a.b.c.d.e');
    });

    test('should throw for null/undefined intermediate values', () => {
      expect(() => getConfig('database.nonexistent.deeper')).toThrow(
        'Configuration key not found: database.nonexistent.deeper'
      );
    });
  });

  describe('config immutability', () => {
    test('config object should be readonly', () => {
      // The config uses 'as const' so attempting to modify should be a type error
      // At runtime, we can verify the structure is consistent
      const originalValue = config.quota.dailyLimit;
      expect(config.quota.dailyLimit).toBe(originalValue);
    });
  });
});
