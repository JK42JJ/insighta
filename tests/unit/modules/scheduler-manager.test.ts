/**
 * SchedulerManager Unit Tests
 *
 * Tests for SchedulerManager implementation including:
 * - Scheduler lifecycle (start/stop)
 * - Schedule CRUD operations
 * - Cron job management
 * - Sync job execution
 * - Retry logic
 * - Interval to cron conversion
 */

// Mock node-cron
jest.mock('node-cron', () => ({
  schedule: jest.fn(),
}));

import { SchedulerManager, ScheduleConfig } from '../../../src/modules/scheduler/manager';
import * as nodeCron from 'node-cron';

const mockSchedule = nodeCron.schedule as jest.MockedFunction<typeof nodeCron.schedule>;
const mockStop = jest.fn();
const mockCronTask = {
  stop: mockStop,
} as any;

// Mock database - create singleton mock instance
const mockDb = {
  syncSchedule: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

jest.mock('../../../src/modules/database', () => ({
  getPrismaClient: jest.fn(() => mockDb),
}));

// Mock sync engine
jest.mock('../../../src/modules/sync/engine', () => ({
  SyncEngine: jest.fn().mockImplementation(() => ({
    syncPlaylist: jest.fn(),
  })),
}));

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { logger } from '../../../src/utils/logger';

describe('SchedulerManager', () => {
  let schedulerManager: SchedulerManager;
  let mockSyncEngine: any;

  beforeEach(() => {
    jest.clearAllMocks();

    schedulerManager = new SchedulerManager();
    mockSyncEngine = (schedulerManager as any).syncEngine;

    mockSchedule.mockReturnValue(mockCronTask);
  });

  describe('start', () => {
    it('should start scheduler and load enabled schedules', async () => {
      const mockSchedules = [
        {
          playlistId: 'playlist-1',
          interval: 3600000,
          enabled: true,
        },
        {
          playlistId: 'playlist-2',
          interval: 7200000,
          enabled: true,
        },
      ];

      mockDb.syncSchedule.findMany.mockResolvedValue(mockSchedules);
      mockDb.syncSchedule.findUnique
        .mockResolvedValueOnce({ ...mockSchedules[0], id: 'sched-1' })
        .mockResolvedValueOnce({ ...mockSchedules[1], id: 'sched-2' });

      await schedulerManager.start();

      expect(mockDb.syncSchedule.findMany).toHaveBeenCalledWith({
        where: { enabled: true },
      });
      expect(mockSchedule).toHaveBeenCalledTimes(2);
      expect(logger.info).toHaveBeenCalledWith('Scheduler started', { scheduleCount: 2 });
    });

    it('should not start if already running', async () => {
      mockDb.syncSchedule.findMany.mockResolvedValue([]);

      await schedulerManager.start();
      await schedulerManager.start();

      expect(logger.warn).toHaveBeenCalledWith('Scheduler already running');
    });

    it('should handle empty schedules', async () => {
      mockDb.syncSchedule.findMany.mockResolvedValue([]);

      await schedulerManager.start();

      expect(logger.info).toHaveBeenCalledWith('Scheduler started', { scheduleCount: 0 });
    });
  });

  describe('stop', () => {
    it('should stop all cron jobs', async () => {
      const mockSchedules = [
        {
          id: 'sched-1',
          playlistId: 'playlist-1',
          interval: 3600000,
          enabled: true,
        },
      ];

      mockDb.syncSchedule.findMany.mockResolvedValue(mockSchedules);
      mockDb.syncSchedule.findUnique.mockResolvedValue(mockSchedules[0]);

      await schedulerManager.start();
      await schedulerManager.stop();

      expect(mockStop).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('Scheduler stopped');
    });

    it('should not stop if not running', async () => {
      await schedulerManager.stop();

      expect(logger.warn).toHaveBeenCalledWith('Scheduler not running');
    });
  });

  describe('createSchedule', () => {
    it('should create new schedule', async () => {
      const config: ScheduleConfig = {
        playlistId: 'playlist-1',
        interval: 3600000,
        enabled: true,
        maxRetries: 3,
      };

      const mockSchedule = {
        id: 'sched-1',
        playlistId: 'playlist-1',
        interval: 3600000,
        enabled: true,
        nextRun: expect.any(Date),
        lastRun: null,
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDb.syncSchedule.findUnique.mockResolvedValue(null);
      mockDb.syncSchedule.create.mockResolvedValue(mockSchedule);

      const result = await schedulerManager.createSchedule(config);

      expect(mockDb.syncSchedule.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            playlistId: 'playlist-1',
            interval: 3600000,
            enabled: true,
            maxRetries: 3,
          }),
        })
      );

      expect(result.playlistId).toBe('playlist-1');
    });

    it('should throw error when schedule already exists', async () => {
      const config: ScheduleConfig = {
        playlistId: 'playlist-1',
        interval: 3600000,
      };

      mockDb.syncSchedule.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(schedulerManager.createSchedule(config)).rejects.toThrow(
        'Schedule already exists for playlist playlist-1'
      );
    });

    it('should use default values for optional fields', async () => {
      const config: ScheduleConfig = {
        playlistId: 'playlist-1',
        interval: 3600000,
      };

      mockDb.syncSchedule.findUnique.mockResolvedValue(null);
      mockDb.syncSchedule.create.mockResolvedValue({
        id: 'sched-1',
        ...config,
        enabled: true,
        maxRetries: 3,
        nextRun: new Date(),
        lastRun: null,
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await schedulerManager.createSchedule(config);

      expect(mockDb.syncSchedule.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            enabled: true,
            maxRetries: 3,
          }),
        })
      );
    });

    it('should start cron job if scheduler is running and schedule is enabled', async () => {
      const config: ScheduleConfig = {
        playlistId: 'playlist-1',
        interval: 3600000,
        enabled: true,
      };

      const mockSchedule = {
        id: 'sched-1',
        playlistId: 'playlist-1',
        interval: 3600000,
        enabled: true,
        nextRun: new Date(),
        lastRun: null,
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDb.syncSchedule.findMany.mockResolvedValue([]);
      mockDb.syncSchedule.create.mockResolvedValue(mockSchedule);

      await schedulerManager.start();

      // First call (existence check in createSchedule) returns null, second call (startSchedule) returns the schedule
      mockDb.syncSchedule.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockSchedule);

      await schedulerManager.createSchedule(config);

      expect(nodeCron.schedule).toHaveBeenCalled();
    });
  });

  describe('updateSchedule', () => {
    it('should update schedule interval', async () => {
      const existing = {
        id: 'sched-1',
        playlistId: 'playlist-1',
        interval: 3600000,
        enabled: true,
        nextRun: new Date(),
        lastRun: null,
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDb.syncSchedule.findUnique.mockResolvedValue(existing);
      mockDb.syncSchedule.update.mockResolvedValue({
        ...existing,
        interval: 7200000,
      });

      await schedulerManager.updateSchedule('playlist-1', { interval: 7200000 });

      expect(mockDb.syncSchedule.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { playlistId: 'playlist-1' },
          data: expect.objectContaining({
            interval: 7200000,
          }),
        })
      );
    });

    it('should throw error when schedule not found', async () => {
      mockDb.syncSchedule.findUnique.mockResolvedValue(null);

      await expect(
        schedulerManager.updateSchedule('playlist-1', { interval: 7200000 })
      ).rejects.toThrow('Schedule not found for playlist playlist-1');
    });

    it('should restart cron job if scheduler is running', async () => {
      const existing = {
        id: 'sched-1',
        playlistId: 'playlist-1',
        interval: 3600000,
        enabled: true,
        nextRun: new Date(),
        lastRun: null,
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Start scheduler with existing schedule to create a cron job
      mockDb.syncSchedule.findMany.mockResolvedValue([existing]);
      mockDb.syncSchedule.findUnique.mockResolvedValue(existing);
      mockDb.syncSchedule.update.mockResolvedValue(existing);

      await schedulerManager.start();

      // Clear the mock to reset call count, but keep the setup
      jest.clearAllMocks();
      mockSchedule.mockReturnValue(mockCronTask);

      // findUnique will be called twice: once in updateSchedule, once in startSchedule
      mockDb.syncSchedule.findUnique.mockResolvedValue(existing);
      mockDb.syncSchedule.update.mockResolvedValue(existing);

      await schedulerManager.updateSchedule('playlist-1', { enabled: true });

      expect(mockStop).toHaveBeenCalled();
    });
  });

  describe('deleteSchedule', () => {
    it('should delete schedule', async () => {
      mockDb.syncSchedule.delete.mockResolvedValue({});

      await schedulerManager.deleteSchedule('playlist-1');

      expect(mockDb.syncSchedule.delete).toHaveBeenCalledWith({
        where: { playlistId: 'playlist-1' },
      });
      expect(logger.info).toHaveBeenCalledWith('Schedule deleted', { playlistId: 'playlist-1' });
    });

    it('should stop cron job before deleting', async () => {
      mockDb.syncSchedule.findMany.mockResolvedValue([
        {
          id: 'sched-1',
          playlistId: 'playlist-1',
          interval: 3600000,
          enabled: true,
        },
      ]);
      mockDb.syncSchedule.findUnique.mockResolvedValue({
        id: 'sched-1',
        playlistId: 'playlist-1',
        enabled: true,
        interval: 3600000,
      });
      mockDb.syncSchedule.delete.mockResolvedValue({});

      await schedulerManager.start();
      await schedulerManager.deleteSchedule('playlist-1');

      expect(mockStop).toHaveBeenCalled();
    });
  });

  describe('getSchedule', () => {
    it('should return schedule info', async () => {
      const mockSchedule = {
        id: 'sched-1',
        playlistId: 'playlist-1',
        interval: 3600000,
        enabled: true,
        nextRun: new Date(),
        lastRun: null,
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDb.syncSchedule.findUnique.mockResolvedValue(mockSchedule);

      const result = await schedulerManager.getSchedule('playlist-1');

      expect(result).toMatchObject({
        playlistId: 'playlist-1',
        interval: 3600000,
        enabled: true,
      });
    });

    it('should return null when schedule not found', async () => {
      mockDb.syncSchedule.findUnique.mockResolvedValue(null);

      const result = await schedulerManager.getSchedule('playlist-1');

      expect(result).toBeNull();
    });
  });

  describe('listSchedules', () => {
    it('should list all schedules', async () => {
      const mockSchedules = [
        {
          id: 'sched-1',
          playlistId: 'playlist-1',
          interval: 3600000,
          enabled: true,
          nextRun: new Date(),
          lastRun: null,
          retryCount: 0,
          maxRetries: 3,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockDb.syncSchedule.findMany.mockResolvedValue(mockSchedules);

      const result = await schedulerManager.listSchedules();

      expect(result).toHaveLength(1);
      expect(result[0]!.playlistId).toBe('playlist-1');
    });

    it('should list only enabled schedules when flag is set', async () => {
      mockDb.syncSchedule.findMany.mockResolvedValue([]);

      await schedulerManager.listSchedules(true);

      expect(mockDb.syncSchedule.findMany).toHaveBeenCalledWith({
        where: { enabled: true },
        orderBy: { nextRun: 'asc' },
      });
    });
  });

  describe('enableSchedule', () => {
    it('should enable schedule', async () => {
      const mockSchedule = {
        id: 'sched-1',
        playlistId: 'playlist-1',
        interval: 3600000,
        enabled: false,
        nextRun: new Date(),
        lastRun: null,
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDb.syncSchedule.findUnique.mockResolvedValue(mockSchedule);
      mockDb.syncSchedule.update.mockResolvedValue({ ...mockSchedule, enabled: true });

      await schedulerManager.enableSchedule('playlist-1');

      expect(mockDb.syncSchedule.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ enabled: true }),
        })
      );
    });
  });

  describe('disableSchedule', () => {
    it('should disable schedule', async () => {
      const mockSchedule = {
        id: 'sched-1',
        playlistId: 'playlist-1',
        interval: 3600000,
        enabled: true,
        nextRun: new Date(),
        lastRun: null,
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDb.syncSchedule.findUnique.mockResolvedValue(mockSchedule);
      mockDb.syncSchedule.update.mockResolvedValue({ ...mockSchedule, enabled: false });

      await schedulerManager.disableSchedule('playlist-1');

      expect(mockDb.syncSchedule.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ enabled: false }),
        })
      );
    });
  });

  describe('intervalToCron', () => {
    it('should convert minutes to cron expression', () => {
      const scheduler = schedulerManager as any;

      // Less than 1 minute
      expect(scheduler.intervalToCron(30000)).toBe('* * * * *');

      // Every 5 minutes
      expect(scheduler.intervalToCron(300000)).toBe('*/5 * * * *');

      // Every 30 minutes
      expect(scheduler.intervalToCron(1800000)).toBe('*/30 * * * *');
    });

    it('should convert hours to cron expression', () => {
      const scheduler = schedulerManager as any;

      // Every 1 hour
      expect(scheduler.intervalToCron(3600000)).toBe('0 */1 * * *');

      // Every 6 hours
      expect(scheduler.intervalToCron(21600000)).toBe('0 */6 * * *');

      // Every 12 hours
      expect(scheduler.intervalToCron(43200000)).toBe('0 */12 * * *');
    });

    it('should convert days to cron expression', () => {
      const scheduler = schedulerManager as any;

      // Every 1 day
      expect(scheduler.intervalToCron(86400000)).toBe('0 0 */1 * *');

      // Every 7 days
      expect(scheduler.intervalToCron(604800000)).toBe('0 0 */7 * *');
    });
  });

  describe('executeSyncJob', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should execute sync and update schedule on success', async () => {
      const mockSchedule = {
        id: 'sched-1',
        playlistId: 'playlist-1',
        interval: 3600000,
        enabled: true,
        retryCount: 0,
        maxRetries: 3,
      };

      mockDb.syncSchedule.findUnique.mockResolvedValue(mockSchedule);
      mockDb.syncSchedule.update.mockResolvedValue({});
      mockSyncEngine.syncPlaylist.mockResolvedValue({ success: true });

      const executeSyncJob = (schedulerManager as any).executeSyncJob.bind(schedulerManager);
      await executeSyncJob('playlist-1');

      expect(mockSyncEngine.syncPlaylist).toHaveBeenCalledWith('playlist-1');
      expect(mockDb.syncSchedule.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            retryCount: 0,
          }),
        })
      );
    });

    it('should increment retry count on failure', async () => {
      const mockSchedule = {
        id: 'sched-1',
        playlistId: 'playlist-1',
        interval: 3600000,
        enabled: true,
        retryCount: 0,
        maxRetries: 3,
      };

      mockDb.syncSchedule.findUnique.mockResolvedValue(mockSchedule);
      mockDb.syncSchedule.update.mockResolvedValue({});
      mockSyncEngine.syncPlaylist.mockRejectedValue(new Error('Sync failed'));

      const executeSyncJob = (schedulerManager as any).executeSyncJob.bind(schedulerManager);
      await executeSyncJob('playlist-1');

      expect(mockDb.syncSchedule.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            retryCount: 1,
          }),
        })
      );
    });

    it('should disable schedule when max retries exceeded', async () => {
      const mockSchedule = {
        id: 'sched-1',
        playlistId: 'playlist-1',
        interval: 3600000,
        enabled: true,
        retryCount: 2,
        maxRetries: 3,
      };

      mockDb.syncSchedule.findUnique.mockResolvedValue(mockSchedule);
      mockDb.syncSchedule.update.mockResolvedValue({ ...mockSchedule, enabled: false });
      mockSyncEngine.syncPlaylist.mockRejectedValue(new Error('Sync failed'));

      const executeSyncJob = (schedulerManager as any).executeSyncJob.bind(schedulerManager);
      await executeSyncJob('playlist-1');

      expect(logger.warn).toHaveBeenCalledWith(
        'Schedule disabled due to max retries',
        { playlistId: 'playlist-1' }
      );
    });

    it('should skip sync when schedule is disabled', async () => {
      mockDb.syncSchedule.findUnique.mockResolvedValue({ enabled: false });

      const executeSyncJob = (schedulerManager as any).executeSyncJob.bind(schedulerManager);
      await executeSyncJob('playlist-1');

      expect(mockSyncEngine.syncPlaylist).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith('Schedule disabled or not found', {
        playlistId: 'playlist-1',
      });
    });
  });
});
