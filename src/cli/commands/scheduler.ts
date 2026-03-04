/**
 * Scheduler CLI Commands
 *
 * Command-line interface for auto-sync scheduler management:
 * - scheduler start: Start the auto-sync scheduler daemon
 * - scheduler stop: Stop the scheduler
 * - scheduler status: Show scheduler status and active schedules
 * - scheduler add: Add playlist to auto-sync schedule
 * - scheduler remove: Remove playlist from schedule
 * - scheduler list: List all schedules
 */

import { Command } from 'commander';
import { getAutoSyncScheduler } from '../../modules/scheduler/auto-sync';
import { getSchedulerManager } from '../../modules/scheduler/manager';
import { getPlaylistManager } from '../../modules/playlist/manager';

/**
 * Register scheduler commands with commander program
 */
export function registerSchedulerCommands(program: Command): void {
  const schedulerCmd = program.command('scheduler').description('Manage auto-sync scheduler');

  /**
   * Start scheduler daemon
   */
  schedulerCmd
    .command('start')
    .description('Start the auto-sync scheduler daemon')
    .action(async () => {
      try {
        console.log('🚀 Starting auto-sync scheduler...\n');

        const scheduler = getAutoSyncScheduler();
        await scheduler.start();

        const status = scheduler.getStatus();

        console.log('✅ Scheduler started successfully');
        console.log(`   Active schedules: ${status.activeSchedules}`);

        if (status.activeSchedules === 0) {
          console.log('\n💡 No schedules found. Add playlists with:');
          console.log('   yt-sync scheduler add <playlist-id> <cron-expression>');
        } else {
          console.log('\n📋 Scheduled playlists:');

          const schedulerManager = getSchedulerManager();
          const schedules = await schedulerManager.listSchedules(true);

          for (const schedule of schedules) {
            console.log(`   • ${schedule.playlistId}`);
            console.log(`     Interval: ${formatInterval(schedule.interval)}`);
            console.log(`     Next run: ${schedule.nextRun.toLocaleString()}`);
          }
        }

        console.log('\n🔄 Scheduler is now running...');
        console.log('   Press Ctrl+C to stop');

        // Keep process alive
        await new Promise<void>((resolve) => {
          process.on('SIGINT', () => {
            void (async () => {
              console.log('\n\n⏹️  Stopping scheduler...');
              await scheduler.stop();
              console.log('✅ Scheduler stopped');
              resolve();
            })();
          });

          process.on('SIGTERM', () => {
            void (async () => {
              console.log('\n\n⏹️  Stopping scheduler...');
              await scheduler.stop();
              console.log('✅ Scheduler stopped');
              resolve();
            })();
          });
        });
      } catch (error) {
        console.error(
          '❌ Failed to start scheduler:',
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
      }
    });

  /**
   * Stop scheduler
   */
  schedulerCmd
    .command('stop')
    .description('Stop the auto-sync scheduler')
    .action(async () => {
      try {
        console.log('⏹️  Stopping auto-sync scheduler...');

        const scheduler = getAutoSyncScheduler();
        const status = scheduler.getStatus();

        if (!status.running) {
          console.log('⚠️  Scheduler is not running');
          return;
        }

        await scheduler.stop();

        console.log('✅ Scheduler stopped successfully');
      } catch (error) {
        console.error(
          '❌ Failed to stop scheduler:',
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
      }
    });

  /**
   * Show scheduler status
   */
  schedulerCmd
    .command('status')
    .description('Show scheduler status and active schedules')
    .action(async () => {
      try {
        console.log('📊 Checking scheduler status...\n');

        const scheduler = getAutoSyncScheduler();
        const status = scheduler.getStatus();

        console.log('═══════════════════════════════════════════');
        console.log('      ⏰ SCHEDULER STATUS ⏰      ');
        console.log('═══════════════════════════════════════════\n');

        console.log(`Status: ${status.running ? '🟢 Running' : '🔴 Stopped'}`);
        console.log(`Active schedules: ${status.activeSchedules}`);
        console.log(`Running jobs: ${status.runningJobs.length}`);

        if (status.running) {
          const uptimeSeconds = Math.floor(status.uptime / 1000);
          const uptimeMinutes = Math.floor(uptimeSeconds / 60);
          const uptimeHours = Math.floor(uptimeMinutes / 60);
          console.log(`Uptime: ${uptimeHours}h ${uptimeMinutes % 60}m ${uptimeSeconds % 60}s`);
        }

        if (status.lastError) {
          console.log(`\n⚠️  Last error: ${status.lastError}`);
        }

        if (status.runningJobs.length > 0) {
          console.log('\n🔄 Currently syncing:');
          for (const jobId of status.runningJobs) {
            console.log(`   • ${jobId}`);
          }
        }

        // Show all schedules
        const schedulerManager = getSchedulerManager();
        const schedules = await schedulerManager.listSchedules();

        if (schedules.length > 0) {
          console.log(`\n📋 Configured schedules (${schedules.length}):\n`);

          for (const schedule of schedules) {
            const statusIcon = schedule.enabled ? '✅' : '⏸️';
            console.log(`${statusIcon} ${schedule.playlistId}`);
            console.log(`   Interval: ${formatInterval(schedule.interval)}`);
            console.log(
              `   Last run: ${schedule.lastRun ? schedule.lastRun.toLocaleString() : 'Never'}`
            );
            console.log(`   Next run: ${schedule.nextRun.toLocaleString()}`);
            console.log(`   Retries: ${schedule.retryCount}/${schedule.maxRetries}`);
            console.log('');
          }
        } else {
          console.log('\n📭 No schedules configured');
          console.log('\n💡 Add a schedule with:');
          console.log('   yt-sync scheduler add <playlist-id> <cron-expression>');
        }

        console.log('═══════════════════════════════════════════\n');
      } catch (error) {
        console.error(
          '❌ Failed to get scheduler status:',
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
      }
    });

  /**
   * Add playlist to schedule
   */
  schedulerCmd
    .command('add')
    .description('Add playlist to auto-sync schedule')
    .argument('<playlist-id>', 'Playlist ID (database ID or YouTube ID)')
    .argument('<cron-expression>', 'Cron expression (e.g., "0 */6 * * *" for every 6 hours)')
    .option('--disabled', 'Create schedule in disabled state')
    .option('--max-retries <n>', 'Maximum retry attempts on failure', '3')
    .action(
      async (
        playlistId: string,
        cronExpression: string,
        options: { disabled?: boolean; maxRetries?: string }
      ) => {
        try {
          console.log(`➕ Adding playlist to auto-sync schedule...\n`);

          // Validate playlist exists
          const playlistManager = getPlaylistManager();
          let playlist;

          try {
            playlist = await playlistManager.getPlaylist(playlistId);
          } catch {
            // Try as YouTube ID
            const { playlists } = await playlistManager.listPlaylists({ filter: playlistId });

            if (playlists.length === 0) {
              throw new Error(`Playlist not found: ${playlistId}`);
            }

            // playlists.length > 0 is guaranteed by the check above
            const foundPlaylist = playlists[0];
            if (!foundPlaylist) throw new Error(`Playlist not found: ${playlistId}`);
            playlist = foundPlaylist;
            playlistId = playlist.id;
          }

          // Add to schedule
          const scheduler = getAutoSyncScheduler();
          const schedule = await scheduler.addPlaylist(
            playlistId,
            cronExpression,
            !options.disabled,
            parseInt(options.maxRetries ?? '3', 10)
          );

          console.log('✅ Playlist added to schedule successfully\n');
          console.log(`   Playlist: ${playlist?.title}`);
          console.log(`   Playlist ID: ${schedule.playlistId}`);
          console.log(`   Cron expression: ${cronExpression}`);
          console.log(`   Interval: ${formatInterval(schedule.interval)}`);
          console.log(`   Enabled: ${schedule.enabled ? 'Yes' : 'No'}`);
          console.log(`   Next run: ${schedule.nextRun.toLocaleString()}`);
          console.log(`   Max retries: ${schedule.maxRetries}`);

          if (!options.disabled) {
            console.log('\n💡 Start the scheduler with:');
            console.log('   yt-sync scheduler start');
          }
        } catch (error) {
          console.error(
            '❌ Failed to add playlist to schedule:',
            error instanceof Error ? error.message : String(error)
          );
          process.exit(1);
        }
      }
    );

  /**
   * Remove playlist from schedule
   */
  schedulerCmd
    .command('remove')
    .description('Remove playlist from auto-sync schedule')
    .argument('<playlist-id>', 'Playlist ID')
    .action(async (playlistId: string) => {
      try {
        console.log(`➖ Removing playlist from auto-sync schedule...\n`);

        const scheduler = getAutoSyncScheduler();
        await scheduler.removePlaylist(playlistId);

        console.log('✅ Playlist removed from schedule successfully');
        console.log(`   Playlist ID: ${playlistId}`);
      } catch (error) {
        console.error(
          '❌ Failed to remove playlist from schedule:',
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
      }
    });

  /**
   * List all schedules
   */
  schedulerCmd
    .command('list')
    .description('List all auto-sync schedules')
    .option('--enabled-only', 'Show only enabled schedules')
    .action(async (options: { enabledOnly?: boolean }) => {
      try {
        const schedulerManager = getSchedulerManager();
        const schedules = await schedulerManager.listSchedules(options.enabledOnly);

        if (schedules.length === 0) {
          console.log('📭 No schedules found\n');
          console.log('💡 Add a schedule with:');
          console.log('   yt-sync scheduler add <playlist-id> <cron-expression>');
          return;
        }

        console.log(`\n📋 Auto-sync schedules (${schedules.length}):\n`);

        for (const schedule of schedules) {
          const statusIcon = schedule.enabled ? '✅' : '⏸️';

          // Get playlist info
          const playlistManager = getPlaylistManager();
          let playlistTitle = schedule.playlistId;

          try {
            const playlist = await playlistManager.getPlaylist(schedule.playlistId);
            playlistTitle = playlist.title ?? schedule.playlistId;
          } catch {
            // Keep playlistId as title if fetch fails
          }

          console.log(`${statusIcon} ${playlistTitle}`);
          console.log(`   ID: ${schedule.playlistId}`);
          console.log(`   Interval: ${formatInterval(schedule.interval)}`);
          console.log(
            `   Last run: ${schedule.lastRun ? schedule.lastRun.toLocaleString() : 'Never'}`
          );
          console.log(`   Next run: ${schedule.nextRun.toLocaleString()}`);
          console.log(`   Status: ${schedule.enabled ? 'Enabled' : 'Disabled'}`);
          console.log(`   Retries: ${schedule.retryCount}/${schedule.maxRetries}`);
          console.log('');
        }
      } catch (error) {
        console.error(
          '❌ Failed to list schedules:',
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
      }
    });
}

/**
 * Helper function to format interval in human-readable format
 */
function formatInterval(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days} day${days > 1 ? 's' : ''}`;
  } else if (hours > 0) {
    return `${hours} hour${hours > 1 ? 's' : ''}`;
  } else if (minutes > 0) {
    return `${minutes} minute${minutes > 1 ? 's' : ''}`;
  } else {
    return `${seconds} second${seconds > 1 ? 's' : ''}`;
  }
}
