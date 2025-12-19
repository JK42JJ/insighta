/**
 * Auto-Sync Scheduler Module
 *
 * Manages automatic periodic playlist synchronization with:
 * - Singleton pattern for global scheduler instance
 * - Multiple playlists with different sync intervals
 * - Cron-based scheduling with flexible expressions
 * - Concurrent sync safety with lock mechanism
 * - Comprehensive logging and error handling
 * - Integration with SyncEngine, QuotaManager, and SchedulerManager
 */

import * as cron from 'node-cron';
import { getSyncEngine, SyncResult } from '../sync/engine';
import { getQuotaManager } from '../quota/manager';
import { getSchedulerManager, ScheduleInfo } from './manager';
import { logger } from '../../utils/logger';
import { SyncStatus } from '../../types/enums';

/**
 * Scheduler status information
 */
export interface SchedulerStatus {
  running: boolean;
  activeSchedules: number;
  runningJobs: string[];
  uptime: number;
  lastError?: string;
}

/**
 * Auto-Sync Scheduler
 *
 * Singleton scheduler that manages automatic playlist synchronization.
 * Uses node-cron for flexible scheduling and integrates with existing
 * sync infrastructure.
 *
 * Note: Managers are lazily loaded to avoid initializing at class instantiation time.
 * This is required for serverless environments where credentials may not be available
 * until the actual request is made.
 */
export class AutoSyncScheduler {
  // Lazy getters for dependencies - only initialize when actually needed
  private get syncEngine() {
    return getSyncEngine();
  }
  private get quotaManager() {
    return getQuotaManager();
  }
  private get schedulerManager() {
    return getSchedulerManager();
  }

  private running = false;
  private startTime: number | null = null;
  private cronJobs: Map<string, cron.ScheduledTask> = new Map();
  private runningJobs: Set<string> = new Set();
  private lastError?: string;

  /**
   * Start the auto-sync scheduler
   *
   * Loads all enabled schedules from database and starts cron jobs.
   * Idempotent - safe to call multiple times.
   */
  public async start(): Promise<void> {
    if (this.running) {
      logger.warn('AutoSyncScheduler already running');
      return;
    }

    try {
      this.running = true;
      this.startTime = Date.now();
      this.lastError = undefined;

      logger.info('AutoSyncScheduler starting...');

      // Start the underlying SchedulerManager
      await this.schedulerManager.start();

      // Load all enabled schedules
      const schedules = await this.schedulerManager.listSchedules(true);

      logger.info('AutoSyncScheduler started', {
        scheduleCount: schedules.length,
        schedules: schedules.map(s => ({
          playlistId: s.playlistId,
          interval: s.interval,
          nextRun: s.nextRun,
        })),
      });
    } catch (error) {
      this.running = false;
      this.startTime = null;
      this.lastError = error instanceof Error ? error.message : String(error);

      logger.error('Failed to start AutoSyncScheduler', { error: this.lastError });
      throw error;
    }
  }

  /**
   * Stop the auto-sync scheduler
   *
   * Stops all running cron jobs and waits for active syncs to complete.
   */
  public async stop(): Promise<void> {
    if (!this.running) {
      logger.warn('AutoSyncScheduler not running');
      return;
    }

    try {
      logger.info('AutoSyncScheduler stopping...');

      // Stop the underlying SchedulerManager
      await this.schedulerManager.stop();

      // Wait for running jobs to complete (with timeout)
      const timeout = 30000; // 30 seconds
      const startWait = Date.now();

      while (this.runningJobs.size > 0 && Date.now() - startWait < timeout) {
        logger.info('Waiting for running jobs to complete', {
          remaining: Array.from(this.runningJobs),
        });
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      if (this.runningJobs.size > 0) {
        logger.warn('Stopping scheduler with running jobs', {
          jobs: Array.from(this.runningJobs),
        });
      }

      this.running = false;
      this.startTime = null;
      this.cronJobs.clear();
      this.runningJobs.clear();

      logger.info('AutoSyncScheduler stopped');
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      logger.error('Error stopping AutoSyncScheduler', { error: this.lastError });
      throw error;
    }
  }

  /**
   * Get scheduler status
   */
  public getStatus(): SchedulerStatus {
    return {
      running: this.running,
      activeSchedules: this.cronJobs.size,
      runningJobs: Array.from(this.runningJobs),
      uptime: this.startTime ? Date.now() - this.startTime : 0,
      lastError: this.lastError,
    };
  }

  /**
   * Add playlist to auto-sync schedule
   *
   * @param playlistId - Database playlist ID
   * @param cronExpression - Cron expression (e.g., "0 *\\/6 * * *" for every 6 hours)
   * @param enabled - Whether schedule is enabled (default: true)
   * @param maxRetries - Maximum retry attempts on failure (default: 3)
   */
  public async addPlaylist(
    playlistId: string,
    cronExpression: string,
    enabled: boolean = true,
    maxRetries: number = 3
  ): Promise<ScheduleInfo> {
    try {
      // Validate cron expression
      if (!cron.validate(cronExpression)) {
        throw new Error(`Invalid cron expression: ${cronExpression}`);
      }

      // Convert cron to interval (approximate milliseconds)
      const interval = this.cronToInterval(cronExpression);

      // Create schedule in database
      const schedule = await this.schedulerManager.createSchedule({
        playlistId,
        interval,
        enabled,
        maxRetries,
      });

      logger.info('Playlist added to auto-sync schedule', {
        playlistId,
        cronExpression,
        interval,
        enabled,
      });

      // If scheduler is running and schedule is enabled, start it immediately
      if (this.running && enabled) {
        await this.startSchedule(playlistId);
      }

      return schedule;
    } catch (error) {
      logger.error('Failed to add playlist to schedule', { playlistId, error });
      throw error;
    }
  }

  /**
   * Remove playlist from auto-sync schedule
   *
   * @param playlistId - Database playlist ID
   */
  public async removePlaylist(playlistId: string): Promise<void> {
    try {
      // Stop cron job if running
      await this.stopSchedule(playlistId);

      // Delete schedule from database
      await this.schedulerManager.deleteSchedule(playlistId);

      logger.info('Playlist removed from auto-sync schedule', { playlistId });
    } catch (error) {
      logger.error('Failed to remove playlist from schedule', { playlistId, error });
      throw error;
    }
  }

  /**
   * Start cron job for a specific playlist schedule
   */
  private async startSchedule(playlistId: string): Promise<void> {
    try {
      // Get schedule from database
      const schedule = await this.schedulerManager.getSchedule(playlistId);

      if (!schedule || !schedule.enabled) {
        logger.debug('Schedule not found or disabled', { playlistId });
        return;
      }

      // Stop existing job if any
      await this.stopSchedule(playlistId);

      // Convert interval to cron expression
      const cronExpression = this.intervalToCron(schedule.interval);

      // Create and start cron job
      const job = cron.schedule(cronExpression, async () => {
        await this.executeSyncJob(playlistId);
      });

      this.cronJobs.set(playlistId, job);

      logger.debug('Schedule started', {
        playlistId,
        cronExpression,
        interval: schedule.interval,
        nextRun: schedule.nextRun,
      });
    } catch (error) {
      logger.error('Failed to start schedule', { playlistId, error });
    }
  }

  /**
   * Stop cron job for a specific playlist schedule
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
   * Execute sync job for a playlist with proper locking and error handling
   */
  private async executeSyncJob(playlistId: string): Promise<void> {
    // Check if job is already running for this playlist
    if (this.runningJobs.has(playlistId)) {
      logger.warn('Sync job already running for playlist', { playlistId });
      return;
    }

    // Add to running jobs set
    this.runningJobs.add(playlistId);

    try {
      logger.info('Starting scheduled sync job', { playlistId });

      // Check quota availability before syncing
      const { remaining } = await this.quotaManager.getTodayUsage();

      if (remaining < 100) {
        logger.warn('Insufficient quota for sync job', {
          playlistId,
          remaining,
        });
        return;
      }

      // Execute sync through SyncEngine
      const result: SyncResult = await this.syncEngine.syncPlaylist(playlistId);

      logger.info('Scheduled sync job completed', {
        playlistId,
        status: result.status,
        itemsAdded: result.itemsAdded,
        itemsRemoved: result.itemsRemoved,
        itemsReordered: result.itemsReordered,
        duration: result.duration,
        quotaUsed: result.quotaUsed,
      });

      // Clear last error on success
      if (result.status === SyncStatus.COMPLETED) {
        this.lastError = undefined;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.lastError = errorMessage;

      logger.error('Scheduled sync job failed', {
        playlistId,
        error: errorMessage,
      });
    } finally {
      // Remove from running jobs set
      this.runningJobs.delete(playlistId);
    }
  }

  /**
   * Convert cron expression to approximate interval in milliseconds
   *
   * This is a best-effort conversion for database storage.
   * Not all cron expressions can be accurately represented as intervals.
   */
  private cronToInterval(cronExpression: string): number {
    // Parse common cron patterns
    const parts = cronExpression.trim().split(/\s+/);

    if (parts.length !== 5) {
      // Default to 6 hours if parsing fails
      return 6 * 60 * 60 * 1000;
    }

    const [minute, hour, dayOfMonth, , dayOfWeek] = parts;

    // Every minute: * * * * *
    if (minute === '*' && hour === '*' && dayOfMonth === '*' && dayOfWeek === '*') {
      return 60 * 1000; // 1 minute minimum
    }

    // Every N minutes: */N * * * *
    if (minute?.startsWith('*/') && hour === '*') {
      const minutes = parseInt(minute.substring(2), 10);
      return minutes * 60 * 1000;
    }

    // Every N hours: 0 */N * * *
    if (minute === '0' && hour?.startsWith('*/')) {
      const hours = parseInt(hour.substring(2), 10);
      return hours * 60 * 60 * 1000;
    }

    // Every N days: 0 0 */N * *
    if (minute === '0' && hour === '0' && dayOfMonth?.startsWith('*/')) {
      const days = parseInt(dayOfMonth.substring(2), 10);
      return days * 24 * 60 * 60 * 1000;
    }

    // Weekly: M H * * N (check before daily to avoid matching weekly as daily)
    if (!minute?.includes('*') && !hour?.includes('*') && dayOfWeek !== '*') {
      return 7 * 24 * 60 * 60 * 1000;
    }

    // Daily at specific time: M H * * *
    if (!minute?.includes('*') && !hour?.includes('*') && dayOfMonth === '*') {
      return 24 * 60 * 60 * 1000;
    }

    // Default to 6 hours for complex patterns
    return 6 * 60 * 60 * 1000;
  }

  /**
   * Convert interval (milliseconds) to cron expression
   *
   * This creates simple cron expressions for common intervals.
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
        // Every N days at midnight
        return `0 0 */${days} * *`;
      }
    }
  }
}

/**
 * Singleton instance
 */
let schedulerInstance: AutoSyncScheduler | null = null;

/**
 * Get auto-sync scheduler instance
 */
export function getAutoSyncScheduler(): AutoSyncScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new AutoSyncScheduler();
  }
  return schedulerInstance;
}

export default getAutoSyncScheduler;
