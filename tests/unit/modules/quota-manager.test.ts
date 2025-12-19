/**
 * QuotaManager Unit Tests
 *
 * Tests for QuotaManager implementation including:
 * - Daily quota tracking
 * - Quota usage calculation
 * - Quota reservation
 * - Operation cost calculation
 * - Usage statistics
 * - Quota reset logic
 */

import { QuotaManager, QuotaOperation } from '../../../src/modules/quota/manager';
import { QuotaExceededError } from '../../../src/utils/errors';
import { config } from '../../../src/config';

// Mock dependencies
jest.mock('../../../src/modules/database/client', () => ({
  db: {
    quotaUsage: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    quotaOperation: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  logQuotaUsage: jest.fn(),
}));

import { db } from '../../../src/modules/database/client';
import { logger, logQuotaUsage } from '../../../src/utils/logger';

describe('QuotaManager', () => {
  let quotaManager: QuotaManager;
  let mockTransaction: jest.Mock;

  beforeEach(() => {
    quotaManager = new QuotaManager();
    jest.clearAllMocks();

    // Setup transaction mock
    mockTransaction = jest.fn((callback) => callback(db));
    (db.$transaction as jest.Mock) = mockTransaction;
  });

  describe('getTodayUsage', () => {
    it('should return quota usage for today', async () => {
      const mockUsage = {
        date: new Date(),
        used: 5000,
        limit: 10000,
      };

      (db.quotaUsage.findUnique as jest.Mock).mockResolvedValue(mockUsage);

      const result = await quotaManager.getTodayUsage();

      expect(result).toEqual({
        used: 5000,
        remaining: 5000,
        limit: 10000,
      });
    });

    it('should return zero usage when no quota record exists', async () => {
      (db.quotaUsage.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await quotaManager.getTodayUsage();

      expect(result).toEqual({
        used: 0,
        remaining: config.quota.dailyLimit,
        limit: config.quota.dailyLimit,
      });
    });

    it('should use config daily limit', async () => {
      (db.quotaUsage.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await quotaManager.getTodayUsage();

      expect(result.limit).toBe(config.quota.dailyLimit);
    });
  });

  describe('canUseQuota', () => {
    it('should return true when quota is available', async () => {
      (db.quotaUsage.findUnique as jest.Mock).mockResolvedValue({
        used: 5000,
        limit: 10000,
      });

      const result = await quotaManager.canUseQuota(1000);

      expect(result).toBe(true);
    });

    it('should return false when quota would be exceeded', async () => {
      (db.quotaUsage.findUnique as jest.Mock).mockResolvedValue({
        used: 9500,
        limit: 10000,
      });

      const result = await quotaManager.canUseQuota(1000);

      expect(result).toBe(false);
    });

    it('should return true when quota exactly matches', async () => {
      (db.quotaUsage.findUnique as jest.Mock).mockResolvedValue({
        used: 9000,
        limit: 10000,
      });

      const result = await quotaManager.canUseQuota(1000);

      expect(result).toBe(true);
    });
  });

  describe('reserveQuota', () => {
    beforeEach(() => {
      (db.quotaUsage.findUnique as jest.Mock).mockResolvedValue({
        used: 1000,
        limit: 10000,
      });

      (db.quotaUsage.upsert as jest.Mock).mockResolvedValue({
        id: 'quota-1',
        used: 1100,
        limit: 10000,
      });

      (db.quotaOperation.create as jest.Mock).mockResolvedValue({
        id: 'op-1',
      });
    });

    it('should reserve quota successfully', async () => {
      await quotaManager.reserveQuota('playlist.details', 100);

      expect(mockTransaction).toHaveBeenCalled();
      expect(db.quotaUsage.upsert).toHaveBeenCalled();
      expect(db.quotaOperation.create).toHaveBeenCalled();
    });

    it('should throw QuotaExceededError when quota insufficient', async () => {
      (db.quotaUsage.findUnique as jest.Mock).mockResolvedValue({
        used: 9500,
        limit: 10000,
      });

      await expect(
        quotaManager.reserveQuota('playlist.details', 1000)
      ).rejects.toThrow(QuotaExceededError);
    });

    it('should create quota usage record if not exists', async () => {
      (db.quotaUsage.findUnique as jest.Mock).mockResolvedValue(null);
      (db.quotaUsage.upsert as jest.Mock).mockResolvedValue({
        id: 'quota-1',
        used: 100,
        limit: 10000,
      });

      await quotaManager.reserveQuota('playlist.details', 100);

      expect(db.quotaUsage.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            used: 100,
            limit: config.quota.dailyLimit,
          }),
        })
      );
    });

    it('should increment existing quota usage', async () => {
      await quotaManager.reserveQuota('playlist.details', 100);

      expect(db.quotaUsage.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            used: { increment: 100 },
          }),
        })
      );
    });

    it('should record quota operation', async () => {
      await quotaManager.reserveQuota('video.details', 50);

      expect(db.quotaOperation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            operationType: 'video.details',
            cost: 50,
          }),
        })
      );
    });

    it('should log quota usage', async () => {
      await quotaManager.reserveQuota('playlist.details', 100);

      expect(logQuotaUsage).toHaveBeenCalledWith(
        'playlist.details',
        100,
        expect.any(Number)
      );
    });

    it('should warn when approaching quota limit', async () => {
      (db.quotaUsage.findUnique as jest.Mock)
        .mockResolvedValueOnce({ used: 1000, limit: 10000 })
        .mockResolvedValueOnce({ used: 9100, limit: 10000 });

      (db.quotaUsage.upsert as jest.Mock).mockResolvedValue({
        id: 'quota-1',
        used: 9100,
        limit: 10000,
      });

      await quotaManager.reserveQuota('playlist.items', 8100);

      expect(logger.warn).toHaveBeenCalledWith(
        'Approaching daily quota limit',
        expect.objectContaining({
          used: 9100,
          remaining: 900,
        })
      );
    });
  });

  describe('getOperationCost', () => {
    it('should return cost for playlist.details', () => {
      const operation: QuotaOperation = { type: 'playlist.details' };
      const cost = quotaManager.getOperationCost(operation);

      expect(cost).toBe(config.quotaCosts.playlistDetails);
    });

    it('should calculate cost for playlist.items with default count', () => {
      const operation: QuotaOperation = { type: 'playlist.items' };
      const cost = quotaManager.getOperationCost(operation);

      expect(cost).toBe(Math.ceil(50 / 50) * config.quotaCosts.playlistItems);
    });

    it('should calculate cost for playlist.items with custom count', () => {
      const operation: QuotaOperation = { type: 'playlist.items', itemCount: 150 };
      const cost = quotaManager.getOperationCost(operation);

      expect(cost).toBe(Math.ceil(150 / 50) * config.quotaCosts.playlistItems);
    });

    it('should calculate cost for video.details', () => {
      const operation: QuotaOperation = { type: 'video.details', itemCount: 100 };
      const cost = quotaManager.getOperationCost(operation);

      expect(cost).toBe(Math.ceil(100 / 50) * config.quotaCosts.videos);
    });

    it('should return search cost', () => {
      const operation: QuotaOperation = { type: 'search' };
      const cost = quotaManager.getOperationCost(operation);

      expect(cost).toBe(config.quotaCosts.search);
    });

    it('should return channel cost', () => {
      const operation: QuotaOperation = { type: 'channel.details' };
      const cost = quotaManager.getOperationCost(operation);

      expect(cost).toBe(config.quotaCosts.channels);
    });

    it('should return default cost for unknown operation', () => {
      const operation = { type: 'unknown' } as unknown as QuotaOperation;
      const cost = quotaManager.getOperationCost(operation);

      expect(cost).toBe(1);
      expect(logger.warn).toHaveBeenCalledWith(
        'Unknown operation type, using default cost',
        expect.any(Object)
      );
    });
  });

  describe('calculateSyncCost', () => {
    it('should calculate cost for small playlist', () => {
      const cost = quotaManager.calculateSyncCost(50);

      const expected =
        config.quotaCosts.playlistDetails +
        Math.ceil(50 / 50) * config.quotaCosts.playlistItems +
        Math.ceil(50 / 50) * config.quotaCosts.videos;

      expect(cost).toBe(expected);
    });

    it('should calculate cost for large playlist', () => {
      const cost = quotaManager.calculateSyncCost(250);

      const expected =
        config.quotaCosts.playlistDetails +
        Math.ceil(250 / 50) * config.quotaCosts.playlistItems +
        Math.ceil(250 / 50) * config.quotaCosts.videos;

      expect(cost).toBe(expected);
    });

    it('should handle zero items', () => {
      const cost = quotaManager.calculateSyncCost(0);

      const expected =
        config.quotaCosts.playlistDetails +
        Math.ceil(0 / 50) * config.quotaCosts.playlistItems +
        Math.ceil(0 / 50) * config.quotaCosts.videos;

      expect(cost).toBe(expected);
    });
  });

  describe('getUsageStats', () => {
    it('should return usage statistics', async () => {
      const mockUsage = [
        {
          date: new Date('2024-01-01'),
          used: 5000,
          limit: 10000,
          operations: [
            { operationType: 'playlist.details', cost: 1, timestamp: new Date() },
            { operationType: 'playlist.items', cost: 2, timestamp: new Date() },
            { operationType: 'playlist.details', cost: 1, timestamp: new Date() },
          ],
        },
      ];

      (db.quotaUsage.findMany as jest.Mock).mockResolvedValue(mockUsage);

      const stats = await quotaManager.getUsageStats(7);

      expect(stats).toHaveLength(1);
      expect(stats[0]).toMatchObject({
        date: mockUsage[0]!.date,
        used: 5000,
        limit: 10000,
        percentUsed: 50,
        operations: 3,
      });

      expect(stats[0]!.operationsByType).toEqual({
        'playlist.details': { count: 2, totalCost: 2 },
        'playlist.items': { count: 1, totalCost: 2 },
      });
    });

    it('should handle empty usage', async () => {
      (db.quotaUsage.findMany as jest.Mock).mockResolvedValue([]);

      const stats = await quotaManager.getUsageStats(7);

      expect(stats).toHaveLength(0);
    });

    it('should use default days parameter', async () => {
      (db.quotaUsage.findMany as jest.Mock).mockResolvedValue([]);

      await quotaManager.getUsageStats();

      expect(db.quotaUsage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            date: { gte: expect.any(Date) },
          }),
        })
      );
    });
  });

  describe('resetDailyQuota', () => {
    it('should reset quota to zero', async () => {
      (db.quotaUsage.update as jest.Mock).mockResolvedValue({});

      await quotaManager.resetDailyQuota();

      expect(db.quotaUsage.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { used: 0 },
        })
      );
    });

    it('should log reset action', async () => {
      (db.quotaUsage.update as jest.Mock).mockResolvedValue({});

      await quotaManager.resetDailyQuota();

      expect(logger.info).toHaveBeenCalledWith('Daily quota reset');
    });
  });
});
