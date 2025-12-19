/**
 * Cache Service
 *
 * File system-based cache with TTL support for YouTube API responses
 * Reduces API quota usage by caching frequently accessed data
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from './logger';

export interface CacheOptions {
  /**
   * Cache directory path
   * @default './cache'
   */
  cacheDir?: string;

  /**
   * Default TTL in seconds
   * @default 3600 (1 hour)
   */
  defaultTTL?: number;

  /**
   * Maximum cache size in MB
   * @default 100
   */
  maxSizeMB?: number;
}

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

/**
 * Cache Service
 */
export class CacheService {
  private cacheDir: string;
  private defaultTTL: number;
  private maxSizeMB: number;

  constructor(options: CacheOptions = {}) {
    this.cacheDir = options.cacheDir ?? './cache';
    this.defaultTTL = options.defaultTTL ?? 3600; // 1 hour
    this.maxSizeMB = options.maxSizeMB ?? 100;
  }

  /**
   * Initialize cache directory
   */
  public async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
      logger.info('Cache service initialized', {
        cacheDir: this.cacheDir,
        defaultTTL: this.defaultTTL,
        maxSizeMB: this.maxSizeMB,
      });
    } catch (error) {
      logger.error('Failed to initialize cache directory', { error });
      throw error;
    }
  }

  /**
   * Get cache file path for a key
   */
  private getCachePath(key: string): string {
    // Use hash to create safe filename
    const hash = Buffer.from(key).toString('base64url');
    return path.join(this.cacheDir, `${hash}.json`);
  }

  /**
   * Get cached data
   */
  public async get<T>(key: string): Promise<T | null> {
    try {
      const cachePath = this.getCachePath(key);
      const content = await fs.readFile(cachePath, 'utf-8');
      const entry: CacheEntry<T> = JSON.parse(content);

      // Check if cache is expired
      const age = Date.now() - entry.timestamp;
      if (age > entry.ttl * 1000) {
        logger.debug('Cache expired', { key, age: age / 1000 });
        await this.delete(key);
        return null;
      }

      logger.debug('Cache hit', { key, age: age / 1000 });
      return entry.data;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        logger.debug('Cache miss', { key });
        return null;
      }
      logger.error('Failed to read cache', { key, error });
      return null;
    }
  }

  /**
   * Set cached data
   */
  public async set<T>(key: string, data: T, ttl?: number): Promise<void> {
    try {
      const entry: CacheEntry<T> = {
        data,
        timestamp: Date.now(),
        ttl: ttl ?? this.defaultTTL,
      };

      const cachePath = this.getCachePath(key);
      await fs.writeFile(cachePath, JSON.stringify(entry, null, 2), 'utf-8');

      logger.debug('Cache set', { key, ttl: entry.ttl });

      // Check cache size and cleanup if needed
      await this.cleanupIfNeeded();
    } catch (error) {
      logger.error('Failed to write cache', { key, error });
    }
  }

  /**
   * Delete cached data
   */
  public async delete(key: string): Promise<void> {
    try {
      const cachePath = this.getCachePath(key);
      await fs.unlink(cachePath);
      logger.debug('Cache deleted', { key });
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        logger.error('Failed to delete cache', { key, error });
      }
    }
  }

  /**
   * Clear all cache
   */
  public async clear(): Promise<void> {
    try {
      const files = await fs.readdir(this.cacheDir);
      await Promise.all(
        files
          .filter(file => file.endsWith('.json'))
          .map(file => fs.unlink(path.join(this.cacheDir, file)))
      );
      logger.info('Cache cleared', { count: files.length });
    } catch (error) {
      logger.error('Failed to clear cache', { error });
    }
  }

  /**
   * Get cache statistics
   */
  public async getStats(): Promise<{
    totalFiles: number;
    totalSizeMB: number;
    oldestFile: { age: number; key: string } | null;
    newestFile: { age: number; key: string } | null;
  }> {
    try {
      const files = await fs.readdir(this.cacheDir);
      const jsonFiles = files.filter(file => file.endsWith('.json'));

      let totalSize = 0;
      let oldestFile: { age: number; key: string } | null = null;
      let newestFile: { age: number; key: string } | null = null;

      for (const file of jsonFiles) {
        const filePath = path.join(this.cacheDir, file);
        const stats = await fs.stat(filePath);
        totalSize += stats.size;

        const age = Date.now() - stats.mtimeMs;
        if (!oldestFile || age > oldestFile.age) {
          oldestFile = { age, key: file };
        }
        if (!newestFile || age < newestFile.age) {
          newestFile = { age, key: file };
        }
      }

      return {
        totalFiles: jsonFiles.length,
        totalSizeMB: totalSize / (1024 * 1024),
        oldestFile,
        newestFile,
      };
    } catch (error) {
      logger.error('Failed to get cache stats', { error });
      return {
        totalFiles: 0,
        totalSizeMB: 0,
        oldestFile: null,
        newestFile: null,
      };
    }
  }

  /**
   * Cleanup old cache files if size exceeds limit
   */
  private async cleanupIfNeeded(): Promise<void> {
    try {
      const stats = await this.getStats();

      if (stats.totalSizeMB <= this.maxSizeMB) {
        return;
      }

      logger.info('Cache size exceeded, cleaning up', {
        currentSize: stats.totalSizeMB,
        maxSize: this.maxSizeMB,
      });

      // Get all files with their ages
      const files = await fs.readdir(this.cacheDir);
      const fileStats = await Promise.all(
        files
          .filter(file => file.endsWith('.json'))
          .map(async file => {
            const filePath = path.join(this.cacheDir, file);
            const stat = await fs.stat(filePath);
            return { file, age: Date.now() - stat.mtimeMs };
          })
      );

      // Sort by age (oldest first)
      fileStats.sort((a, b) => b.age - a.age);

      // Delete oldest files until size is under limit
      let deletedCount = 0;
      for (const { file } of fileStats) {
        await fs.unlink(path.join(this.cacheDir, file));
        deletedCount++;

        const newStats = await this.getStats();
        if (newStats.totalSizeMB <= this.maxSizeMB * 0.8) {
          // Keep 20% buffer
          break;
        }
      }

      logger.info('Cache cleanup completed', { deletedCount });
    } catch (error) {
      logger.error('Failed to cleanup cache', { error });
    }
  }

  /**
   * Remove expired entries
   */
  public async removeExpired(): Promise<number> {
    try {
      const files = await fs.readdir(this.cacheDir);
      let removedCount = 0;

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = path.join(this.cacheDir, file);
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const entry: CacheEntry<any> = JSON.parse(content);

          const age = Date.now() - entry.timestamp;
          if (age > entry.ttl * 1000) {
            await fs.unlink(filePath);
            removedCount++;
          }
        } catch (error) {
          // Invalid cache file, remove it
          await fs.unlink(filePath);
          removedCount++;
        }
      }

      if (removedCount > 0) {
        logger.info('Expired cache entries removed', { count: removedCount });
      }

      return removedCount;
    } catch (error) {
      logger.error('Failed to remove expired cache', { error });
      return 0;
    }
  }
}

/**
 * Singleton instance
 */
let cacheInstance: CacheService | null = null;

/**
 * Get cache service instance
 */
export function getCacheService(): CacheService {
  if (!cacheInstance) {
    cacheInstance = new CacheService();
  }
  return cacheInstance;
}

export default getCacheService;
