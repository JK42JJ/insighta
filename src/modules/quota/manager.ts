/**
 * Quota Management Module
 *
 * Manages YouTube API quota usage tracking and enforcement
 */

import { db } from '../database/client';
import { config } from '../../config';
import { logger, logQuotaUsage } from '../../utils/logger';
import { QuotaExceededError } from '../../utils/errors';

/**
 * Quota Manager
 */
export class QuotaManager {
  /**
   * Get today's quota usage
   */
  public async getTodayUsage(): Promise<{ used: number; remaining: number; limit: number }> {
    const today = this.getTodayDate();

    const quotaUsage = await db.quotaUsage.findUnique({
      where: { date: today },
    });

    const used = quotaUsage?.used ?? 0;
    const limit = config.quota.dailyLimit;

    return {
      used,
      remaining: limit - used,
      limit,
    };
  }

  /**
   * Check if operation would exceed quota
   */
  public async canUseQuota(cost: number): Promise<boolean> {
    const { used, limit } = await this.getTodayUsage();
    return used + cost <= limit;
  }

  /**
   * Reserve quota for an operation
   *
   * @throws QuotaExceededError if quota exceeded
   */
  public async reserveQuota(operationType: string, cost: number): Promise<void> {
    const today = this.getTodayDate();

    // Check if quota available
    const canUse = await this.canUseQuota(cost);
    if (!canUse) {
      const { used, limit } = await this.getTodayUsage();
      throw new QuotaExceededError({
        used,
        limit,
        requested: cost,
      });
    }

    // Update quota usage
    await db.$transaction(async (tx) => {
      // Get or create today's quota usage
      const quotaUsage = await tx.quotaUsage.upsert({
        where: { date: today },
        create: {
          date: today,
          used: cost,
          limit: config.quota.dailyLimit,
        },
        update: {
          used: { increment: cost },
        },
      });

      // Record operation
      await tx.quotaOperation.create({
        data: {
          quotaUsageId: quotaUsage.id,
          operationType,
          cost,
          timestamp: new Date(),
        },
      });
    });

    const { used, remaining } = await this.getTodayUsage();
    logQuotaUsage(operationType, cost, remaining);

    // Warn if approaching limit
    if (remaining < config.quota.dailyLimit - config.quota.warningThreshold) {
      logger.warn('Approaching daily quota limit', {
        used,
        remaining,
        limit: config.quota.dailyLimit,
        percentUsed: ((used / config.quota.dailyLimit) * 100).toFixed(2),
      });
    }
  }

  /**
   * Get quota cost for operation
   */
  public getOperationCost(operation: QuotaOperation): number {
    switch (operation.type) {
      case 'playlist.details':
        return config.quotaCosts.playlistDetails;

      case 'playlist.items':
        // 1 unit per request (50 items max)
        return Math.ceil((operation.itemCount ?? 50) / 50) * config.quotaCosts.playlistItems;

      case 'video.details':
        // 1 unit per request (50 videos max)
        return Math.ceil((operation.itemCount ?? 50) / 50) * config.quotaCosts.videos;

      case 'search':
        return config.quotaCosts.search;

      case 'channel.details':
        return config.quotaCosts.channels;

      default:
        logger.warn('Unknown operation type, using default cost', { operation });
        return 1;
    }
  }

  /**
   * Calculate total quota cost for sync operation
   */
  public calculateSyncCost(itemCount: number): number {
    return (
      config.quotaCosts.playlistDetails + // Get playlist details
      Math.ceil(itemCount / 50) * config.quotaCosts.playlistItems + // Get playlist items
      Math.ceil(itemCount / 50) * config.quotaCosts.videos // Get video details
    );
  }

  /**
   * Get quota usage statistics
   */
  public async getUsageStats(days: number = 7): Promise<QuotaStats[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const usage = await db.quotaUsage.findMany({
      where: {
        date: { gte: startDate },
      },
      include: {
        operations: {
          select: {
            operationType: true,
            cost: true,
            timestamp: true,
          },
        },
      },
      orderBy: { date: 'desc' },
    });

    return usage.map((u) => ({
      date: u.date,
      used: u.used,
      limit: u.limit,
      percentUsed: (u.used / u.limit) * 100,
      operations: u.operations.length,
      operationsByType: this.groupOperationsByType(u.operations),
    }));
  }

  /**
   * Reset daily quota (for testing)
   */
  public async resetDailyQuota(): Promise<void> {
    const today = this.getTodayDate();

    await db.quotaUsage.update({
      where: { date: today },
      data: { used: 0 },
    });

    logger.info('Daily quota reset');
  }

  /**
   * Get today's date (midnight UTC)
   */
  private getTodayDate(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }

  /**
   * Group operations by type
   */
  private groupOperationsByType(
    operations: { operationType: string; cost: number }[]
  ): Record<string, { count: number; totalCost: number }> {
    const grouped: Record<string, { count: number; totalCost: number }> = {};

    for (const op of operations) {
      if (!grouped[op.operationType]) {
        grouped[op.operationType] = { count: 0, totalCost: 0 };
      }
      grouped[op.operationType]!.count += 1;
      grouped[op.operationType]!.totalCost += op.cost;
    }

    return grouped;
  }
}

/**
 * Quota operation type
 */
export interface QuotaOperation {
  type:
    | 'playlist.details'
    | 'playlist.items'
    | 'video.details'
    | 'search'
    | 'channel.details';
  itemCount?: number;
}

/**
 * Quota usage statistics
 */
export interface QuotaStats {
  date: Date;
  used: number;
  limit: number;
  percentUsed: number;
  operations: number;
  operationsByType: Record<string, { count: number; totalCost: number }>;
}

/**
 * Singleton instance
 */
let managerInstance: QuotaManager | null = null;

/**
 * Get quota manager instance
 */
export function getQuotaManager(): QuotaManager {
  if (!managerInstance) {
    managerInstance = new QuotaManager();
  }
  return managerInstance;
}

export default getQuotaManager;
