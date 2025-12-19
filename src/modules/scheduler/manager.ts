/**
 * Scheduler Manager
 *
 * Manages periodic playlist synchronization using node-cron
 * Provides schedule CRUD operations and automatic sync execution
 */

import * as cron from 'node-cron';
import { getPrismaClient } from '../database';
import { SyncEngine } from '../sync/engine';
import { logger } from '../../utils/logger';

export interface ScheduleConfig {
  playlistId: string;
  interval: number; // in milliseconds
  enabled?: boolean;
  maxRetries?: number;
}

export interface ScheduleInfo {
  id: string;
  playlistId: string;
  interval: number;
  enabled: boolean;
  lastRun: Date | null;
  nextRun: Date;
  retryCount: number;
  maxRetries: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Scheduler Manager
 */
export class SchedulerManager {
  private db = getPrismaClient();
  private syncEngine: SyncEngine;
  private cronJobs: Map<string, cron.ScheduledTask> = new Map();
  private running = false;

  constructor() {
    this.syncEngine = new SyncEngine();
  }

  /**
   * Start scheduler
   */
  public async start(): Promise<void> {
    if (this.running) {
      logger.warn('Scheduler already running');
      return;
    }

    this.running = true;
    logger.info('Scheduler starting...');

    // Load all enabled schedules
    const schedules = await this.db.syncSchedule.findMany({
      where: { enabled: true },
    });

    // Start cron jobs for each schedule
    for (const schedule of schedules) {
      await this.startSchedule(schedule.playlistId);
    }

    logger.info('Scheduler started', { scheduleCount: schedules.length });
  }

  /**
   * Stop scheduler
   */
  public async stop(): Promise<void> {
    if (!this.running) {
      logger.warn('Scheduler not running');
      return;
    }

    this.running = false;
    logger.info('Scheduler stopping...');

    // Stop all cron jobs
    for (const [playlistId, job] of this.cronJobs.entries()) {
      job.stop();
      logger.debug('Stopped schedule', { playlistId });
    }

    this.cronJobs.clear();
    logger.info('Scheduler stopped');
  }

  /**
   * Create a new sync schedule
   */
  public async createSchedule(config: ScheduleConfig): Promise<ScheduleInfo> {
    try {
      // Check if schedule already exists
      const existing = await this.db.syncSchedule.findUnique({
        where: { playlistId: config.playlistId },
      });

      if (existing) {
        throw new Error(`Schedule already exists for playlist ${config.playlistId}`);
      }

      // Calculate next run time
      const nextRun = new Date(Date.now() + config.interval);

      // Create schedule
      const schedule = await this.db.syncSchedule.create({
        data: {
          playlistId: config.playlistId,
          interval: config.interval,
          enabled: config.enabled ?? true,
          nextRun,
          maxRetries: config.maxRetries ?? 3,
        },
      });

      logger.info('Schedule created', {
        playlistId: config.playlistId,
        interval: config.interval,
        nextRun,
      });

      // Start cron job if enabled
      if (schedule.enabled && this.running) {
        await this.startSchedule(schedule.playlistId);
      }

      return this.mapScheduleInfo(schedule);
    } catch (error) {
      logger.error('Failed to create schedule', { config, error });
      throw error;
    }
  }

  /**
   * Update an existing schedule
   */
  public async updateSchedule(
    playlistId: string,
    updates: Partial<ScheduleConfig>
  ): Promise<ScheduleInfo> {
    try {
      const existing = await this.db.syncSchedule.findUnique({
        where: { playlistId },
      });

      if (!existing) {
        throw new Error(`Schedule not found for playlist ${playlistId}`);
      }

      // Calculate new next run time if interval changed
      let nextRun = existing.nextRun;
      if (updates.interval && updates.interval !== existing.interval) {
        nextRun = new Date(Date.now() + updates.interval);
      }

      // Update schedule
      const schedule = await this.db.syncSchedule.update({
        where: { playlistId },
        data: {
          ...(updates.interval && { interval: updates.interval, nextRun }),
          ...(updates.enabled !== undefined && { enabled: updates.enabled }),
          ...(updates.maxRetries && { maxRetries: updates.maxRetries }),
        },
      });

      logger.info('Schedule updated', { playlistId, updates });

      // Restart cron job if running
      if (this.running) {
        await this.stopSchedule(playlistId);
        if (schedule.enabled) {
          await this.startSchedule(playlistId);
        }
      }

      return this.mapScheduleInfo(schedule);
    } catch (error) {
      logger.error('Failed to update schedule', { playlistId, updates, error });
      throw error;
    }
  }

  /**
   * Delete a schedule
   */
  public async deleteSchedule(playlistId: string): Promise<void> {
    try {
      // Stop cron job if running
      if (this.running) {
        await this.stopSchedule(playlistId);
      }

      // Delete schedule
      await this.db.syncSchedule.delete({
        where: { playlistId },
      });

      logger.info('Schedule deleted', { playlistId });
    } catch (error) {
      logger.error('Failed to delete schedule', { playlistId, error });
      throw error;
    }
  }

  /**
   * Get schedule info
   */
  public async getSchedule(playlistId: string): Promise<ScheduleInfo | null> {
    const schedule = await this.db.syncSchedule.findUnique({
      where: { playlistId },
    });

    return schedule ? this.mapScheduleInfo(schedule) : null;
  }

  /**
   * List all schedules
   */
  public async listSchedules(enabledOnly: boolean = false): Promise<ScheduleInfo[]> {
    const schedules = await this.db.syncSchedule.findMany({
      where: enabledOnly ? { enabled: true } : undefined,
      orderBy: { nextRun: 'asc' },
    });

    return schedules.map(s => this.mapScheduleInfo(s));
  }

  /**
   * Enable a schedule
   */
  public async enableSchedule(playlistId: string): Promise<void> {
    await this.updateSchedule(playlistId, { enabled: true });
  }

  /**
   * Disable a schedule
   */
  public async disableSchedule(playlistId: string): Promise<void> {
    await this.updateSchedule(playlistId, { enabled: false });
  }

  /**
   * Start cron job for a schedule
   */
  private async startSchedule(playlistId: string): Promise<void> {
    try {
      const schedule = await this.db.syncSchedule.findUnique({
        where: { playlistId },
      });

      if (!schedule || !schedule.enabled) {
        return;
      }

      // Stop existing job if any
      await this.stopSchedule(playlistId);

      // Calculate cron expression from interval
      const cronExpression = this.intervalToCron(schedule.interval);

      // Create cron job
      const job = cron.schedule(cronExpression, async () => {
        await this.executeSyncJob(playlistId);
      });

      this.cronJobs.set(playlistId, job);
      logger.debug('Schedule started', { playlistId, cronExpression });
    } catch (error) {
      logger.error('Failed to start schedule', { playlistId, error });
    }
  }

  /**
   * Stop cron job for a schedule
   */
  private async stopSchedule(playlistId: string): Promise<void> {
    const job = this.cronJobs.get(playlistId);
    if (job) {
      job.stop();
      this.cronJobs.delete(playlistId);
      logger.debug('Schedule stopped', { playlistId });
    }
  }

  /**
   * Execute sync job for a playlist
   */
  private async executeSyncJob(playlistId: string): Promise<void> {
    try {
      logger.info('Executing scheduled sync', { playlistId });

      const schedule = await this.db.syncSchedule.findUnique({
        where: { playlistId },
      });

      if (!schedule || !schedule.enabled) {
        logger.warn('Schedule disabled or not found', { playlistId });
        return;
      }

      // Update last run time
      await this.db.syncSchedule.update({
        where: { playlistId },
        data: {
          lastRun: new Date(),
          nextRun: new Date(Date.now() + schedule.interval),
        },
      });

      // Execute sync
      try {
        const result = await this.syncEngine.syncPlaylist(playlistId);

        // Reset retry count on success
        await this.db.syncSchedule.update({
          where: { playlistId },
          data: { retryCount: 0 },
        });

        logger.info('Scheduled sync completed', { playlistId, result });
      } catch (error) {
        // Increment retry count
        const newRetryCount = schedule.retryCount + 1;
        await this.db.syncSchedule.update({
          where: { playlistId },
          data: { retryCount: newRetryCount },
        });

        logger.error('Scheduled sync failed', {
          playlistId,
          retryCount: newRetryCount,
          maxRetries: schedule.maxRetries,
          error,
        });

        // Disable schedule if max retries exceeded
        if (newRetryCount >= schedule.maxRetries) {
          await this.disableSchedule(playlistId);
          logger.warn('Schedule disabled due to max retries', { playlistId });
        }
      }
    } catch (error) {
      logger.error('Failed to execute sync job', { playlistId, error });
    }
  }

  /**
   * Convert interval (ms) to cron expression
   */
  private intervalToCron(interval: number): string {
    const minutes = Math.floor(interval / 60000);

    if (minutes < 1) {
      // Every minute (minimum)
      return '* * * * *';
    } else if (minutes < 60) {
      // Every N minutes
      return `*/${minutes} * * * *`;
    } else {
      const hours = Math.floor(minutes / 60);
      if (hours < 24) {
        // Every N hours
        return `0 */${hours} * * *`;
      } else {
        const days = Math.floor(hours / 24);
        // Every N days
        return `0 0 */${days} * *`;
      }
    }
  }

  /**
   * Map database model to ScheduleInfo
   */
  private mapScheduleInfo(schedule: {
    id: string;
    playlistId: string;
    interval: number;
    enabled: boolean;
    lastRun: Date | null;
    nextRun: Date;
    retryCount: number;
    maxRetries: number;
    createdAt: Date;
    updatedAt: Date;
  }): ScheduleInfo {
    return {
      id: schedule.id,
      playlistId: schedule.playlistId,
      interval: schedule.interval,
      enabled: schedule.enabled,
      lastRun: schedule.lastRun,
      nextRun: schedule.nextRun,
      retryCount: schedule.retryCount,
      maxRetries: schedule.maxRetries,
      createdAt: schedule.createdAt,
      updatedAt: schedule.updatedAt,
    };
  }
}

/**
 * Singleton instance
 */
let schedulerInstance: SchedulerManager | null = null;

/**
 * Get scheduler manager instance
 */
export function getSchedulerManager(): SchedulerManager {
  if (!schedulerInstance) {
    schedulerInstance = new SchedulerManager();
  }
  return schedulerInstance;
}

export default getSchedulerManager;
