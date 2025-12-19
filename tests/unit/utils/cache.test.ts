/**
 * Cache Service Unit Tests
 *
 * Tests for Cache Service implementation:
 * - File system-based caching with TTL
 * - Cache operations (get, set, delete, clear)
 * - TTL management and expiration
 * - Statistics and cleanup
 * - Singleton pattern
 * - Error handling
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { CacheService, getCacheService, CacheEntry } from '../../../src/utils/cache';
import { logger } from '../../../src/utils/logger';

// Mock dependencies
jest.mock('fs/promises');
jest.mock('../../../src/utils/logger');

describe('CacheService', () => {
  let cacheService: CacheService;
  let mockFs: jest.Mocked<typeof fs>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFs = fs as jest.Mocked<typeof fs>;

    // Reset singleton instance between tests
    jest.resetModules();
  });

  describe('Constructor & Initialization', () => {
    test('should create instance with default options', () => {
      cacheService = new CacheService();

      expect(cacheService).toBeInstanceOf(CacheService);
    });

    test('should create instance with custom options', () => {
      cacheService = new CacheService({
        cacheDir: './custom-cache',
        defaultTTL: 7200,
        maxSizeMB: 200,
      });

      expect(cacheService).toBeInstanceOf(CacheService);
    });

    test('should create instance with partial options', () => {
      cacheService = new CacheService({
        cacheDir: './custom-cache',
      });

      expect(cacheService).toBeInstanceOf(CacheService);
    });

    test('should initialize cache directory successfully', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      cacheService = new CacheService({ cacheDir: './test-cache' });

      await expect(cacheService.initialize()).resolves.toBeUndefined();

      expect(mockFs.mkdir).toHaveBeenCalledWith('./test-cache', { recursive: true });
      expect(logger.info).toHaveBeenCalledWith('Cache service initialized', {
        cacheDir: './test-cache',
        defaultTTL: 3600,
        maxSizeMB: 100,
      });
    });

    test('should throw error on directory creation failure', async () => {
      const mockError = new Error('Permission denied');
      mockFs.mkdir.mockRejectedValue(mockError);
      cacheService = new CacheService();

      await expect(cacheService.initialize()).rejects.toThrow('Permission denied');

      expect(logger.error).toHaveBeenCalledWith('Failed to initialize cache directory', {
        error: mockError,
      });
    });

    test('should handle non-Error objects in initialization failure', async () => {
      mockFs.mkdir.mockRejectedValue('Directory creation error');
      cacheService = new CacheService();

      await expect(cacheService.initialize()).rejects.toBe('Directory creation error');

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('Cache Operations - get()', () => {
    beforeEach(() => {
      cacheService = new CacheService({ cacheDir: './cache' });
    });

    test('should return cached data on cache hit', async () => {
      const mockData = { id: 1, name: 'Test' };
      const mockEntry: CacheEntry<typeof mockData> = {
        data: mockData,
        timestamp: Date.now(),
        ttl: 3600,
      };

      mockFs.readFile.mockResolvedValue(JSON.stringify(mockEntry));

      const result = await cacheService.get<typeof mockData>('test-key');

      expect(result).toEqual(mockData);
      expect(logger.debug).toHaveBeenCalledWith('Cache hit', {
        key: 'test-key',
        age: expect.any(Number),
      });
    });

    test('should return null on cache miss (ENOENT)', async () => {
      const error: any = new Error('File not found');
      error.code = 'ENOENT';
      mockFs.readFile.mockRejectedValue(error);

      const result = await cacheService.get('non-existent-key');

      expect(result).toBeNull();
      expect(logger.debug).toHaveBeenCalledWith('Cache miss', { key: 'non-existent-key' });
    });

    test('should return null and delete expired cache', async () => {
      const mockData = { id: 1, name: 'Test' };
      const mockEntry: CacheEntry<typeof mockData> = {
        data: mockData,
        timestamp: Date.now() - 7200000, // 2 hours ago
        ttl: 3600, // 1 hour TTL
      };

      mockFs.readFile.mockResolvedValue(JSON.stringify(mockEntry));
      mockFs.unlink.mockResolvedValue(undefined);

      const result = await cacheService.get<typeof mockData>('expired-key');

      expect(result).toBeNull();
      expect(logger.debug).toHaveBeenCalledWith('Cache expired', {
        key: 'expired-key',
        age: expect.any(Number),
      });
      expect(mockFs.unlink).toHaveBeenCalled();
    });

    test('should handle exactly expired cache (boundary)', async () => {
      const mockData = { id: 1 };
      const now = Date.now();
      const mockEntry: CacheEntry<typeof mockData> = {
        data: mockData,
        timestamp: now - 3600001, // Just over 1 hour ago (1ms more)
        ttl: 3600,
      };

      mockFs.readFile.mockResolvedValue(JSON.stringify(mockEntry));
      mockFs.unlink.mockResolvedValue(undefined);

      // Mock Date.now to return consistent value
      jest.spyOn(Date, 'now').mockReturnValue(now);

      const result = await cacheService.get<typeof mockData>('boundary-key');

      // Age = 3600001ms, TTL = 3600s * 1000 = 3600000ms
      // Since age > ttl, this should be expired
      expect(result).toBeNull();

      jest.spyOn(Date, 'now').mockRestore();
    });

    test('should return null on read error (non-ENOENT)', async () => {
      const mockError = new Error('Read permission denied');
      mockFs.readFile.mockRejectedValue(mockError);

      const result = await cacheService.get('error-key');

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith('Failed to read cache', {
        key: 'error-key',
        error: mockError,
      });
    });

    test('should return null on invalid JSON in cache file', async () => {
      mockFs.readFile.mockResolvedValue('invalid json {');

      const result = await cacheService.get('invalid-json-key');

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith('Failed to read cache', {
        key: 'invalid-json-key',
        error: expect.any(SyntaxError),
      });
    });

    test('should use base64url encoding for cache file path', async () => {
      const mockData = { test: true };
      const mockEntry: CacheEntry<typeof mockData> = {
        data: mockData,
        timestamp: Date.now(),
        ttl: 3600,
      };

      mockFs.readFile.mockResolvedValue(JSON.stringify(mockEntry));

      await cacheService.get('test-key');

      const expectedHash = Buffer.from('test-key').toString('base64url');
      const expectedPath = path.join('./cache', `${expectedHash}.json`);

      expect(mockFs.readFile).toHaveBeenCalledWith(expectedPath, 'utf-8');
    });
  });

  describe('Cache Operations - set()', () => {
    beforeEach(() => {
      cacheService = new CacheService({ cacheDir: './cache' });
    });

    test('should set cached data with default TTL', async () => {
      const mockData = { id: 1, name: 'Test' };
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([]);

      jest.spyOn(Date, 'now').mockReturnValue(1000000);

      await cacheService.set('test-key', mockData);

      const expectedEntry: CacheEntry<typeof mockData> = {
        data: mockData,
        timestamp: 1000000,
        ttl: 3600,
      };
      const expectedHash = Buffer.from('test-key').toString('base64url');
      const expectedPath = path.join('./cache', `${expectedHash}.json`);

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expectedPath,
        JSON.stringify(expectedEntry, null, 2),
        'utf-8'
      );
      expect(logger.debug).toHaveBeenCalledWith('Cache set', { key: 'test-key', ttl: 3600 });

      jest.spyOn(Date, 'now').mockRestore();
    });

    test('should set cached data with custom TTL', async () => {
      const mockData = { id: 2 };
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([]);

      jest.spyOn(Date, 'now').mockReturnValue(2000000);

      await cacheService.set('custom-ttl-key', mockData, 7200);

      const expectedEntry: CacheEntry<typeof mockData> = {
        data: mockData,
        timestamp: 2000000,
        ttl: 7200,
      };

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        JSON.stringify(expectedEntry, null, 2),
        'utf-8'
      );
      expect(logger.debug).toHaveBeenCalledWith('Cache set', {
        key: 'custom-ttl-key',
        ttl: 7200,
      });

      jest.spyOn(Date, 'now').mockRestore();
    });

    test('should handle write errors gracefully', async () => {
      const mockError = new Error('Write permission denied');
      mockFs.writeFile.mockRejectedValue(mockError);

      // Should not throw
      await expect(cacheService.set('error-key', { data: 'test' })).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith('Failed to write cache', {
        key: 'error-key',
        error: mockError,
      });
    });

    test('should trigger cleanup if needed after set', async () => {
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue(['file1.json', 'file2.json'] as any);
      mockFs.stat.mockResolvedValue({
        size: 60 * 1024 * 1024, // 60MB per file
        mtimeMs: Date.now(),
      } as any);

      await cacheService.set('test-key', { data: 'test' });

      // Cleanup should be triggered since total size (120MB) > maxSizeMB (100MB)
      expect(mockFs.readdir).toHaveBeenCalled();
    });

    test('should handle complex data types', async () => {
      const complexData = {
        nested: {
          array: [1, 2, 3],
          object: { key: 'value' },
        },
        date: new Date().toISOString(),
      };

      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([]);

      await cacheService.set('complex-key', complexData);

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"nested"'),
        'utf-8'
      );
    });
  });

  describe('Cache Operations - delete()', () => {
    beforeEach(() => {
      cacheService = new CacheService({ cacheDir: './cache' });
    });

    test('should delete cache file successfully', async () => {
      mockFs.unlink.mockResolvedValue(undefined);

      await cacheService.delete('test-key');

      const expectedHash = Buffer.from('test-key').toString('base64url');
      const expectedPath = path.join('./cache', `${expectedHash}.json`);

      expect(mockFs.unlink).toHaveBeenCalledWith(expectedPath);
      expect(logger.debug).toHaveBeenCalledWith('Cache deleted', { key: 'test-key' });
    });

    test('should handle ENOENT error silently', async () => {
      const error: any = new Error('File not found');
      error.code = 'ENOENT';
      mockFs.unlink.mockRejectedValue(error);

      // Should not throw or log error
      await expect(cacheService.delete('non-existent-key')).resolves.toBeUndefined();

      expect(logger.error).not.toHaveBeenCalled();
    });

    test('should log error for non-ENOENT errors', async () => {
      const mockError = new Error('Permission denied');
      mockFs.unlink.mockRejectedValue(mockError);

      await cacheService.delete('error-key');

      expect(logger.error).toHaveBeenCalledWith('Failed to delete cache', {
        key: 'error-key',
        error: mockError,
      });
    });

    test('should handle non-Error objects in delete failure', async () => {
      mockFs.unlink.mockRejectedValue('Unlink error');

      await cacheService.delete('error-key');

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('Cache Operations - clear()', () => {
    beforeEach(() => {
      cacheService = new CacheService({ cacheDir: './cache' });
    });

    test('should clear all cache files', async () => {
      const mockFiles = ['file1.json', 'file2.json', 'file3.json', 'readme.txt'];
      mockFs.readdir.mockResolvedValue(mockFiles as any);
      mockFs.unlink.mockResolvedValue(undefined);

      await cacheService.clear();

      // Should only delete .json files
      expect(mockFs.unlink).toHaveBeenCalledTimes(3);
      expect(mockFs.unlink).toHaveBeenCalledWith(path.join('./cache', 'file1.json'));
      expect(mockFs.unlink).toHaveBeenCalledWith(path.join('./cache', 'file2.json'));
      expect(mockFs.unlink).toHaveBeenCalledWith(path.join('./cache', 'file3.json'));
      expect(logger.info).toHaveBeenCalledWith('Cache cleared', { count: 4 });
    });

    test('should handle empty cache directory', async () => {
      mockFs.readdir.mockResolvedValue([]);

      await cacheService.clear();

      expect(mockFs.unlink).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('Cache cleared', { count: 0 });
    });

    test('should handle readdir errors', async () => {
      const mockError = new Error('Cannot read directory');
      mockFs.readdir.mockRejectedValue(mockError);

      await cacheService.clear();

      expect(logger.error).toHaveBeenCalledWith('Failed to clear cache', { error: mockError });
    });

    test('should handle partial unlink failures', async () => {
      const mockFiles = ['file1.json', 'file2.json'];
      mockFs.readdir.mockResolvedValue(mockFiles as any);
      mockFs.unlink
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Cannot delete'));

      // Should not throw, Promise.all will reject
      await expect(cacheService.clear()).resolves.toBeUndefined();
    });
  });

  describe('Statistics - getStats()', () => {
    beforeEach(() => {
      cacheService = new CacheService({ cacheDir: './cache' });
    });

    test('should return correct statistics', async () => {
      const mockFiles = ['file1.json', 'file2.json', 'file3.json', 'readme.txt'];
      const now = Date.now();

      mockFs.readdir.mockResolvedValue(mockFiles as any);
      mockFs.stat
        .mockResolvedValueOnce({ size: 1024 * 1024, mtimeMs: now - 10000 } as any) // file1: 1MB, 10s old
        .mockResolvedValueOnce({ size: 2 * 1024 * 1024, mtimeMs: now - 5000 } as any) // file2: 2MB, 5s old
        .mockResolvedValueOnce({ size: 3 * 1024 * 1024, mtimeMs: now - 20000 } as any); // file3: 3MB, 20s old

      const stats = await cacheService.getStats();

      expect(stats.totalFiles).toBe(3);
      expect(stats.totalSizeMB).toBeCloseTo(6, 2); // 6MB total
      expect(stats.oldestFile).toEqual({
        age: expect.any(Number),
        key: 'file3.json',
      });
      expect(stats.newestFile).toEqual({
        age: expect.any(Number),
        key: 'file2.json',
      });
    });

    test('should handle empty cache directory', async () => {
      mockFs.readdir.mockResolvedValue([]);

      const stats = await cacheService.getStats();

      expect(stats).toEqual({
        totalFiles: 0,
        totalSizeMB: 0,
        oldestFile: null,
        newestFile: null,
      });
    });

    test('should filter non-JSON files', async () => {
      const mockFiles = ['data.json', 'readme.txt', 'config.yml'];
      mockFs.readdir.mockResolvedValue(mockFiles as any);
      mockFs.stat.mockResolvedValue({ size: 1024, mtimeMs: Date.now() } as any);

      const stats = await cacheService.getStats();

      expect(stats.totalFiles).toBe(1);
      expect(mockFs.stat).toHaveBeenCalledTimes(1);
    });

    test('should return default stats on error', async () => {
      const mockError = new Error('Cannot read directory');
      mockFs.readdir.mockRejectedValue(mockError);

      const stats = await cacheService.getStats();

      expect(stats).toEqual({
        totalFiles: 0,
        totalSizeMB: 0,
        oldestFile: null,
        newestFile: null,
      });
      expect(logger.error).toHaveBeenCalledWith('Failed to get cache stats', {
        error: mockError,
      });
    });

    test('should handle single file correctly', async () => {
      const now = Date.now();
      mockFs.readdir.mockResolvedValue(['single.json'] as any);
      mockFs.stat.mockResolvedValue({ size: 512 * 1024, mtimeMs: now - 1000 } as any);

      const stats = await cacheService.getStats();

      expect(stats.totalFiles).toBe(1);
      expect(stats.totalSizeMB).toBeCloseTo(0.5, 2);
      expect(stats.oldestFile?.key).toBe('single.json');
      expect(stats.newestFile?.key).toBe('single.json');
    });
  });

  describe('Cleanup - cleanupIfNeeded()', () => {
    beforeEach(() => {
      cacheService = new CacheService({ cacheDir: './cache', maxSizeMB: 10 });
    });

    test('should not cleanup if size is under limit', async () => {
      mockFs.readdir.mockResolvedValue(['file1.json'] as any);
      mockFs.stat.mockResolvedValue({ size: 5 * 1024 * 1024, mtimeMs: Date.now() } as any);
      mockFs.writeFile.mockResolvedValue(undefined);

      await cacheService.set('test-key', { data: 'test' });

      // Only one readdir call for getStats, no cleanup
      expect(mockFs.readdir).toHaveBeenCalledTimes(1);
      expect(mockFs.unlink).not.toHaveBeenCalled();
    });

    test('should cleanup oldest files when size exceeds limit', async () => {
      const now = Date.now();
      const mockFiles = ['file1.json', 'file2.json', 'file3.json'];

      // First call: getStats shows size exceeded
      mockFs.readdir.mockResolvedValueOnce(mockFiles as any);
      mockFs.stat
        .mockResolvedValueOnce({ size: 4 * 1024 * 1024, mtimeMs: now - 30000 } as any) // oldest
        .mockResolvedValueOnce({ size: 4 * 1024 * 1024, mtimeMs: now - 20000 } as any)
        .mockResolvedValueOnce({ size: 4 * 1024 * 1024, mtimeMs: now - 10000 } as any); // newest

      // Second call: readdir for cleanup
      mockFs.readdir.mockResolvedValueOnce(mockFiles as any);
      mockFs.stat
        .mockResolvedValueOnce({ size: 4 * 1024 * 1024, mtimeMs: now - 30000 } as any)
        .mockResolvedValueOnce({ size: 4 * 1024 * 1024, mtimeMs: now - 20000 } as any)
        .mockResolvedValueOnce({ size: 4 * 1024 * 1024, mtimeMs: now - 10000 } as any);

      mockFs.unlink.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      // Third call: getStats after first deletion
      mockFs.readdir.mockResolvedValueOnce(['file2.json', 'file3.json'] as any);
      mockFs.stat
        .mockResolvedValueOnce({ size: 4 * 1024 * 1024, mtimeMs: now - 20000 } as any)
        .mockResolvedValueOnce({ size: 4 * 1024 * 1024, mtimeMs: now - 10000 } as any);

      await cacheService.set('test-key', { data: 'test' });

      expect(logger.info).toHaveBeenCalledWith('Cache size exceeded, cleaning up', {
        currentSize: expect.any(Number),
        maxSize: 10,
      });
      expect(mockFs.unlink).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('Cache cleanup completed', {
        deletedCount: expect.any(Number),
      });
    });

    test('should stop cleanup at 80% of max size (buffer)', async () => {
      const now = Date.now();

      // Setup: 15MB total (over 10MB limit)
      mockFs.readdir.mockResolvedValueOnce(['f1.json', 'f2.json', 'f3.json'] as any);
      mockFs.stat
        .mockResolvedValueOnce({ size: 5 * 1024 * 1024, mtimeMs: now - 30000 } as any)
        .mockResolvedValueOnce({ size: 5 * 1024 * 1024, mtimeMs: now - 20000 } as any)
        .mockResolvedValueOnce({ size: 5 * 1024 * 1024, mtimeMs: now - 10000 } as any);

      // Cleanup phase
      mockFs.readdir.mockResolvedValueOnce(['f1.json', 'f2.json', 'f3.json'] as any);
      mockFs.stat
        .mockResolvedValueOnce({ size: 5 * 1024 * 1024, mtimeMs: now - 30000 } as any)
        .mockResolvedValueOnce({ size: 5 * 1024 * 1024, mtimeMs: now - 20000 } as any)
        .mockResolvedValueOnce({ size: 5 * 1024 * 1024, mtimeMs: now - 10000 } as any);

      mockFs.unlink.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      // After first deletion: 10MB (still above 80% = 8MB)
      mockFs.readdir.mockResolvedValueOnce(['f2.json', 'f3.json'] as any);
      mockFs.stat
        .mockResolvedValueOnce({ size: 5 * 1024 * 1024, mtimeMs: now - 20000 } as any)
        .mockResolvedValueOnce({ size: 5 * 1024 * 1024, mtimeMs: now - 10000 } as any);

      // After second deletion: 5MB (below 80% = 8MB)
      mockFs.readdir.mockResolvedValueOnce(['f3.json'] as any);
      mockFs.stat.mockResolvedValueOnce({ size: 5 * 1024 * 1024, mtimeMs: now - 10000 } as any);

      await cacheService.set('test-key', { data: 'test' });

      // Should stop after reducing to <= 80% of maxSizeMB
      expect(logger.info).toHaveBeenCalledWith('Cache cleanup completed', {
        deletedCount: expect.any(Number),
      });
    });

    test('should handle cleanup errors gracefully', async () => {
      const mockError = new Error('Cleanup failed');

      // First readdir call for getStats succeeds
      mockFs.readdir.mockResolvedValueOnce(['file1.json'] as any);
      mockFs.stat.mockResolvedValueOnce({
        size: 150 * 1024 * 1024, // 150MB (exceeds limit)
        mtimeMs: Date.now(),
      } as any);

      // Second readdir call for cleanup fails
      mockFs.readdir.mockRejectedValueOnce(mockError);
      mockFs.writeFile.mockResolvedValue(undefined);

      // Should not throw
      await expect(cacheService.set('test-key', { data: 'test' })).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith('Failed to cleanup cache', {
        error: mockError,
      });
    });
  });

  describe('TTL Management - removeExpired()', () => {
    beforeEach(() => {
      cacheService = new CacheService({ cacheDir: './cache' });
    });

    test('should remove expired entries', async () => {
      const now = Date.now();
      const mockFiles = ['file1.json', 'file2.json', 'file3.json'];

      mockFs.readdir.mockResolvedValue(mockFiles as any);

      const expiredEntry: CacheEntry<any> = {
        data: { test: 1 },
        timestamp: now - 7200000, // 2 hours ago
        ttl: 3600, // 1 hour TTL
      };

      const validEntry: CacheEntry<any> = {
        data: { test: 2 },
        timestamp: now - 1800000, // 30 minutes ago
        ttl: 3600,
      };

      mockFs.readFile
        .mockResolvedValueOnce(JSON.stringify(expiredEntry))
        .mockResolvedValueOnce(JSON.stringify(validEntry))
        .mockResolvedValueOnce(JSON.stringify(expiredEntry));

      mockFs.unlink.mockResolvedValue(undefined);

      const removedCount = await cacheService.removeExpired();

      expect(removedCount).toBe(2);
      expect(mockFs.unlink).toHaveBeenCalledTimes(2);
      expect(logger.info).toHaveBeenCalledWith('Expired cache entries removed', { count: 2 });
    });

    test('should remove invalid cache files', async () => {
      const mockFiles = ['invalid.json', 'valid.json'];

      mockFs.readdir.mockResolvedValue(mockFiles as any);
      mockFs.readFile
        .mockResolvedValueOnce('invalid json {')
        .mockResolvedValueOnce(
          JSON.stringify({ data: {}, timestamp: Date.now(), ttl: 3600 })
        );
      mockFs.unlink.mockResolvedValue(undefined);

      const removedCount = await cacheService.removeExpired();

      expect(removedCount).toBe(1);
      expect(mockFs.unlink).toHaveBeenCalledWith(path.join('./cache', 'invalid.json'));
    });

    test('should skip non-JSON files', async () => {
      const mockFiles = ['data.json', 'readme.txt', 'config.yml'];

      mockFs.readdir.mockResolvedValue(mockFiles as any);
      mockFs.readFile.mockResolvedValue(
        JSON.stringify({ data: {}, timestamp: Date.now(), ttl: 3600 })
      );

      const removedCount = await cacheService.removeExpired();

      expect(removedCount).toBe(0);
      expect(mockFs.readFile).toHaveBeenCalledTimes(1);
    });

    test('should return 0 if no files were removed', async () => {
      const now = Date.now();
      const mockFiles = ['file1.json'];

      mockFs.readdir.mockResolvedValue(mockFiles as any);
      mockFs.readFile.mockResolvedValue(
        JSON.stringify({ data: {}, timestamp: now, ttl: 3600 })
      );

      const removedCount = await cacheService.removeExpired();

      expect(removedCount).toBe(0);
      expect(logger.info).not.toHaveBeenCalled();
    });

    test('should return 0 on error', async () => {
      const mockError = new Error('Cannot read directory');
      mockFs.readdir.mockRejectedValue(mockError);

      const removedCount = await cacheService.removeExpired();

      expect(removedCount).toBe(0);
      expect(logger.error).toHaveBeenCalledWith('Failed to remove expired cache', {
        error: mockError,
      });
    });

    test('should handle empty cache directory', async () => {
      mockFs.readdir.mockResolvedValue([]);

      const removedCount = await cacheService.removeExpired();

      expect(removedCount).toBe(0);
      expect(logger.info).not.toHaveBeenCalled();
    });

    test('should handle file read errors during removal', async () => {
      const mockFiles = ['error.json', 'valid.json'];

      mockFs.readdir.mockResolvedValue(mockFiles as any);
      mockFs.readFile
        .mockRejectedValueOnce(new Error('Read error'))
        .mockResolvedValueOnce(
          JSON.stringify({ data: {}, timestamp: Date.now(), ttl: 3600 })
        );
      mockFs.unlink.mockResolvedValue(undefined);

      const removedCount = await cacheService.removeExpired();

      // Invalid file should be removed
      expect(removedCount).toBe(1);
    });
  });

  describe('Singleton Pattern - getCacheService()', () => {
    test('should return CacheService instance', () => {
      const instance = getCacheService();

      expect(instance).toBeInstanceOf(CacheService);
    });

    test('should return same instance on multiple calls', () => {
      const instance1 = getCacheService();
      const instance2 = getCacheService();
      const instance3 = getCacheService();

      expect(instance1).toBe(instance2);
      expect(instance2).toBe(instance3);
    });
  });

  describe('Edge Cases', () => {
    beforeEach(() => {
      cacheService = new CacheService({ cacheDir: './cache' });
    });

    test('should handle very large files', async () => {
      const largeData = { data: 'x'.repeat(10 * 1024 * 1024) }; // 10MB string
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([]);

      await cacheService.set('large-key', largeData);

      expect(mockFs.writeFile).toHaveBeenCalled();
    });

    test('should handle very small TTL values', async () => {
      const mockData = { test: true };
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([]);

      await cacheService.set('short-ttl-key', mockData, 1); // 1 second TTL

      expect(logger.debug).toHaveBeenCalledWith('Cache set', {
        key: 'short-ttl-key',
        ttl: 1,
      });
    });

    test('should handle zero TTL', async () => {
      const mockData = { test: true };
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([]);

      await cacheService.set('zero-ttl-key', mockData, 0);

      expect(logger.debug).toHaveBeenCalledWith('Cache set', {
        key: 'zero-ttl-key',
        ttl: 0,
      });
    });

    test('should handle special characters in cache key', async () => {
      const specialKey = 'test/key:with?special=chars&more';
      const mockData = { test: true };
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([]);

      await cacheService.set(specialKey, mockData);

      const expectedHash = Buffer.from(specialKey).toString('base64url');
      const expectedPath = path.join('./cache', `${expectedHash}.json`);

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expectedPath,
        expect.any(String),
        'utf-8'
      );
    });

    test('should handle unicode characters in cache key', async () => {
      const unicodeKey = '测试키-🔥-key';
      const mockData = { test: true };
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([]);

      await cacheService.set(unicodeKey, mockData);

      const expectedHash = Buffer.from(unicodeKey).toString('base64url');
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining(expectedHash),
        expect.any(String),
        'utf-8'
      );
    });

    test('should handle null/undefined data gracefully', async () => {
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([]);

      await cacheService.set('null-key', null);
      await cacheService.set('undefined-key', undefined);

      expect(mockFs.writeFile).toHaveBeenCalledTimes(2);
    });

    test('should handle concurrent get operations', async () => {
      const mockData = { id: 1 };
      const mockEntry: CacheEntry<typeof mockData> = {
        data: mockData,
        timestamp: Date.now(),
        ttl: 3600,
      };

      mockFs.readFile.mockResolvedValue(JSON.stringify(mockEntry));

      const [result1, result2, result3] = await Promise.all([
        cacheService.get('concurrent-key'),
        cacheService.get('concurrent-key'),
        cacheService.get('concurrent-key'),
      ]);

      expect(result1).toEqual(mockData);
      expect(result2).toEqual(mockData);
      expect(result3).toEqual(mockData);
      expect(mockFs.readFile).toHaveBeenCalledTimes(3);
    });

    test('should handle concurrent set operations', async () => {
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([]);

      await Promise.all([
        cacheService.set('key1', { data: 1 }),
        cacheService.set('key2', { data: 2 }),
        cacheService.set('key3', { data: 3 }),
      ]);

      expect(mockFs.writeFile).toHaveBeenCalledTimes(3);
    });

    test('should handle clock skew scenarios', async () => {
      const now = Date.now();
      const mockData = { test: true };
      const mockEntry: CacheEntry<typeof mockData> = {
        data: mockData,
        timestamp: now + 10000, // Future timestamp (clock skew)
        ttl: 3600,
      };

      mockFs.readFile.mockResolvedValue(JSON.stringify(mockEntry));

      const result = await cacheService.get<typeof mockData>('future-key');

      // Negative age should not expire the cache
      expect(result).toEqual(mockData);
    });

    test('should handle empty string as cache key', async () => {
      const mockData = { test: true };
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([]);

      await cacheService.set('', mockData);

      const expectedHash = Buffer.from('').toString('base64url');
      const expectedPath = path.join('./cache', `${expectedHash}.json`);

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expectedPath,
        expect.any(String),
        'utf-8'
      );
    });
  });

  describe('Integration Scenarios', () => {
    beforeEach(() => {
      cacheService = new CacheService({ cacheDir: './cache' });
    });

    test('should handle full cache lifecycle', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([]);

      // Initialize
      await cacheService.initialize();
      expect(logger.info).toHaveBeenCalledWith(
        'Cache service initialized',
        expect.any(Object)
      );

      // Set cache
      await cacheService.set('test-key', { data: 'test' });
      expect(logger.debug).toHaveBeenCalledWith('Cache set', expect.any(Object));

      // Get cache
      const mockEntry: CacheEntry<any> = {
        data: { data: 'test' },
        timestamp: Date.now(),
        ttl: 3600,
      };
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockEntry));

      const result = await cacheService.get('test-key');
      expect(result).toEqual({ data: 'test' });

      // Delete cache
      mockFs.unlink.mockResolvedValue(undefined);
      await cacheService.delete('test-key');
      expect(logger.debug).toHaveBeenCalledWith('Cache deleted', expect.any(Object));
    });

    test('should handle cache expiration workflow', async () => {
      const now = Date.now();

      // Set cache
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([]);
      await cacheService.set('expiring-key', { data: 'test' }, 10); // 10 second TTL

      // Get cache immediately (should hit)
      const validEntry: CacheEntry<any> = {
        data: { data: 'test' },
        timestamp: now,
        ttl: 10,
      };
      mockFs.readFile.mockResolvedValue(JSON.stringify(validEntry));

      jest.spyOn(Date, 'now').mockReturnValue(now + 5000); // 5 seconds later
      const result1 = await cacheService.get('expiring-key');
      expect(result1).toEqual({ data: 'test' });

      // Get cache after expiration (should miss)
      jest.spyOn(Date, 'now').mockReturnValue(now + 15000); // 15 seconds later
      mockFs.unlink.mockResolvedValue(undefined);
      const result2 = await cacheService.get('expiring-key');
      expect(result2).toBeNull();

      jest.spyOn(Date, 'now').mockRestore();
    });

    test('should handle cache cleanup workflow', async () => {
      const now = Date.now();
      cacheService = new CacheService({ cacheDir: './cache', maxSizeMB: 5 });

      // Initial stats: 6MB total (exceeds limit)
      mockFs.readdir.mockResolvedValueOnce(['f1.json', 'f2.json', 'f3.json'] as any);
      mockFs.stat
        .mockResolvedValueOnce({ size: 2 * 1024 * 1024, mtimeMs: now - 30000 } as any)
        .mockResolvedValueOnce({ size: 2 * 1024 * 1024, mtimeMs: now - 20000 } as any)
        .mockResolvedValueOnce({ size: 2 * 1024 * 1024, mtimeMs: now - 10000 } as any);

      // Cleanup readdir
      mockFs.readdir.mockResolvedValueOnce(['f1.json', 'f2.json', 'f3.json'] as any);
      mockFs.stat
        .mockResolvedValueOnce({ size: 2 * 1024 * 1024, mtimeMs: now - 30000 } as any)
        .mockResolvedValueOnce({ size: 2 * 1024 * 1024, mtimeMs: now - 20000 } as any)
        .mockResolvedValueOnce({ size: 2 * 1024 * 1024, mtimeMs: now - 10000 } as any);

      mockFs.unlink.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      // After cleanup stats: 2MB (under buffer)
      mockFs.readdir.mockResolvedValueOnce(['f3.json'] as any);
      mockFs.stat.mockResolvedValueOnce({ size: 2 * 1024 * 1024, mtimeMs: now - 10000 } as any);

      await cacheService.set('new-key', { data: 'test' });

      expect(logger.info).toHaveBeenCalledWith('Cache size exceeded, cleaning up', {
        currentSize: expect.any(Number),
        maxSize: 5,
      });
      expect(logger.info).toHaveBeenCalledWith('Cache cleanup completed', {
        deletedCount: expect.any(Number),
      });
    });
  });
});
