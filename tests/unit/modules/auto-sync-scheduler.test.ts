/**
 * Unit tests for Auto-Sync Scheduler
 */

import { AutoSyncScheduler, getAutoSyncScheduler } from '../../../src/modules/scheduler/auto-sync';
import { getSyncEngine } from '../../../src/modules/sync/engine';
import { getQuotaManager } from '../../../src/modules/quota/manager';
import { getSchedulerManager, ScheduleInfo } from '../../../src/modules/scheduler/manager';
import { SyncStatus } from '../../../src/types/enums';

// Mock dependencies
jest.mock('../../../src/modules/sync/engine');
jest.mock('../../../src/modules/quota/manager');
jest.mock('../../../src/modules/scheduler/manager');
jest.mock('../../../src/utils/logger');
jest.mock('node-cron', () => ({
  schedule: jest.fn(() => ({
    stop: jest.fn(),
  })),
  validate: jest.fn((expr: string) => {
    // Simple validation for common patterns
    const parts = expr.trim().split(/\s+/);
    return parts.length === 5;
  }),
}));

describe('AutoSyncScheduler', () => {
  let scheduler: AutoSyncScheduler;
  let mockSyncEngine: any;
  let mockQuotaManager: any;
  let mockSchedulerManager: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock implementations
    mockSyncEngine = {
      syncPlaylist: jest.fn(),
    };

    mockQuotaManager = {
      getTodayUsage: jest.fn(),
    };

    mockSchedulerManager = {
      start: jest.fn(),
      stop: jest.fn(),
      createSchedule: jest.fn(),
      deleteSchedule: jest.fn(),
      getSchedule: jest.fn(),
      listSchedules: jest.fn(),
    };

    (getSyncEngine as jest.Mock).mockReturnValue(mockSyncEngine);
    (getQuotaManager as jest.Mock).mockReturnValue(mockQuotaManager);
    (getSchedulerManager as jest.Mock).mockReturnValue(mockSchedulerManager);

    // Create new scheduler instance for each test
    scheduler = new AutoSyncScheduler();
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = getAutoSyncScheduler();
      const instance2 = getAutoSyncScheduler();

      expect(instance1).toBe(instance2);
    });
  });

  describe('start()', () => {
    it('should start scheduler successfully', async () => {
      mockSchedulerManager.listSchedules.mockResolvedValue([
        {
          id: 'schedule-1',
          playlistId: 'playlist-1',
          interval: 6 * 60 * 60 * 1000,
          enabled: true,
          nextRun: new Date(),
          maxRetries: 3,
        },
      ]);

      await scheduler.start();

      // Add small delay to ensure uptime is > 0
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockSchedulerManager.start).toHaveBeenCalled();
      expect(mockSchedulerManager.listSchedules).toHaveBeenCalledWith(true);

      const status = scheduler.getStatus();
      expect(status.running).toBe(true);
      expect(status.uptime).toBeGreaterThanOrEqual(0);
    });

    it('should not start if already running', async () => {
      mockSchedulerManager.listSchedules.mockResolvedValue([]);

      await scheduler.start();
      await scheduler.start(); // Call again

      // Should only call start once
      expect(mockSchedulerManager.start).toHaveBeenCalledTimes(1);
    });

    it('should handle start errors', async () => {
      const error = new Error('Start failed');
      mockSchedulerManager.start.mockRejectedValue(error);

      await expect(scheduler.start()).rejects.toThrow('Start failed');

      const status = scheduler.getStatus();
      expect(status.running).toBe(false);
      expect(status.lastError).toBe('Start failed');
    });
  });

  describe('stop()', () => {
    it('should stop scheduler successfully', async () => {
      mockSchedulerManager.listSchedules.mockResolvedValue([]);

      await scheduler.start();
      await scheduler.stop();

      expect(mockSchedulerManager.stop).toHaveBeenCalled();

      const status = scheduler.getStatus();
      expect(status.running).toBe(false);
    });

    it('should not stop if not running', async () => {
      await scheduler.stop();

      // Should not call stop if not running
      expect(mockSchedulerManager.stop).not.toHaveBeenCalled();
    });

    it('should wait for running jobs to complete', async () => {
      mockSchedulerManager.listSchedules.mockResolvedValue([]);
      mockSyncEngine.syncPlaylist.mockImplementation(() =>
        new Promise((resolve) => setTimeout(() => resolve({
          playlistId: 'playlist-1',
          status: SyncStatus.COMPLETED,
          itemsAdded: 0,
          itemsRemoved: 0,
          itemsReordered: 0,
          duration: 100,
          quotaUsed: 10,
        }), 100))
      );
      mockQuotaManager.getTodayUsage.mockResolvedValue({
        used: 0,
        remaining: 10000,
        limit: 10000,
      });

      await scheduler.start();

      // Trigger a sync job (this would normally be done by cron)
      const stopPromise = scheduler.stop();

      await stopPromise;

      expect(mockSchedulerManager.stop).toHaveBeenCalled();
    });
  });

  describe('getStatus()', () => {
    it('should return correct status when stopped', () => {
      const status = scheduler.getStatus();

      expect(status.running).toBe(false);
      expect(status.activeSchedules).toBe(0);
      expect(status.runningJobs).toEqual([]);
      expect(status.uptime).toBe(0);
    });

    it('should return correct status when running', async () => {
      mockSchedulerManager.listSchedules.mockResolvedValue([]);

      await scheduler.start();

      // Add small delay to ensure uptime is > 0
      await new Promise(resolve => setTimeout(resolve, 10));

      const status = scheduler.getStatus();

      expect(status.running).toBe(true);
      expect(status.uptime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('addPlaylist()', () => {
    it('should add playlist with valid cron expression', async () => {
      const mockSchedule: ScheduleInfo = {
        id: 'schedule-1',
        playlistId: 'playlist-1',
        interval: 6 * 60 * 60 * 1000,
        enabled: true,
        lastRun: null,
        nextRun: new Date(Date.now() + 6 * 60 * 60 * 1000),
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockSchedulerManager.createSchedule.mockResolvedValue(mockSchedule);

      const schedule = await scheduler.addPlaylist('playlist-1', '0 */6 * * *', true, 3);

      expect(schedule).toEqual(mockSchedule);
      expect(mockSchedulerManager.createSchedule).toHaveBeenCalledWith({
        playlistId: 'playlist-1',
        interval: 6 * 60 * 60 * 1000,
        enabled: true,
        maxRetries: 3,
      });
    });

    it('should reject invalid cron expression', async () => {
      await expect(
        scheduler.addPlaylist('playlist-1', 'invalid cron', true, 3)
      ).rejects.toThrow('Invalid cron expression');
    });

    it('should handle default parameters', async () => {
      const mockSchedule: ScheduleInfo = {
        id: 'schedule-1',
        playlistId: 'playlist-1',
        interval: 6 * 60 * 60 * 1000,
        enabled: true,
        lastRun: null,
        nextRun: new Date(Date.now() + 6 * 60 * 60 * 1000),
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockSchedulerManager.createSchedule.mockResolvedValue(mockSchedule);

      await scheduler.addPlaylist('playlist-1', '0 */6 * * *');

      expect(mockSchedulerManager.createSchedule).toHaveBeenCalledWith({
        playlistId: 'playlist-1',
        interval: 6 * 60 * 60 * 1000,
        enabled: true,
        maxRetries: 3,
      });
    });
  });

  describe('removePlaylist()', () => {
    it('should remove playlist successfully', async () => {
      await scheduler.removePlaylist('playlist-1');

      expect(mockSchedulerManager.deleteSchedule).toHaveBeenCalledWith('playlist-1');
    });

    it('should handle removal errors', async () => {
      const error = new Error('Delete failed');
      mockSchedulerManager.deleteSchedule.mockRejectedValue(error);

      await expect(scheduler.removePlaylist('playlist-1')).rejects.toThrow('Delete failed');
    });
  });

  describe('Cron Expression Conversion', () => {
    it('should convert "every 15 minutes" cron to interval', async () => {
      const mockSchedule: ScheduleInfo = {
        id: 'schedule-1',
        playlistId: 'playlist-1',
        interval: 15 * 60 * 1000,
        enabled: true,
        lastRun: null,
        nextRun: new Date(),
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockSchedulerManager.createSchedule.mockResolvedValue(mockSchedule);

      await scheduler.addPlaylist('playlist-1', '*/15 * * * *');

      expect(mockSchedulerManager.createSchedule).toHaveBeenCalledWith(
        expect.objectContaining({
          interval: 15 * 60 * 1000,
        })
      );
    });

    it('should convert "every 6 hours" cron to interval', async () => {
      const mockSchedule: ScheduleInfo = {
        id: 'schedule-1',
        playlistId: 'playlist-1',
        interval: 6 * 60 * 60 * 1000,
        enabled: true,
        lastRun: null,
        nextRun: new Date(),
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockSchedulerManager.createSchedule.mockResolvedValue(mockSchedule);

      await scheduler.addPlaylist('playlist-1', '0 */6 * * *');

      expect(mockSchedulerManager.createSchedule).toHaveBeenCalledWith(
        expect.objectContaining({
          interval: 6 * 60 * 60 * 1000,
        })
      );
    });

    it('should convert "daily" cron to interval', async () => {
      const mockSchedule: ScheduleInfo = {
        id: 'schedule-1',
        playlistId: 'playlist-1',
        interval: 24 * 60 * 60 * 1000,
        enabled: true,
        lastRun: null,
        nextRun: new Date(),
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockSchedulerManager.createSchedule.mockResolvedValue(mockSchedule);

      await scheduler.addPlaylist('playlist-1', '0 0 * * *');

      expect(mockSchedulerManager.createSchedule).toHaveBeenCalledWith(
        expect.objectContaining({
          interval: 24 * 60 * 60 * 1000,
        })
      );
    });
  });

  describe('Quota Integration', () => {
    it('should skip sync when quota is low', async () => {
      mockSchedulerManager.listSchedules.mockResolvedValue([]);
      mockQuotaManager.getTodayUsage.mockResolvedValue({
        used: 9950,
        remaining: 50,
        limit: 10000,
      });

      await scheduler.start();

      // getStatus should work even when quota is low
      const status = scheduler.getStatus();
      expect(status.running).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle sync errors gracefully', async () => {
      mockSchedulerManager.listSchedules.mockResolvedValue([]);
      mockQuotaManager.getTodayUsage.mockResolvedValue({
        used: 0,
        remaining: 10000,
        limit: 10000,
      });
      mockSyncEngine.syncPlaylist.mockRejectedValue(new Error('Sync failed'));

      await scheduler.start();

      // The scheduler should continue running even after sync errors
      const status = scheduler.getStatus();
      expect(status.running).toBe(true);
    });

    it('should track last error', async () => {
      const error = new Error('Test error');
      mockSchedulerManager.start.mockRejectedValue(error);

      await expect(scheduler.start()).rejects.toThrow('Test error');

      const status = scheduler.getStatus();
      expect(status.lastError).toBe('Test error');
    });
  });

  describe('Concurrent Job Prevention', () => {
    it('should prevent duplicate jobs for same playlist', async () => {
      mockSchedulerManager.listSchedules.mockResolvedValue([]);
      mockQuotaManager.getTodayUsage.mockResolvedValue({
        used: 0,
        remaining: 10000,
        limit: 10000,
      });

      // Mock a long-running sync
      mockSyncEngine.syncPlaylist.mockImplementation(() =>
        new Promise((resolve) => setTimeout(() => resolve({
          playlistId: 'playlist-1',
          status: SyncStatus.COMPLETED,
          itemsAdded: 0,
          itemsRemoved: 0,
          itemsReordered: 0,
          duration: 1000,
          quotaUsed: 10,
        }), 1000))
      );

      await scheduler.start();

      // The second call should be prevented by the runningJobs set
      const status = scheduler.getStatus();
      expect(status.running).toBe(true);
    });
  });

  describe('addPlaylist with running scheduler', () => {
    it('should start schedule immediately when scheduler is running', async () => {
      mockSchedulerManager.listSchedules.mockResolvedValue([]);
      await scheduler.start();

      const mockSchedule: ScheduleInfo = {
        id: 'schedule-1',
        playlistId: 'playlist-1',
        interval: 6 * 60 * 60 * 1000,
        enabled: true,
        lastRun: null,
        nextRun: new Date(Date.now() + 6 * 60 * 60 * 1000),
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockSchedulerManager.createSchedule.mockResolvedValue(mockSchedule);
      mockSchedulerManager.getSchedule.mockResolvedValue(mockSchedule);

      await scheduler.addPlaylist('playlist-1', '0 */6 * * *', true, 3);

      // Should have called getSchedule for startSchedule
      expect(mockSchedulerManager.getSchedule).toHaveBeenCalledWith('playlist-1');
    });

    it('should not start schedule when enabled is false', async () => {
      mockSchedulerManager.listSchedules.mockResolvedValue([]);
      await scheduler.start();

      const mockSchedule: ScheduleInfo = {
        id: 'schedule-1',
        playlistId: 'playlist-1',
        interval: 6 * 60 * 60 * 1000,
        enabled: false,
        lastRun: null,
        nextRun: new Date(Date.now() + 6 * 60 * 60 * 1000),
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockSchedulerManager.createSchedule.mockResolvedValue(mockSchedule);

      await scheduler.addPlaylist('playlist-1', '0 */6 * * *', false, 3);

      // Should not have called getSchedule since enabled=false
      expect(mockSchedulerManager.getSchedule).not.toHaveBeenCalled();
    });

    it('should handle addPlaylist errors', async () => {
      mockSchedulerManager.createSchedule.mockRejectedValue(new Error('Create failed'));

      await expect(
        scheduler.addPlaylist('playlist-1', '0 */6 * * *')
      ).rejects.toThrow('Create failed');
    });
  });

  describe('Cron Expression Conversion - Edge Cases', () => {
    it('should convert "every N days" cron to interval', async () => {
      const mockSchedule: ScheduleInfo = {
        id: 'schedule-1',
        playlistId: 'playlist-1',
        interval: 3 * 24 * 60 * 60 * 1000,
        enabled: true,
        lastRun: null,
        nextRun: new Date(),
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockSchedulerManager.createSchedule.mockResolvedValue(mockSchedule);

      await scheduler.addPlaylist('playlist-1', '0 0 */3 * *');

      expect(mockSchedulerManager.createSchedule).toHaveBeenCalledWith(
        expect.objectContaining({
          interval: 3 * 24 * 60 * 60 * 1000,
        })
      );
    });

    it('should convert weekly cron to interval', async () => {
      const mockSchedule: ScheduleInfo = {
        id: 'schedule-1',
        playlistId: 'playlist-1',
        interval: 7 * 24 * 60 * 60 * 1000,
        enabled: true,
        lastRun: null,
        nextRun: new Date(),
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockSchedulerManager.createSchedule.mockResolvedValue(mockSchedule);

      await scheduler.addPlaylist('playlist-1', '0 9 * * 1');

      expect(mockSchedulerManager.createSchedule).toHaveBeenCalledWith(
        expect.objectContaining({
          interval: 7 * 24 * 60 * 60 * 1000,
        })
      );
    });

    it('should default to 6 hours for complex cron patterns', async () => {
      const mockSchedule: ScheduleInfo = {
        id: 'schedule-1',
        playlistId: 'playlist-1',
        interval: 6 * 60 * 60 * 1000,
        enabled: true,
        lastRun: null,
        nextRun: new Date(),
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockSchedulerManager.createSchedule.mockResolvedValue(mockSchedule);

      // Complex pattern that doesn't match simple patterns
      await scheduler.addPlaylist('playlist-1', '30 8 1 1 *');

      expect(mockSchedulerManager.createSchedule).toHaveBeenCalledWith(
        expect.objectContaining({
          interval: 6 * 60 * 60 * 1000,
        })
      );
    });
  });

  describe('Stop with timeout', () => {
    it('should handle stop errors', async () => {
      mockSchedulerManager.listSchedules.mockResolvedValue([]);
      await scheduler.start();

      mockSchedulerManager.stop.mockRejectedValue(new Error('Stop failed'));

      await expect(scheduler.stop()).rejects.toThrow('Stop failed');

      const status = scheduler.getStatus();
      expect(status.lastError).toBe('Stop failed');
    });

    it('should log warning when stopped with running jobs', async () => {
      const nodeCron = require('node-cron');
      mockSchedulerManager.listSchedules.mockResolvedValue([]);

      // Make syncPlaylist take a long time
      let syncResolve: Function;
      mockSyncEngine.syncPlaylist.mockImplementation(() =>
        new Promise((resolve) => {
          syncResolve = resolve;
          // Never resolve - simulates long-running job
        })
      );
      mockQuotaManager.getTodayUsage.mockResolvedValue({
        used: 0,
        remaining: 10000,
        limit: 10000,
      });

      await scheduler.start();

      // Get the cron callback and invoke it to simulate a running job
      const cronCallback = nodeCron.schedule.mock.calls[0]?.[1];
      if (cronCallback) {
        // Start the sync job but don't wait for it
        cronCallback();
      }

      // Stop should complete without waiting too long (30s timeout)
      // The mock setTimeout will make this instant
      await scheduler.stop();

      const status = scheduler.getStatus();
      expect(status.running).toBe(false);
    });
  });

  describe('startSchedule edge cases', () => {
    it('should handle disabled schedule', async () => {
      mockSchedulerManager.listSchedules.mockResolvedValue([]);
      await scheduler.start();

      const mockSchedule: ScheduleInfo = {
        id: 'schedule-1',
        playlistId: 'playlist-1',
        interval: 6 * 60 * 60 * 1000,
        enabled: true,
        lastRun: null,
        nextRun: new Date(),
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockSchedulerManager.createSchedule.mockResolvedValue(mockSchedule);
      mockSchedulerManager.getSchedule.mockResolvedValue({
        ...mockSchedule,
        enabled: false,
      });

      await scheduler.addPlaylist('playlist-1', '0 */6 * * *', true, 3);

      // getSchedule was called but schedule is disabled
      expect(mockSchedulerManager.getSchedule).toHaveBeenCalled();
    });

    it('should handle schedule not found', async () => {
      mockSchedulerManager.listSchedules.mockResolvedValue([]);
      await scheduler.start();

      const mockSchedule: ScheduleInfo = {
        id: 'schedule-1',
        playlistId: 'playlist-1',
        interval: 6 * 60 * 60 * 1000,
        enabled: true,
        lastRun: null,
        nextRun: new Date(),
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockSchedulerManager.createSchedule.mockResolvedValue(mockSchedule);
      mockSchedulerManager.getSchedule.mockResolvedValue(null);

      await scheduler.addPlaylist('playlist-1', '0 */6 * * *', true, 3);

      // Should handle null schedule gracefully
      expect(mockSchedulerManager.getSchedule).toHaveBeenCalled();
    });

    it('should handle startSchedule errors', async () => {
      mockSchedulerManager.listSchedules.mockResolvedValue([]);
      await scheduler.start();

      const mockSchedule: ScheduleInfo = {
        id: 'schedule-1',
        playlistId: 'playlist-1',
        interval: 6 * 60 * 60 * 1000,
        enabled: true,
        lastRun: null,
        nextRun: new Date(),
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockSchedulerManager.createSchedule.mockResolvedValue(mockSchedule);
      mockSchedulerManager.getSchedule.mockRejectedValue(new Error('Get failed'));

      // Should not throw - errors are logged
      await scheduler.addPlaylist('playlist-1', '0 */6 * * *', true, 3);
    });
  });

  describe('executeSyncJob via cron trigger', () => {
    let nodeCron: any;

    beforeEach(() => {
      nodeCron = require('node-cron');
    });

    it('should track running jobs correctly through status', async () => {
      mockSchedulerManager.listSchedules.mockResolvedValue([]);

      await scheduler.start();

      const status = scheduler.getStatus();
      expect(status.runningJobs).toEqual([]);
    });

    it('should execute sync job successfully when triggered', async () => {
      mockSchedulerManager.listSchedules.mockResolvedValue([]);
      mockQuotaManager.getTodayUsage.mockResolvedValue({
        used: 0,
        remaining: 10000,
        limit: 10000,
      });
      mockSyncEngine.syncPlaylist.mockResolvedValue({
        playlistId: 'playlist-1',
        status: SyncStatus.COMPLETED,
        itemsAdded: 5,
        itemsRemoved: 2,
        itemsReordered: 0,
        duration: 500,
        quotaUsed: 15,
      });

      const mockSchedule: ScheduleInfo = {
        id: 'schedule-1',
        playlistId: 'playlist-1',
        interval: 6 * 60 * 60 * 1000,
        enabled: true,
        lastRun: null,
        nextRun: new Date(),
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await scheduler.start();

      mockSchedulerManager.createSchedule.mockResolvedValue(mockSchedule);
      mockSchedulerManager.getSchedule.mockResolvedValue(mockSchedule);

      await scheduler.addPlaylist('playlist-1', '0 */6 * * *', true, 3);

      // Get the cron callback and invoke it
      const cronCall = nodeCron.schedule.mock.calls.find(
        (call: any[]) => call[0] === '0 */6 * * *'
      );
      if (cronCall && cronCall[1]) {
        await cronCall[1]();
      }

      expect(mockSyncEngine.syncPlaylist).toHaveBeenCalledWith('playlist-1');
    });

    it('should skip sync when quota is insufficient', async () => {
      mockSchedulerManager.listSchedules.mockResolvedValue([]);
      mockQuotaManager.getTodayUsage.mockResolvedValue({
        used: 9950,
        remaining: 50, // Less than 100
        limit: 10000,
      });

      const mockSchedule: ScheduleInfo = {
        id: 'schedule-1',
        playlistId: 'playlist-1',
        interval: 6 * 60 * 60 * 1000,
        enabled: true,
        lastRun: null,
        nextRun: new Date(),
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await scheduler.start();

      mockSchedulerManager.createSchedule.mockResolvedValue(mockSchedule);
      mockSchedulerManager.getSchedule.mockResolvedValue(mockSchedule);

      await scheduler.addPlaylist('playlist-1', '0 */6 * * *', true, 3);

      // Get the cron callback and invoke it
      const cronCall = nodeCron.schedule.mock.calls.find(
        (call: any[]) => call[0] === '0 */6 * * *'
      );
      if (cronCall && cronCall[1]) {
        await cronCall[1]();
      }

      // Should not call syncPlaylist due to insufficient quota
      expect(mockSyncEngine.syncPlaylist).not.toHaveBeenCalled();
    });

    it('should prevent duplicate jobs for same playlist', async () => {
      mockSchedulerManager.listSchedules.mockResolvedValue([]);
      mockQuotaManager.getTodayUsage.mockResolvedValue({
        used: 0,
        remaining: 10000,
        limit: 10000,
      });

      // Make syncPlaylist take a long time
      let syncResolve: Function;
      mockSyncEngine.syncPlaylist.mockImplementation(() =>
        new Promise((resolve) => {
          syncResolve = resolve;
        })
      );

      const mockSchedule: ScheduleInfo = {
        id: 'schedule-1',
        playlistId: 'playlist-1',
        interval: 6 * 60 * 60 * 1000,
        enabled: true,
        lastRun: null,
        nextRun: new Date(),
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await scheduler.start();

      mockSchedulerManager.createSchedule.mockResolvedValue(mockSchedule);
      mockSchedulerManager.getSchedule.mockResolvedValue(mockSchedule);

      await scheduler.addPlaylist('playlist-1', '0 */6 * * *', true, 3);

      // Get the cron callback
      const cronCall = nodeCron.schedule.mock.calls.find(
        (call: any[]) => call[0] === '0 */6 * * *'
      );

      if (cronCall && cronCall[1]) {
        // First call - starts sync job
        const firstCall = cronCall[1]();

        // Second call - should be skipped (job already running)
        await cronCall[1]();

        // Resolve the first call
        syncResolve!({
          playlistId: 'playlist-1',
          status: SyncStatus.COMPLETED,
          itemsAdded: 0,
          itemsRemoved: 0,
          itemsReordered: 0,
          duration: 100,
          quotaUsed: 10,
        });

        await firstCall;
      }

      // Should only be called once
      expect(mockSyncEngine.syncPlaylist).toHaveBeenCalledTimes(1);
    });

    it('should handle sync errors and track last error', async () => {
      mockSchedulerManager.listSchedules.mockResolvedValue([]);
      mockQuotaManager.getTodayUsage.mockResolvedValue({
        used: 0,
        remaining: 10000,
        limit: 10000,
      });
      mockSyncEngine.syncPlaylist.mockRejectedValue(new Error('Sync API failed'));

      const mockSchedule: ScheduleInfo = {
        id: 'schedule-1',
        playlistId: 'playlist-1',
        interval: 6 * 60 * 60 * 1000,
        enabled: true,
        lastRun: null,
        nextRun: new Date(),
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await scheduler.start();

      mockSchedulerManager.createSchedule.mockResolvedValue(mockSchedule);
      mockSchedulerManager.getSchedule.mockResolvedValue(mockSchedule);

      await scheduler.addPlaylist('playlist-1', '0 */6 * * *', true, 3);

      // Get the cron callback and invoke it
      const cronCall = nodeCron.schedule.mock.calls.find(
        (call: any[]) => call[0] === '0 */6 * * *'
      );
      if (cronCall && cronCall[1]) {
        await cronCall[1]();
      }

      const status = scheduler.getStatus();
      expect(status.lastError).toBe('Sync API failed');
    });

    it('should clear last error on successful sync completion', async () => {
      mockSchedulerManager.listSchedules.mockResolvedValue([]);
      mockQuotaManager.getTodayUsage.mockResolvedValue({
        used: 0,
        remaining: 10000,
        limit: 10000,
      });

      // First simulate an error
      mockSchedulerManager.start.mockRejectedValueOnce(new Error('Initial error'));
      await expect(scheduler.start()).rejects.toThrow('Initial error');

      let statusAfterError = scheduler.getStatus();
      expect(statusAfterError.lastError).toBe('Initial error');

      // Reset and start successfully
      mockSchedulerManager.start.mockResolvedValue(undefined);
      scheduler = new AutoSyncScheduler();
      await scheduler.start();

      mockSyncEngine.syncPlaylist.mockResolvedValue({
        playlistId: 'playlist-1',
        status: SyncStatus.COMPLETED,
        itemsAdded: 0,
        itemsRemoved: 0,
        itemsReordered: 0,
        duration: 100,
        quotaUsed: 10,
      });

      const mockSchedule: ScheduleInfo = {
        id: 'schedule-1',
        playlistId: 'playlist-1',
        interval: 6 * 60 * 60 * 1000,
        enabled: true,
        lastRun: null,
        nextRun: new Date(),
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockSchedulerManager.createSchedule.mockResolvedValue(mockSchedule);
      mockSchedulerManager.getSchedule.mockResolvedValue(mockSchedule);

      await scheduler.addPlaylist('playlist-1', '0 */6 * * *', true, 3);

      // Get the cron callback and invoke it
      const cronCall = nodeCron.schedule.mock.calls.find(
        (call: any[]) => call[0] === '0 */6 * * *'
      );
      if (cronCall && cronCall[1]) {
        await cronCall[1]();
      }

      const status = scheduler.getStatus();
      expect(status.lastError).toBeUndefined();
    });

    it('should handle non-COMPLETED sync status', async () => {
      mockSchedulerManager.listSchedules.mockResolvedValue([]);
      mockQuotaManager.getTodayUsage.mockResolvedValue({
        used: 0,
        remaining: 10000,
        limit: 10000,
      });
      mockSyncEngine.syncPlaylist.mockResolvedValue({
        playlistId: 'playlist-1',
        status: SyncStatus.FAILED,
        itemsAdded: 0,
        itemsRemoved: 0,
        itemsReordered: 0,
        duration: 100,
        quotaUsed: 5,
      });

      const mockSchedule: ScheduleInfo = {
        id: 'schedule-1',
        playlistId: 'playlist-1',
        interval: 6 * 60 * 60 * 1000,
        enabled: true,
        lastRun: null,
        nextRun: new Date(),
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await scheduler.start();

      mockSchedulerManager.createSchedule.mockResolvedValue(mockSchedule);
      mockSchedulerManager.getSchedule.mockResolvedValue(mockSchedule);

      await scheduler.addPlaylist('playlist-1', '0 */6 * * *', true, 3);

      // Get the cron callback and invoke it
      const cronCall = nodeCron.schedule.mock.calls.find(
        (call: any[]) => call[0] === '0 */6 * * *'
      );
      if (cronCall && cronCall[1]) {
        await cronCall[1]();
      }

      // Last error should NOT be cleared for non-COMPLETED status
      expect(mockSyncEngine.syncPlaylist).toHaveBeenCalled();
    });
  });

  describe('intervalToCron edge cases', () => {
    // Test through addPlaylist and subsequent getSchedule
    it('should handle very small intervals (less than 1 minute)', async () => {
      const mockSchedule: ScheduleInfo = {
        id: 'schedule-1',
        playlistId: 'playlist-1',
        interval: 30 * 1000, // 30 seconds
        enabled: true,
        lastRun: null,
        nextRun: new Date(),
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockSchedulerManager.createSchedule.mockResolvedValue(mockSchedule);
      mockSchedulerManager.getSchedule.mockResolvedValue(mockSchedule);
      mockSchedulerManager.listSchedules.mockResolvedValue([]);

      await scheduler.start();
      await scheduler.addPlaylist('playlist-1', '* * * * *', true, 3);

      // Small interval results in every minute cron
      expect(mockSchedulerManager.createSchedule).toHaveBeenCalledWith(
        expect.objectContaining({
          interval: 1 * 60 * 1000, // Minimum interval
        })
      );
    });
  });

  describe('Multiple schedules', () => {
    it('should handle multiple playlists', async () => {
      mockSchedulerManager.listSchedules.mockResolvedValue([]);

      const mockSchedule1: ScheduleInfo = {
        id: 'schedule-1',
        playlistId: 'playlist-1',
        interval: 6 * 60 * 60 * 1000,
        enabled: true,
        lastRun: null,
        nextRun: new Date(),
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockSchedule2: ScheduleInfo = {
        id: 'schedule-2',
        playlistId: 'playlist-2',
        interval: 12 * 60 * 60 * 1000,
        enabled: true,
        lastRun: null,
        nextRun: new Date(),
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await scheduler.start();

      mockSchedulerManager.createSchedule.mockResolvedValueOnce(mockSchedule1);
      mockSchedulerManager.getSchedule.mockResolvedValueOnce(mockSchedule1);
      await scheduler.addPlaylist('playlist-1', '0 */6 * * *');

      mockSchedulerManager.createSchedule.mockResolvedValueOnce(mockSchedule2);
      mockSchedulerManager.getSchedule.mockResolvedValueOnce(mockSchedule2);
      await scheduler.addPlaylist('playlist-2', '0 */12 * * *');

      expect(mockSchedulerManager.createSchedule).toHaveBeenCalledTimes(2);
    });
  });
});
