/**
 * Scheduler CLI Commands Unit Tests
 */

// Mock dependencies before imports
const mockGetAutoSyncScheduler = jest.fn();
const mockGetSchedulerManager = jest.fn();
const mockGetPlaylistManager = jest.fn();

jest.mock('../../../../src/modules/scheduler/auto-sync', () => ({
  getAutoSyncScheduler: mockGetAutoSyncScheduler,
}));

jest.mock('../../../../src/modules/scheduler/manager', () => ({
  getSchedulerManager: mockGetSchedulerManager,
}));

jest.mock('../../../../src/modules/playlist/manager', () => ({
  getPlaylistManager: mockGetPlaylistManager,
}));

// Import after mocks
import { registerSchedulerCommands } from '../../../../src/cli/commands/scheduler';
import { Command } from 'commander';

describe('Scheduler CLI Commands', () => {
  let mockScheduler: any;
  let mockSchedulerManager: any;
  let mockPlaylistManager: any;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;
  let program: Command;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock auto-sync scheduler
    mockScheduler = {
      start: jest.fn(),
      stop: jest.fn(),
      getStatus: jest.fn().mockReturnValue({
        running: false,
        activeSchedules: 0,
        runningJobs: [],
        uptime: 0,
        lastError: null,
      }),
      addPlaylist: jest.fn(),
      removePlaylist: jest.fn(),
    };
    mockGetAutoSyncScheduler.mockReturnValue(mockScheduler);

    // Mock scheduler manager
    mockSchedulerManager = {
      listSchedules: jest.fn().mockResolvedValue([]),
    };
    mockGetSchedulerManager.mockReturnValue(mockSchedulerManager);

    // Mock playlist manager
    mockPlaylistManager = {
      getPlaylist: jest.fn(),
      listPlaylists: jest.fn(),
    };
    mockGetPlaylistManager.mockReturnValue(mockPlaylistManager);

    // Mock console methods
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    // Create program
    program = new Command();
    registerSchedulerCommands(program);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  describe('registerSchedulerCommands', () => {
    test('should register scheduler command with subcommands', () => {
      const schedulerCmd = program.commands.find((cmd) => cmd.name() === 'scheduler');
      expect(schedulerCmd).toBeDefined();

      const subcommands = schedulerCmd!.commands.map((cmd) => cmd.name());
      expect(subcommands).toContain('start');
      expect(subcommands).toContain('stop');
      expect(subcommands).toContain('status');
      expect(subcommands).toContain('add');
      expect(subcommands).toContain('remove');
      expect(subcommands).toContain('list');
    });
  });

  describe('start command', () => {
    let originalProcessOn: typeof process.on;
    let signalHandlers: { [key: string]: Function } = {};

    beforeEach(() => {
      originalProcessOn = process.on;
      signalHandlers = {};

      // Mock process.on to capture signal handlers
      (process as any).on = jest.fn((event: string, handler: Function) => {
        signalHandlers[event] = handler;
        return process;
      });
    });

    afterEach(() => {
      process.on = originalProcessOn;
    });

    test('should start scheduler with no active schedules', async () => {
      mockScheduler.getStatus.mockReturnValue({
        running: true,
        activeSchedules: 0,
        runningJobs: [],
        uptime: 0,
        lastError: null,
      });
      mockSchedulerManager.listSchedules.mockResolvedValue([]);

      // Start the command but don't wait for it (it would hang)
      const startPromise = program.parseAsync(['node', 'test', 'scheduler', 'start'], { from: 'node' });

      // Give it time to register signal handlers
      await new Promise(resolve => setTimeout(resolve, 50));

      // Trigger SIGINT to stop the scheduler and resolve the promise
      if (signalHandlers['SIGINT']) {
        await signalHandlers['SIGINT']();
      }

      await startPromise;

      expect(mockScheduler.start).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith('🚀 Starting auto-sync scheduler...\n');
      expect(consoleLogSpy).toHaveBeenCalledWith('✅ Scheduler started successfully');
      expect(consoleLogSpy).toHaveBeenCalledWith('\n💡 No schedules found. Add playlists with:');
    });

    test('should start scheduler with active schedules', async () => {
      mockScheduler.getStatus.mockReturnValue({
        running: true,
        activeSchedules: 2,
        runningJobs: [],
        uptime: 0,
        lastError: null,
      });
      mockSchedulerManager.listSchedules.mockResolvedValue([
        {
          playlistId: 'pl1',
          enabled: true,
          interval: 3600000,
          nextRun: new Date(),
          retryCount: 0,
          maxRetries: 3,
        },
        {
          playlistId: 'pl2',
          enabled: true,
          interval: 7200000,
          nextRun: new Date(),
          retryCount: 0,
          maxRetries: 3,
        },
      ]);

      const startPromise = program.parseAsync(['node', 'test', 'scheduler', 'start'], { from: 'node' });

      await new Promise(resolve => setTimeout(resolve, 50));

      if (signalHandlers['SIGTERM']) {
        await signalHandlers['SIGTERM']();
      }

      await startPromise;

      expect(mockScheduler.start).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith('\n📋 Scheduled playlists:');
      expect(consoleLogSpy).toHaveBeenCalledWith('   • pl1');
      expect(consoleLogSpy).toHaveBeenCalledWith('   • pl2');
    });

    test('should handle start error', async () => {
      mockScheduler.start.mockRejectedValue(new Error('Scheduler init failed'));

      await expect(
        program.parseAsync(['node', 'test', 'scheduler', 'start'], { from: 'node' })
      ).rejects.toThrow('process.exit called');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '❌ Failed to start scheduler:',
        'Scheduler init failed'
      );
    });
  });

  describe('status command', () => {
    test('should display scheduler status', async () => {
      const schedulerCmd = program.commands.find((cmd) => cmd.name() === 'scheduler');
      const statusCmd = schedulerCmd!.commands.find((cmd) => cmd.name() === 'status');

      mockScheduler.getStatus.mockReturnValue({
        running: true,
        activeSchedules: 2,
        runningJobs: [],
        uptime: 3661000, // 1 hour, 1 minute, 1 second
        lastError: null,
      });

      mockSchedulerManager.listSchedules.mockResolvedValue([
        {
          playlistId: 'pl1',
          enabled: true,
          interval: 3600000,
          lastRun: new Date(),
          nextRun: new Date(),
          retryCount: 0,
          maxRetries: 3,
        },
      ]);

      await statusCmd!.parseAsync(['status'], { from: 'user' });

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('SCHEDULER STATUS'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Running'));
    });

    test('should show stopped status', async () => {
      const schedulerCmd = program.commands.find((cmd) => cmd.name() === 'scheduler');
      const statusCmd = schedulerCmd!.commands.find((cmd) => cmd.name() === 'status');

      mockScheduler.getStatus.mockReturnValue({
        running: false,
        activeSchedules: 0,
        runningJobs: [],
        uptime: 0,
        lastError: null,
      });

      await statusCmd!.parseAsync(['status'], { from: 'user' });

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Stopped'));
    });

    test('should display running jobs', async () => {
      const schedulerCmd = program.commands.find((cmd) => cmd.name() === 'scheduler');
      const statusCmd = schedulerCmd!.commands.find((cmd) => cmd.name() === 'status');

      mockScheduler.getStatus.mockReturnValue({
        running: true,
        activeSchedules: 1,
        runningJobs: ['job1', 'job2'],
        uptime: 1000,
        lastError: null,
      });

      await statusCmd!.parseAsync(['status'], { from: 'user' });

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Currently syncing'));
    });

    test('should display last error', async () => {
      const schedulerCmd = program.commands.find((cmd) => cmd.name() === 'scheduler');
      const statusCmd = schedulerCmd!.commands.find((cmd) => cmd.name() === 'status');

      mockScheduler.getStatus.mockReturnValue({
        running: true,
        activeSchedules: 0,
        runningJobs: [],
        uptime: 1000,
        lastError: 'Some error occurred',
      });

      await statusCmd!.parseAsync(['status'], { from: 'user' });

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Some error occurred'));
    });

    test('should show no schedules message', async () => {
      const schedulerCmd = program.commands.find((cmd) => cmd.name() === 'scheduler');
      const statusCmd = schedulerCmd!.commands.find((cmd) => cmd.name() === 'status');

      mockScheduler.getStatus.mockReturnValue({
        running: false,
        activeSchedules: 0,
        runningJobs: [],
        uptime: 0,
        lastError: null,
      });
      mockSchedulerManager.listSchedules.mockResolvedValue([]);

      await statusCmd!.parseAsync(['status'], { from: 'user' });

      expect(consoleLogSpy).toHaveBeenCalledWith('\n📭 No schedules configured');
    });

    test('should handle status error', async () => {
      const schedulerCmd = program.commands.find((cmd) => cmd.name() === 'scheduler');
      const statusCmd = schedulerCmd!.commands.find((cmd) => cmd.name() === 'status');

      mockScheduler.getStatus.mockImplementation(() => {
        throw new Error('Status retrieval failed');
      });

      await expect(
        statusCmd!.parseAsync(['status'], { from: 'user' })
      ).rejects.toThrow('process.exit called');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '❌ Failed to get scheduler status:',
        'Status retrieval failed'
      );
    });
  });

  describe('stop command', () => {
    test('should stop scheduler when running', async () => {
      mockScheduler.getStatus.mockReturnValue({
        running: true,
        activeSchedules: 1,
        runningJobs: [],
        uptime: 1000,
        lastError: null,
      });

      await program.parseAsync(['node', 'test', 'scheduler', 'stop'], { from: 'node' });

      expect(mockScheduler.stop).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith('✅ Scheduler stopped successfully');
    });

    test('should show message when scheduler not running', async () => {
      mockScheduler.getStatus.mockReturnValue({
        running: false,
        activeSchedules: 0,
        runningJobs: [],
        uptime: 0,
        lastError: null,
      });

      await program.parseAsync(['node', 'test', 'scheduler', 'stop'], { from: 'node' });

      expect(mockScheduler.stop).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith('⚠️  Scheduler is not running');
    });

    test('should handle stop error', async () => {
      mockScheduler.getStatus.mockReturnValue({
        running: true,
        activeSchedules: 1,
        runningJobs: [],
        uptime: 1000,
        lastError: null,
      });
      mockScheduler.stop.mockRejectedValue(new Error('Failed to stop'));

      await expect(
        program.parseAsync(['node', 'test', 'scheduler', 'stop'], { from: 'node' })
      ).rejects.toThrow('process.exit called');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '❌ Failed to stop scheduler:',
        'Failed to stop'
      );
    });
  });

  describe('remove command', () => {
    test('should remove playlist from schedule', async () => {
      await program.parseAsync(['node', 'test', 'scheduler', 'remove', 'pl1'], { from: 'node' });

      expect(mockScheduler.removePlaylist).toHaveBeenCalledWith('pl1');
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '✅ Playlist removed from schedule successfully'
      );
    });

    test('should handle remove error', async () => {
      mockScheduler.removePlaylist.mockRejectedValue(new Error('Not found'));

      await expect(
        program.parseAsync(['node', 'test', 'scheduler', 'remove', 'pl1'], { from: 'node' })
      ).rejects.toThrow('process.exit called');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '❌ Failed to remove playlist from schedule:',
        'Not found'
      );
    });
  });

  describe('list command', () => {
    test('should list schedules', async () => {
      const schedulerCmd = program.commands.find((cmd) => cmd.name() === 'scheduler');
      const listCmd = schedulerCmd!.commands.find((cmd) => cmd.name() === 'list');

      mockSchedulerManager.listSchedules.mockResolvedValue([
        {
          playlistId: 'pl1',
          enabled: true,
          interval: 3600000, // 1 hour
          lastRun: new Date(),
          nextRun: new Date(),
          retryCount: 0,
          maxRetries: 3,
        },
      ]);

      mockPlaylistManager.getPlaylist.mockResolvedValue({
        id: 'pl1',
        title: 'Test Playlist',
      });

      await listCmd!.parseAsync(['list'], { from: 'user' });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Auto-sync schedules')
      );
    });

    test('should show no schedules message', async () => {
      const schedulerCmd = program.commands.find((cmd) => cmd.name() === 'scheduler');
      const listCmd = schedulerCmd!.commands.find((cmd) => cmd.name() === 'list');

      mockSchedulerManager.listSchedules.mockResolvedValue([]);

      await listCmd!.parseAsync(['list'], { from: 'user' });

      expect(consoleLogSpy).toHaveBeenCalledWith('📭 No schedules found\n');
    });

    test('should handle playlist fetch error gracefully', async () => {
      const schedulerCmd = program.commands.find((cmd) => cmd.name() === 'scheduler');
      const listCmd = schedulerCmd!.commands.find((cmd) => cmd.name() === 'list');

      mockSchedulerManager.listSchedules.mockResolvedValue([
        {
          playlistId: 'pl1',
          enabled: true,
          interval: 86400000, // 1 day
          lastRun: null,
          nextRun: new Date(),
          retryCount: 1,
          maxRetries: 3,
        },
      ]);

      mockPlaylistManager.getPlaylist.mockRejectedValue(new Error('Not found'));

      await listCmd!.parseAsync(['list'], { from: 'user' });

      // Should still display schedule with playlistId as title
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('pl1'));
    });

    test('should filter enabled only', async () => {
      const schedulerCmd = program.commands.find((cmd) => cmd.name() === 'scheduler');
      const listCmd = schedulerCmd!.commands.find((cmd) => cmd.name() === 'list');

      await listCmd!.parseAsync(['list', '--enabled-only'], { from: 'user' });

      expect(mockSchedulerManager.listSchedules).toHaveBeenCalledWith(true);
    });

    test('should handle list error', async () => {
      const schedulerCmd = program.commands.find((cmd) => cmd.name() === 'scheduler');
      const listCmd = schedulerCmd!.commands.find((cmd) => cmd.name() === 'list');

      mockSchedulerManager.listSchedules.mockRejectedValue(new Error('Database error'));

      await expect(
        listCmd!.parseAsync(['list'], { from: 'user' })
      ).rejects.toThrow('process.exit called');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '❌ Failed to list schedules:',
        'Database error'
      );
    });
  });

  describe('add command', () => {
    test('should add playlist to schedule', async () => {
      mockPlaylistManager.getPlaylist.mockResolvedValue({
        id: 'pl1',
        title: 'Test Playlist',
      });

      mockScheduler.addPlaylist.mockResolvedValue({
        playlistId: 'pl1',
        enabled: true,
        interval: 21600000, // 6 hours
        nextRun: new Date(),
        maxRetries: 3,
      });

      await program.parseAsync(['node', 'test', 'scheduler', 'add', 'pl1', '0 */6 * * *'], { from: 'node' });

      expect(mockScheduler.addPlaylist).toHaveBeenCalledWith('pl1', '0 */6 * * *', true, 3);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '✅ Playlist added to schedule successfully\n'
      );
    });

    test('should try youtube ID if database ID fails', async () => {
      mockPlaylistManager.getPlaylist.mockRejectedValue(new Error('Not found'));
      mockPlaylistManager.listPlaylists.mockResolvedValue({
        playlists: [{ id: 'pl1', title: 'Test Playlist' }],
      });

      mockScheduler.addPlaylist.mockResolvedValue({
        playlistId: 'pl1',
        enabled: true,
        interval: 21600000,
        nextRun: new Date(),
        maxRetries: 3,
      });

      await program.parseAsync(['node', 'test', 'scheduler', 'add', 'PLtest123', '0 */6 * * *'], { from: 'node' });

      expect(mockPlaylistManager.listPlaylists).toHaveBeenCalledWith({ filter: 'PLtest123' });
    });

    test('should handle playlist not found', async () => {
      mockPlaylistManager.getPlaylist.mockRejectedValue(new Error('Not found'));
      mockPlaylistManager.listPlaylists.mockResolvedValue({ playlists: [] });

      await expect(
        program.parseAsync(['node', 'test', 'scheduler', 'add', 'nonexistent', '0 */6 * * *'], { from: 'node' })
      ).rejects.toThrow('process.exit called');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '❌ Failed to add playlist to schedule:',
        'Playlist not found: nonexistent'
      );
    });

    test('should add with disabled flag', async () => {
      mockPlaylistManager.getPlaylist.mockResolvedValue({
        id: 'pl1',
        title: 'Test Playlist',
      });

      mockScheduler.addPlaylist.mockResolvedValue({
        playlistId: 'pl1',
        enabled: false,
        interval: 21600000,
        nextRun: new Date(),
        maxRetries: 3,
      });

      await program.parseAsync(['node', 'test', 'scheduler', 'add', 'pl1', '0 */6 * * *', '--disabled'], { from: 'node' });

      expect(mockScheduler.addPlaylist).toHaveBeenCalledWith('pl1', '0 */6 * * *', false, 3);
    });

    test('should add with custom max retries', async () => {
      mockPlaylistManager.getPlaylist.mockResolvedValue({
        id: 'pl1',
        title: 'Test Playlist',
      });

      mockScheduler.addPlaylist.mockResolvedValue({
        playlistId: 'pl1',
        enabled: true,
        interval: 21600000,
        nextRun: new Date(),
        maxRetries: 5,
      });

      await program.parseAsync(['node', 'test', 'scheduler', 'add', 'pl1', '0 */6 * * *', '--max-retries', '5'], { from: 'node' });

      expect(mockScheduler.addPlaylist).toHaveBeenCalledWith('pl1', '0 */6 * * *', true, 5);
    });
  });

  describe('formatInterval helper', () => {
    test('should format days correctly', async () => {
      const schedulerCmd = program.commands.find((cmd) => cmd.name() === 'scheduler');
      const listCmd = schedulerCmd!.commands.find((cmd) => cmd.name() === 'list');

      mockSchedulerManager.listSchedules.mockResolvedValue([
        {
          playlistId: 'pl1',
          enabled: true,
          interval: 172800000, // 2 days
          lastRun: null,
          nextRun: new Date(),
          retryCount: 0,
          maxRetries: 3,
        },
      ]);

      mockPlaylistManager.getPlaylist.mockResolvedValue({
        id: 'pl1',
        title: 'Test Playlist',
      });

      await listCmd!.parseAsync(['list'], { from: 'user' });

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('2 days'));
    });

    test('should format hours correctly', async () => {
      const schedulerCmd = program.commands.find((cmd) => cmd.name() === 'scheduler');
      const listCmd = schedulerCmd!.commands.find((cmd) => cmd.name() === 'list');

      mockSchedulerManager.listSchedules.mockResolvedValue([
        {
          playlistId: 'pl1',
          enabled: true,
          interval: 7200000, // 2 hours
          lastRun: null,
          nextRun: new Date(),
          retryCount: 0,
          maxRetries: 3,
        },
      ]);

      mockPlaylistManager.getPlaylist.mockResolvedValue({
        id: 'pl1',
        title: 'Test Playlist',
      });

      await listCmd!.parseAsync(['list'], { from: 'user' });

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('2 hours'));
    });

    test('should format minutes correctly', async () => {
      const schedulerCmd = program.commands.find((cmd) => cmd.name() === 'scheduler');
      const listCmd = schedulerCmd!.commands.find((cmd) => cmd.name() === 'list');

      mockSchedulerManager.listSchedules.mockResolvedValue([
        {
          playlistId: 'pl1',
          enabled: true,
          interval: 1800000, // 30 minutes
          lastRun: null,
          nextRun: new Date(),
          retryCount: 0,
          maxRetries: 3,
        },
      ]);

      mockPlaylistManager.getPlaylist.mockResolvedValue({
        id: 'pl1',
        title: 'Test Playlist',
      });

      await listCmd!.parseAsync(['list'], { from: 'user' });

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('30 minutes'));
    });

    test('should format seconds correctly', async () => {
      const schedulerCmd = program.commands.find((cmd) => cmd.name() === 'scheduler');
      const listCmd = schedulerCmd!.commands.find((cmd) => cmd.name() === 'list');

      mockSchedulerManager.listSchedules.mockResolvedValue([
        {
          playlistId: 'pl1',
          enabled: true,
          interval: 30000, // 30 seconds
          lastRun: null,
          nextRun: new Date(),
          retryCount: 0,
          maxRetries: 3,
        },
      ]);

      mockPlaylistManager.getPlaylist.mockResolvedValue({
        id: 'pl1',
        title: 'Test Playlist',
      });

      await listCmd!.parseAsync(['list'], { from: 'user' });

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('30 seconds'));
    });
  });
});
