#!/usr/bin/env node

/**
 * CLI entry point for YouTube Playlist Sync
 *
 * Provides command-line interface for:
 * - import: Import a YouTube playlist
 * - sync: Synchronize playlists
 * - list: List synced playlists
 * - info: Show playlist information
 * - quota: Show quota usage
 */

import { Command } from 'commander';
import { VERSION } from '../index';
import { connectDatabase, disconnectDatabase } from '../modules/database/client';
import { getPlaylistManager } from '../modules/playlist/manager';
import { getSyncEngine } from '../modules/sync/engine';
import { getQuotaManager } from '../modules/quota/manager';
import { getSchedulerManager } from '../modules/scheduler/manager';
import { getCacheService } from '../utils/cache';
import { getCaptionExtractor } from '../modules/caption';
import { getSummaryGenerator } from '../modules/summarization';
import { getNoteManager } from '../modules/note';
import { getAnalyticsTracker } from '../modules/analytics';
import { logger } from '../utils/logger';
import { config } from '../config';
import { getYouTubeClient } from '../api';
import { registerAuthCommands } from './commands/auth';
import { registerPlaylistCommands } from './commands/playlists';
import { registerSchedulerCommands } from './commands/scheduler';

const program = new Command();

program
  .name('yt-sync')
  .description('YouTube Playlist Sync CLI')
  .version(VERSION)
  .hook('preAction', async () => {
    await connectDatabase();
  })
  .hook('postAction', async () => {
    await disconnectDatabase();
  });

/**
 * Import command
 */
program
  .command('import')
  .description('Import a YouTube playlist')
  .argument('<url-or-id>', 'Playlist URL or ID')
  .action(async (urlOrId: string) => {
    try {
      const playlistManager = getPlaylistManager();
      const playlist = await playlistManager.importPlaylist(urlOrId);

      console.log('✅ Playlist imported successfully');
      console.log(`   ID: ${playlist.id}`);
      console.log(`   YouTube ID: ${playlist.youtubeId}`);
      console.log(`   Title: ${playlist.title}`);
      console.log(`   Channel: ${playlist.channelTitle}`);
      console.log(`   Items: ${playlist.itemCount}`);
      console.log('\nRun "yt-sync sync" to synchronize the playlist items.');
    } catch (error) {
      console.error('❌ Failed to import playlist:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

/**
 * Sync command
 */
program
  .command('sync')
  .description('Sync a YouTube playlist')
  .argument('[playlist-id]', 'Playlist ID (database or YouTube ID)')
  .option('--all', 'Sync all playlists')
  .action(async (playlistId?: string, options?: { all?: boolean }) => {
    try {
      const syncEngine = getSyncEngine();

      if (options?.all) {
        console.log('🔄 Syncing all playlists...');
        const results = await syncEngine.syncAll();

        console.log('\n📊 Sync Results:');
        for (const result of results) {
          console.log(`\n   Playlist: ${result.playlistId}`);
          console.log(`   Status: ${result.status}`);
          console.log(`   Added: ${result.itemsAdded}`);
          console.log(`   Removed: ${result.itemsRemoved}`);
          console.log(`   Reordered: ${result.itemsReordered}`);
          console.log(`   Duration: ${result.duration}ms`);
          console.log(`   Quota Used: ${result.quotaUsed}`);
          if (result.error) {
            console.log(`   Error: ${result.error}`);
          }
        }
      } else if (playlistId) {
        console.log(`🔄 Syncing playlist ${playlistId}...`);
        const result = await syncEngine.syncPlaylist(playlistId);

        console.log('\n✅ Sync completed');
        console.log(`   Status: ${result.status}`);
        console.log(`   Added: ${result.itemsAdded}`);
        console.log(`   Removed: ${result.itemsRemoved}`);
        console.log(`   Reordered: ${result.itemsReordered}`);
        console.log(`   Duration: ${result.duration}ms`);
        console.log(`   Quota Used: ${result.quotaUsed}`);
      } else {
        console.error('❌ Please specify a playlist ID or use --all flag');
        process.exit(1);
      }
    } catch (error) {
      console.error('❌ Sync failed:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

/**
 * List command
 */
program
  .command('list')
  .description('List synced playlists')
  .option('--filter <term>', 'Filter by term')
  .option('--sort <field>', 'Sort by field (title, lastSyncedAt, createdAt)', 'createdAt')
  .option('--limit <n>', 'Limit number of results', '50')
  .action(async (options: { filter?: string; sort?: string; limit?: string }) => {
    try {
      const playlistManager = getPlaylistManager();
      const { playlists, total } = await playlistManager.listPlaylists({
        filter: options.filter,
        sortBy: options.sort as any,
        limit: parseInt(options.limit ?? '50', 10),
      });

      if (playlists.length === 0) {
        console.log('No playlists found.');
        console.log('\nUse "yt-sync import <url>" to import a playlist.');
        return;
      }

      console.log(`\n📚 Playlists (${playlists.length}/${total}):\n`);

      for (const playlist of playlists) {
        console.log(`   ${playlist.title}`);
        console.log(`   ID: ${playlist.youtubeId}`);
        console.log(`   Channel: ${playlist.channelTitle}`);
        console.log(`   Items: ${playlist.itemCount}`);
        console.log(`   Status: ${playlist.syncStatus}`);
        console.log(`   Last Sync: ${playlist.lastSyncedAt ? playlist.lastSyncedAt.toISOString() : 'Never'}`);
        console.log('');
      }
    } catch (error) {
      console.error('❌ Failed to list playlists:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

/**
 * Info command
 */
program
  .command('info')
  .description('Show playlist information')
  .argument('<playlist-id>', 'Playlist ID')
  .action(async (playlistId: string) => {
    try {
      const playlistManager = getPlaylistManager();
      const playlist = await playlistManager.getPlaylistWithItems(playlistId);
      const stats = await playlistManager.getSyncStats(playlistId);

      console.log('\n📋 Playlist Information:\n');
      console.log(`   Title: ${playlist.title}`);
      console.log(`   YouTube ID: ${playlist.youtubeId}`);
      console.log(`   Channel: ${playlist.channelTitle}`);
      console.log(`   Description: ${playlist.description ?? 'N/A'}`);
      console.log(`   Items: ${playlist.itemCount}`);
      console.log(`   Status: ${playlist.syncStatus}`);
      console.log(`   Last Sync: ${playlist.lastSyncedAt ? playlist.lastSyncedAt.toISOString() : 'Never'}`);

      console.log('\n📊 Sync Statistics:\n');
      console.log(`   Total Syncs: ${stats.totalSyncs}`);
      console.log(`   Successful: ${stats.successfulSyncs}`);
      console.log(`   Failed: ${stats.failedSyncs}`);
      console.log(`   Average Duration: ${stats.averageDuration ? `${stats.averageDuration.toFixed(0)}ms` : 'N/A'}`);

      console.log(`\n📹 Videos (${playlist.items.length}):\n`);
      for (const item of playlist.items.slice(0, 10)) {
        console.log(`   ${item.position + 1}. ${item.video.title}`);
      }

      if (playlist.items.length > 10) {
        console.log(`   ... and ${playlist.items.length - 10} more`);
      }
    } catch (error) {
      console.error('❌ Failed to get playlist info:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

/**
 * Quota command
 */
program
  .command('quota')
  .description('Show API quota usage')
  .option('--days <n>', 'Number of days to show', '7')
  .action(async (options: { days?: string }) => {
    try {
      const quotaManager = getQuotaManager();
      const today = await quotaManager.getTodayUsage();
      const stats = await quotaManager.getUsageStats(parseInt(options.days ?? '7', 10));

      console.log('\n📊 Today\'s Quota Usage:\n');
      console.log(`   Used: ${today.used} / ${today.limit}`);
      console.log(`   Remaining: ${today.remaining}`);
      console.log(`   Percent: ${((today.used / today.limit) * 100).toFixed(2)}%`);

      if (today.used > config.quota.warningThreshold) {
        console.log('\n   ⚠️  Warning: Approaching daily quota limit');
      }

      console.log(`\n📈 Usage History (${stats.length} days):\n`);
      for (const stat of stats) {
        console.log(`   ${stat.date.toISOString().split('T')[0]}: ${stat.used}/${stat.limit} (${stat.percentUsed.toFixed(1)}%)`);
      }
    } catch (error) {
      console.error('❌ Failed to get quota usage:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

/**
 * Schedule commands
 */

// Schedule create
program
  .command('schedule-create')
  .description('Create a sync schedule for a playlist')
  .argument('<playlist-id>', 'Playlist ID')
  .argument('<interval>', 'Sync interval (e.g., 1h, 30m, 1d)')
  .option('--disabled', 'Create schedule in disabled state')
  .option('--max-retries <n>', 'Maximum retry attempts', '3')
  .action(async (playlistId: string, interval: string, options: { disabled?: boolean; maxRetries?: string }) => {
    try {
      const schedulerManager = getSchedulerManager();
      const intervalMs = parseInterval(interval);

      const schedule = await schedulerManager.createSchedule({
        playlistId,
        interval: intervalMs,
        enabled: !options.disabled,
        maxRetries: parseInt(options.maxRetries ?? '3', 10),
      });

      console.log('✅ Schedule created successfully');
      console.log(`   Playlist ID: ${schedule.playlistId}`);
      console.log(`   Interval: ${formatInterval(schedule.interval)}`);
      console.log(`   Enabled: ${schedule.enabled ? 'Yes' : 'No'}`);
      console.log(`   Next Run: ${schedule.nextRun.toISOString()}`);
      console.log(`   Max Retries: ${schedule.maxRetries}`);
    } catch (error) {
      console.error('❌ Failed to create schedule:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// Schedule list
program
  .command('schedule-list')
  .description('List all sync schedules')
  .option('--enabled-only', 'Show only enabled schedules')
  .action(async (options: { enabledOnly?: boolean }) => {
    try {
      const schedulerManager = getSchedulerManager();
      const schedules = await schedulerManager.listSchedules(options.enabledOnly);

      if (schedules.length === 0) {
        console.log('No schedules found.');
        console.log('\nUse "yt-sync schedule-create <playlist-id> <interval>" to create a schedule.');
        return;
      }

      console.log(`\n⏰ Schedules (${schedules.length}):\n`);

      for (const schedule of schedules) {
        console.log(`   Playlist: ${schedule.playlistId}`);
        console.log(`   Interval: ${formatInterval(schedule.interval)}`);
        console.log(`   Enabled: ${schedule.enabled ? 'Yes' : 'No'}`);
        console.log(`   Last Run: ${schedule.lastRun ? schedule.lastRun.toISOString() : 'Never'}`);
        console.log(`   Next Run: ${schedule.nextRun.toISOString()}`);
        console.log(`   Retries: ${schedule.retryCount}/${schedule.maxRetries}`);
        console.log('');
      }
    } catch (error) {
      console.error('❌ Failed to list schedules:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// Schedule update
program
  .command('schedule-update')
  .description('Update a sync schedule')
  .argument('<playlist-id>', 'Playlist ID')
  .option('--interval <value>', 'New sync interval (e.g., 1h, 30m, 1d)')
  .option('--max-retries <n>', 'Maximum retry attempts')
  .action(async (playlistId: string, options: { interval?: string; maxRetries?: string }) => {
    try {
      const schedulerManager = getSchedulerManager();
      const updates: any = {};

      if (options.interval) {
        updates.interval = parseInterval(options.interval);
      }
      if (options.maxRetries) {
        updates.maxRetries = parseInt(options.maxRetries, 10);
      }

      const schedule = await schedulerManager.updateSchedule(playlistId, updates);

      console.log('✅ Schedule updated successfully');
      console.log(`   Playlist ID: ${schedule.playlistId}`);
      console.log(`   Interval: ${formatInterval(schedule.interval)}`);
      console.log(`   Next Run: ${schedule.nextRun.toISOString()}`);
      console.log(`   Max Retries: ${schedule.maxRetries}`);
    } catch (error) {
      console.error('❌ Failed to update schedule:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// Schedule delete
program
  .command('schedule-delete')
  .description('Delete a sync schedule')
  .argument('<playlist-id>', 'Playlist ID')
  .action(async (playlistId: string) => {
    try {
      const schedulerManager = getSchedulerManager();
      await schedulerManager.deleteSchedule(playlistId);

      console.log('✅ Schedule deleted successfully');
    } catch (error) {
      console.error('❌ Failed to delete schedule:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// Schedule enable
program
  .command('schedule-enable')
  .description('Enable a sync schedule')
  .argument('<playlist-id>', 'Playlist ID')
  .action(async (playlistId: string) => {
    try {
      const schedulerManager = getSchedulerManager();
      await schedulerManager.enableSchedule(playlistId);

      console.log('✅ Schedule enabled');
    } catch (error) {
      console.error('❌ Failed to enable schedule:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// Schedule disable
program
  .command('schedule-disable')
  .description('Disable a sync schedule')
  .argument('<playlist-id>', 'Playlist ID')
  .action(async (playlistId: string) => {
    try {
      const schedulerManager = getSchedulerManager();
      await schedulerManager.disableSchedule(playlistId);

      console.log('✅ Schedule disabled');
    } catch (error) {
      console.error('❌ Failed to disable schedule:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// Schedule start
program
  .command('schedule-start')
  .description('Start the sync scheduler daemon')
  .action(async () => {
    try {
      const schedulerManager = getSchedulerManager();
      await schedulerManager.start();

      console.log('✅ Scheduler started');
      console.log('\nPress Ctrl+C to stop the scheduler.');

      // Keep process alive
      await new Promise(() => {});
    } catch (error) {
      console.error('❌ Failed to start scheduler:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// Cache stats
program
  .command('cache-stats')
  .description('Show cache statistics')
  .action(async () => {
    try {
      const cacheService = getCacheService();
      await cacheService.initialize();
      const stats = await cacheService.getStats();

      console.log('\n💾 Cache Statistics:\n');
      console.log(`   Total Files: ${stats.totalFiles}`);
      console.log(`   Total Size: ${stats.totalSizeMB.toFixed(2)} MB`);
      if (stats.oldestFile) {
        console.log(`   Oldest: ${(stats.oldestFile.age / (1000 * 60 * 60)).toFixed(1)} hours ago`);
      }
      if (stats.newestFile) {
        console.log(`   Newest: ${(stats.newestFile.age / (1000 * 60 * 60)).toFixed(1)} hours ago`);
      }
    } catch (error) {
      console.error('❌ Failed to get cache stats:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// Cache clear
program
  .command('cache-clear')
  .description('Clear all cache')
  .action(async () => {
    try {
      const cacheService = getCacheService();
      await cacheService.initialize();
      await cacheService.clear();

      console.log('✅ Cache cleared successfully');
    } catch (error) {
      console.error('❌ Failed to clear cache:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

/**
 * OAuth 2.0 Authentication Commands
 */

// Auth - Start OAuth flow
program
  .command('auth')
  .description('Start OAuth 2.0 authentication flow')
  .action(async () => {
    try {
      console.log('\n🔐 YouTube API OAuth 2.0 Authentication\n');

      if (!config.youtube.clientId || !config.youtube.clientSecret) {
        console.error('❌ OAuth credentials not configured');
        console.error('\nPlease set the following environment variables:');
        console.error('  - YOUTUBE_CLIENT_ID');
        console.error('  - YOUTUBE_CLIENT_SECRET');
        console.error('  - YOUTUBE_REDIRECT_URI (optional, default: http://localhost:3000/oauth2callback)\n');
        process.exit(1);
      }

      const youtubeClient = getYouTubeClient();
      const authUrl = youtubeClient.getAuthUrl();

      console.log('📋 Follow these steps to authenticate:\n');
      console.log('1. Visit the following URL in your browser:');
      console.log(`\n   ${authUrl}\n`);
      console.log('2. Authorize the application');
      console.log('3. Copy the authorization code from the redirect URL');
      console.log('4. Run: yt-sync auth-callback <code>\n');
    } catch (error) {
      console.error('❌ Failed to generate auth URL:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// Auth callback - Exchange code for tokens
program
  .command('auth-callback')
  .description('Complete OAuth authentication with authorization code')
  .argument('<code>', 'Authorization code from OAuth callback')
  .action(async (code: string) => {
    try {
      console.log('\n🔄 Exchanging authorization code for tokens...\n');

      const youtubeClient = getYouTubeClient();
      const tokens = await youtubeClient.getTokensFromCode(code);

      console.log('✅ Authentication successful!\n');
      console.log('📝 Save these tokens securely:\n');

      if (tokens.access_token) {
        console.log('YOUTUBE_ACCESS_TOKEN=');
        console.log(tokens.access_token);
        console.log('');
      }

      if (tokens.refresh_token) {
        console.log('YOUTUBE_REFRESH_TOKEN=');
        console.log(tokens.refresh_token);
        console.log('');
      }

      console.log('⚠️  Add these to your .env file to persist authentication\n');
      console.log('💡 You can now use commands like:');
      console.log('   - yt-sync import <playlist-url>');
      console.log('   - yt-sync sync --all\n');
    } catch (error) {
      console.error('❌ Authentication failed:', error instanceof Error ? error.message : String(error));
      console.error('\nPossible issues:');
      console.error('  - Invalid authorization code');
      console.error('  - Code expired (codes are valid for 10 minutes)');
      console.error('  - Redirect URI mismatch\n');
      process.exit(1);
    }
  });

// Auth status - Check authentication status
program
  .command('auth-status')
  .description('Check current authentication status')
  .action(async () => {
    try {
      console.log('\n🔍 Checking authentication status...\n');

      const hasClientId = !!config.youtube.clientId;
      const hasClientSecret = !!config.youtube.clientSecret;
      const hasApiKey = !!config.youtube.apiKey;
      const redirectUri = config.youtube.redirectUri;

      console.log('═══════════════════════════════════════════');
      console.log('     🔐 AUTHENTICATION STATUS 🔐     ');
      console.log('═══════════════════════════════════════════\n');

      console.log('OAuth 2.0 Configuration:');
      console.log(`   Client ID: ${hasClientId ? '✅ Configured' : '❌ Not set'}`);
      console.log(`   Client Secret: ${hasClientSecret ? '✅ Configured' : '❌ Not set'}`);
      console.log(`   Redirect URI: ${redirectUri || '❌ Not set'}\n`);

      console.log('API Key Configuration:');
      console.log(`   API Key: ${hasApiKey ? '✅ Configured' : '❌ Not set'}\n`);

      if (hasClientId && hasClientSecret) {
        console.log('✅ OAuth 2.0 is configured');
        console.log('💡 Run "yt-sync auth" to authenticate\n');
      } else if (hasApiKey) {
        console.log('⚠️  Using API Key authentication');
        console.log('⚠️  Limited functionality - OAuth 2.0 recommended for full features\n');
      } else {
        console.log('❌ No authentication configured');
        console.log('\n📋 To set up OAuth 2.0:');
        console.log('   1. Create a project in Google Cloud Console');
        console.log('   2. Enable YouTube Data API v3');
        console.log('   3. Create OAuth 2.0 credentials');
        console.log('   4. Set environment variables:');
        console.log('      - YOUTUBE_CLIENT_ID');
        console.log('      - YOUTUBE_CLIENT_SECRET');
        console.log('      - YOUTUBE_REDIRECT_URI\n');
      }

      console.log('═══════════════════════════════════════════\n');
    } catch (error) {
      console.error('❌ Failed to check auth status:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

/**
 * Helper functions
 */

function parseInterval(interval: string): number {
  const match = interval.match(/^(\d+)(m|h|d)$/);
  if (!match || !match[1] || !match[2]) {
    throw new Error('Invalid interval format. Use format: 1h, 30m, 1d');
  }

  const value = parseInt(match[1], 10);
  const unit = match[2] as 'm' | 'h' | 'd';

  switch (unit) {
    case 'm':
      return value * 60 * 1000; // minutes to ms
    case 'h':
      return value * 60 * 60 * 1000; // hours to ms
    case 'd':
      return value * 24 * 60 * 60 * 1000; // days to ms
    default:
      throw new Error('Invalid interval unit. Use m (minutes), h (hours), or d (days)');
  }
}

function formatInterval(ms: number): string {
  const minutes = ms / (60 * 1000);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = minutes / 60;
  if (hours < 24) {
    return `${hours}h`;
  }

  const days = hours / 24;
  return `${days}d`;
}

/**
 * Caption download command
 */
program
  .command('caption-download')
  .description('Download captions for a video')
  .argument('<video-id>', 'YouTube video ID')
  .option('-l, --language <lang>', 'Caption language (default: en)', 'en')
  .action(async (videoId: string, options: { language: string }) => {
    try {
      console.log(`📥 Downloading captions for video ${videoId}...`);

      const extractor = getCaptionExtractor();
      const result = await extractor.extractCaptions(videoId, options.language);

      if (result.success && result.caption) {
        console.log('\n✅ Captions downloaded successfully');
        console.log(`   Language: ${result.caption.language}`);
        console.log(`   Segments: ${result.caption.segments.length}`);
        console.log(`   Full text length: ${result.caption.fullText.length} characters`);
      } else {
        console.error(`\n❌ Failed to download captions: ${result.error}`);
        process.exit(1);
      }
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

/**
 * Caption languages command
 */
program
  .command('caption-languages')
  .description('Get available caption languages for a video')
  .argument('<video-id>', 'YouTube video ID')
  .action(async (videoId: string) => {
    try {
      console.log(`🔍 Checking available languages for video ${videoId}...`);

      const extractor = getCaptionExtractor();
      const result = await extractor.getAvailableLanguages(videoId);

      if (result.languages.length > 0) {
        console.log('\n✅ Available languages:');
        for (const lang of result.languages) {
          console.log(`   - ${lang}`);
        }
      } else {
        console.log('\n⚠️  No captions found for this video');
      }
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

/**
 * Summarize command
 */
program
  .command('summarize')
  .description('Generate AI summary for a video')
  .argument('<video-id>', 'YouTube video ID')
  .option('-l, --level <level>', 'Summary level: short, medium, detailed', 'medium')
  .option('--language <lang>', 'Caption language (default: en)', 'en')
  .action(async (videoId: string, options: { level: string; language: string }) => {
    try {
      console.log(`🤖 Generating ${options.level} summary for video ${videoId}...`);

      const generator = getSummaryGenerator();
      const result = await generator.generateSummary(videoId, {
        level: options.level as 'short' | 'medium' | 'detailed',
        language: options.language,
      });

      if (result.success && result.summary) {
        console.log('\n✅ Summary generated successfully\n');
        console.log('📝 Summary:');
        console.log(result.summary.summary);

        if (result.summary.keyPoints.length > 0) {
          console.log('\n🔑 Key Points:');
          result.summary.keyPoints.forEach((point, i) => {
            console.log(`   ${i + 1}. ${point}`);
          });
        }

        if (result.summary.keywords.length > 0) {
          console.log('\n🏷️  Keywords:');
          console.log(`   ${result.summary.keywords.join(', ')}`);
        }

        if (result.summary.timestamps && result.summary.timestamps.length > 0) {
          console.log('\n⏱️  Key Timestamps:');
          result.summary.timestamps.forEach(ts => {
            const minutes = Math.floor(ts.time / 60);
            const seconds = ts.time % 60;
            console.log(`   ${minutes}:${seconds.toString().padStart(2, '0')} - ${ts.description}`);
          });
        }
      } else {
        console.error(`\n❌ Failed to generate summary: ${result.error}`);
        process.exit(1);
      }
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

/**
 * Summarize playlist command
 */
program
  .command('summarize-playlist')
  .description('Generate AI summaries for all videos in a playlist')
  .argument('<playlist-id>', 'Playlist ID (database or YouTube ID)')
  .option('-l, --level <level>', 'Summary level: short, medium, detailed', 'medium')
  .option('--language <lang>', 'Caption language (default: en)', 'en')
  .action(async (playlistId: string, options: { level: string; language: string }) => {
    try {
      console.log(`🤖 Generating summaries for playlist ${playlistId}...`);

      const generator = getSummaryGenerator();
      const results = await generator.generatePlaylistSummaries(playlistId, {
        level: options.level as 'short' | 'medium' | 'detailed',
        language: options.language,
      });

      const successCount = results.filter(r => r.success).length;
      const failedCount = results.length - successCount;

      console.log('\n📊 Summary Generation Results:');
      console.log(`   Total videos: ${results.length}`);
      console.log(`   Successful: ${successCount}`);
      console.log(`   Failed: ${failedCount}`);

      if (failedCount > 0) {
        console.log('\n❌ Failed videos:');
        results
          .filter(r => !r.success)
          .forEach(r => {
            console.log(`   - ${r.videoId}: ${r.error}`);
          });
      }
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

/**
 * Note add command
 */
program
  .command('note-add')
  .description('Add a new note to a video')
  .argument('<video-id>', 'YouTube video ID')
  .argument('<timestamp>', 'Timestamp in seconds (e.g., 120 for 2:00)')
  .argument('<content>', 'Note content (Markdown supported)')
  .option('-t, --tags <tags>', 'Comma-separated tags (e.g., "important,review")')
  .action(async (videoId: string, timestamp: string, content: string, options: { tags?: string }) => {
    try {
      console.log(`📝 Adding note to video ${videoId} at ${timestamp}s...`);

      const noteManager = getNoteManager();
      const tags = options.tags ? options.tags.split(',').map(t => t.trim()) : undefined;

      const result = await noteManager.createNote({
        videoId,
        timestamp: parseInt(timestamp, 10),
        content,
        tags,
      });

      if (result.success && result.note) {
        console.log('\n✅ Note added successfully');
        console.log(`   ID: ${result.note.id}`);
        console.log(`   Timestamp: ${formatTimestamp(result.note.timestamp)}`);
        if (result.note.tags.length > 0) {
          console.log(`   Tags: ${result.note.tags.join(', ')}`);
        }
      } else {
        console.error(`\n❌ Failed to add note: ${result.error}`);
        process.exit(1);
      }
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

/**
 * Note list command
 */
program
  .command('note-list')
  .description('List notes for a video or search notes')
  .option('-v, --video <video-id>', 'Filter by video ID')
  .option('-t, --tags <tags>', 'Filter by tags (comma-separated)')
  .option('-s, --search <text>', 'Search in note content')
  .option('--from <seconds>', 'Start timestamp filter')
  .option('--to <seconds>', 'End timestamp filter')
  .action(async (options: {
    video?: string;
    tags?: string;
    search?: string;
    from?: string;
    to?: string;
  }) => {
    try {
      const noteManager = getNoteManager();

      const filters: any = {};
      if (options.video) filters.videoId = options.video;
      if (options.tags) filters.tags = options.tags.split(',').map(t => t.trim());
      if (options.search) filters.contentSearch = options.search;
      if (options.from || options.to) {
        filters.timestampRange = {
          start: options.from ? parseInt(options.from, 10) : 0,
          end: options.to ? parseInt(options.to, 10) : Number.MAX_SAFE_INTEGER,
        };
      }

      const notes = await noteManager.searchNotes(filters);

      if (notes.length === 0) {
        console.log('\n📭 No notes found matching the criteria');
        return;
      }

      console.log(`\n📝 Found ${notes.length} note(s):\n`);

      for (const note of notes) {
        console.log(`┌─ ID: ${note.id}`);
        console.log(`│  Video: ${note.videoId}`);
        console.log(`│  Time: ${formatTimestamp(note.timestamp)}`);
        if (note.tags.length > 0) {
          console.log(`│  Tags: ${note.tags.join(', ')}`);
        }
        console.log(`│  Content:`);
        const contentLines = note.content.split('\n');
        contentLines.forEach(line => {
          console.log(`│    ${line}`);
        });
        console.log(`└─ Updated: ${note.updatedAt.toISOString()}\n`);
      }
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

/**
 * Note update command
 */
program
  .command('note-update')
  .description('Update an existing note')
  .argument('<note-id>', 'Note ID')
  .option('-c, --content <text>', 'New content')
  .option('-t, --tags <tags>', 'New tags (comma-separated)')
  .option('--timestamp <seconds>', 'New timestamp')
  .action(async (noteId: string, options: {
    content?: string;
    tags?: string;
    timestamp?: string;
  }) => {
    try {
      console.log(`✏️  Updating note ${noteId}...`);

      const noteManager = getNoteManager();

      const updates: any = {};
      if (options.content) updates.content = options.content;
      if (options.tags) updates.tags = options.tags.split(',').map(t => t.trim());
      if (options.timestamp) updates.timestamp = parseInt(options.timestamp, 10);

      const result = await noteManager.updateNote(noteId, updates);

      if (result.success && result.note) {
        console.log('\n✅ Note updated successfully');
        console.log(`   ID: ${result.note.id}`);
        console.log(`   Timestamp: ${formatTimestamp(result.note.timestamp)}`);
        if (result.note.tags.length > 0) {
          console.log(`   Tags: ${result.note.tags.join(', ')}`);
        }
      } else {
        console.error(`\n❌ Failed to update note: ${result.error}`);
        process.exit(1);
      }
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

/**
 * Note delete command
 */
program
  .command('note-delete')
  .description('Delete a note')
  .argument('<note-id>', 'Note ID')
  .action(async (noteId: string) => {
    try {
      console.log(`🗑️  Deleting note ${noteId}...`);

      const noteManager = getNoteManager();
      const result = await noteManager.deleteNote(noteId);

      if (result.success) {
        console.log('\n✅ Note deleted successfully');
      } else {
        console.error(`\n❌ Failed to delete note: ${result.error}`);
        process.exit(1);
      }
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

/**
 * Note export command
 */
program
  .command('note-export')
  .description('Export notes to a file')
  .argument('<output-path>', 'Output file path')
  .option('-f, --format <format>', 'Export format: markdown, json, csv (default: markdown)', 'markdown')
  .option('-v, --video <video-id>', 'Filter by video ID')
  .option('-t, --tags <tags>', 'Filter by tags (comma-separated)')
  .action(async (outputPath: string, options: {
    format: string;
    video?: string;
    tags?: string;
  }) => {
    try {
      console.log(`📤 Exporting notes to ${outputPath}...`);

      const noteManager = getNoteManager();

      const filters: any = {};
      if (options.video) filters.videoId = options.video;
      if (options.tags) filters.tags = options.tags.split(',').map(t => t.trim());

      const result = await noteManager.exportNotes(
        filters,
        options.format as 'markdown' | 'json' | 'csv',
        outputPath
      );

      if (result.success) {
        console.log('\n✅ Notes exported successfully');
        console.log(`   Format: ${result.format}`);
        console.log(`   File: ${result.filepath}`);
      } else {
        console.error(`\n❌ Failed to export notes: ${result.error}`);
        process.exit(1);
      }
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

/**
 * Session record command
 */
program
  .command('session-record')
  .description('Record a watch session for a video')
  .argument('<video-id>', 'YouTube video ID')
  .argument('<start-pos>', 'Start position in seconds')
  .argument('<end-pos>', 'End position in seconds')
  .option('--start-time <iso>', 'Start time (ISO 8601 format)')
  .option('--end-time <iso>', 'End time (ISO 8601 format)')
  .action(async (videoId: string, startPos: string, endPos: string, options: {
    startTime?: string;
    endTime?: string;
  }) => {
    try {
      console.log(`📊 Recording watch session for video ${videoId}...`);

      const tracker = getAnalyticsTracker();

      const sessionData: any = {
        videoId,
        startPos: parseInt(startPos, 10),
        endPos: parseInt(endPos, 10),
      };

      if (options.startTime) {
        sessionData.startedAt = new Date(options.startTime);
      }
      if (options.endTime) {
        sessionData.endedAt = new Date(options.endTime);
      }

      const result = await tracker.recordSession(sessionData);

      if (result.success && result.session) {
        console.log('\n✅ Watch session recorded');
        console.log(`   Session ID: ${result.session.id}`);
        console.log(`   Duration: ${formatDuration(result.session.duration)}`);
        console.log(`   Position: ${formatTimestamp(result.session.startPos)} → ${formatTimestamp(result.session.endPos)}`);
      } else {
        console.error(`\n❌ Failed to record session: ${result.error}`);
        process.exit(1);
      }
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

/**
 * Analytics video command
 */
program
  .command('analytics-video')
  .description('Show analytics for a video')
  .argument('<video-id>', 'YouTube video ID')
  .action(async (videoId: string) => {
    try {
      console.log(`📊 Fetching analytics for video ${videoId}...\n`);

      const tracker = getAnalyticsTracker();
      const analytics = await tracker.getVideoAnalytics(videoId);

      if (!analytics) {
        console.error('❌ Video not found or no analytics available');
        process.exit(1);
      }

      console.log(`📹 ${analytics.videoTitle}\n`);
      console.log(`⏱️  Duration: ${formatDuration(analytics.totalDuration)}`);
      console.log(`👁️  Total Watch Time: ${formatDuration(analytics.totalWatchTime)}`);
      console.log(`📈 Completion: ${analytics.completionPercentage.toFixed(1)}%`);
      console.log(`🔢 Watch Count: ${analytics.watchCount} session(s)`);
      console.log(`⌛ Average Session: ${formatDuration(analytics.averageSessionDuration)}`);
      console.log(`🔄 Rewatches: ${analytics.rewatchCount}`);

      if (analytics.firstWatchedAt) {
        console.log(`\n📅 First Watched: ${analytics.firstWatchedAt.toLocaleDateString()}`);
      }
      if (analytics.lastWatchedAt) {
        console.log(`📅 Last Watched: ${analytics.lastWatchedAt.toLocaleDateString()}`);
      }

      // Show progress bar
      const progressBar = createProgressBar(analytics.completionPercentage);
      console.log(`\n${progressBar}`);
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

/**
 * Analytics playlist command
 */
program
  .command('analytics-playlist')
  .description('Show analytics for a playlist')
  .argument('<playlist-id>', 'Playlist ID (database or YouTube ID)')
  .action(async (playlistId: string) => {
    try {
      console.log(`📊 Fetching analytics for playlist ${playlistId}...\n`);

      const tracker = getAnalyticsTracker();
      const analytics = await tracker.getPlaylistAnalytics(playlistId);

      if (!analytics) {
        console.error('❌ Playlist not found');
        process.exit(1);
      }

      console.log(`📚 ${analytics.playlistTitle}\n`);
      console.log(`📹 Total Videos: ${analytics.totalVideos}`);
      console.log(`✅ Completed: ${analytics.completedVideos} (${Math.round((analytics.completedVideos / analytics.totalVideos) * 100)}%)`);
      console.log(`⏳ In Progress: ${analytics.watchedVideos - analytics.completedVideos}`);
      console.log(`📭 Not Started: ${analytics.totalVideos - analytics.watchedVideos}`);
      console.log(`👁️  Total Watch Time: ${formatDuration(analytics.totalWatchTime)}`);
      console.log(`📈 Average Completion: ${analytics.averageCompletion.toFixed(1)}%`);

      if (analytics.lastActivity) {
        console.log(`\n📅 Last Activity: ${analytics.lastActivity.toLocaleDateString()}`);
      }

      // Show top videos by watch time
      if (analytics.videoAnalytics.length > 0) {
        console.log('\n🏆 Top Videos by Watch Time:');
        const topVideos = [...analytics.videoAnalytics]
          .sort((a, b) => b.totalWatchTime - a.totalWatchTime)
          .slice(0, 5);

        topVideos.forEach((video, i) => {
          console.log(`   ${i + 1}. ${video.videoTitle}`);
          console.log(`      Watch Time: ${formatDuration(video.totalWatchTime)} | Completion: ${video.completionPercentage.toFixed(1)}%`);
        });
      }
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

/**
 * Analytics dashboard command
 */
program
  .command('analytics-dashboard')
  .description('Show overall learning dashboard')
  .action(async () => {
    try {
      console.log('📊 Loading learning dashboard...\n');

      const tracker = getAnalyticsTracker();
      const dashboard = await tracker.getLearningDashboard();

      console.log('═══════════════════════════════════════════');
      console.log('          📚 LEARNING DASHBOARD 📚          ');
      console.log('═══════════════════════════════════════════\n');

      // Overall Stats
      console.log('📊 Overall Statistics:');
      console.log(`   Total Videos: ${dashboard.totalVideos}`);
      console.log(`   ✅ Completed: ${dashboard.completedVideos}`);
      console.log(`   ⏳ In Progress: ${dashboard.inProgressVideos}`);
      console.log(`   📭 Not Started: ${dashboard.notStartedVideos}`);
      console.log(`   👁️  Total Watch Time: ${formatDuration(dashboard.totalWatchTime)}`);
      console.log(`   🔢 Total Sessions: ${dashboard.totalSessions}`);
      console.log(`   ⌛ Avg Session: ${formatDuration(dashboard.averageSessionDuration)}\n`);

      // Learning Streak
      console.log('🔥 Learning Streak:');
      console.log(`   Current: ${dashboard.learningStreak.currentStreak} day(s)`);
      console.log(`   Longest: ${dashboard.learningStreak.longestStreak} day(s)`);
      if (dashboard.learningStreak.lastActiveDate) {
        console.log(`   Last Active: ${dashboard.learningStreak.lastActiveDate.toLocaleDateString()}\n`);
      }

      // Recent Activity
      if (dashboard.recentActivity.length > 0) {
        console.log('⏱️  Recent Activity:');
        dashboard.recentActivity.slice(0, 5).forEach(activity => {
          console.log(`   • ${activity.videoTitle}`);
          console.log(`     ${activity.watchedAt.toLocaleDateString()} | ${formatDuration(activity.duration)} | ${activity.progress.toFixed(1)}% complete`);
        });
        console.log('');
      }

      // Top Videos
      if (dashboard.topVideos.length > 0) {
        console.log('🏆 Most Watched Videos:');
        dashboard.topVideos.slice(0, 5).forEach((video, i) => {
          console.log(`   ${i + 1}. ${video.videoTitle}`);
          console.log(`      ${formatDuration(video.watchTime)} | ${video.sessionCount} session(s) | ${video.completionRate.toFixed(1)}% complete`);
        });
      }

      console.log('\n═══════════════════════════════════════════');
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

/**
 * Retention metrics command
 */
program
  .command('retention')
  .description('Show retention metrics for a video')
  .argument('<video-id>', 'YouTube video ID')
  .action(async (videoId: string) => {
    try {
      console.log(`🧠 Analyzing retention for video ${videoId}...\n`);

      const tracker = getAnalyticsTracker();
      const metrics = await tracker.getRetentionMetrics(videoId);

      if (!metrics) {
        console.error('❌ Video not found or no metrics available');
        process.exit(1);
      }

      console.log(`📹 ${metrics.videoTitle}\n`);
      console.log(`📊 Retention Score: ${metrics.retentionScore}/100`);
      console.log(`🎯 Difficulty: ${metrics.difficulty.toUpperCase()}`);
      console.log(`🔄 Review Count: ${metrics.reviewCount}`);

      if (metrics.lastReviewedAt) {
        console.log(`📅 Last Reviewed: ${metrics.lastReviewedAt.toLocaleDateString()}`);
      }

      if (metrics.recommendedReviewDate) {
        const daysUntil = Math.ceil(
          (metrics.recommendedReviewDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        );

        if (daysUntil > 0) {
          console.log(`\n💡 Recommended Review: ${metrics.recommendedReviewDate.toLocaleDateString()} (in ${daysUntil} days)`);
        } else {
          console.log(`\n⚠️  Review Recommended: ${metrics.recommendedReviewDate.toLocaleDateString()} (overdue by ${Math.abs(daysUntil)} days)`);
        }
      }

      // Show retention score bar
      const retentionBar = createProgressBar(metrics.retentionScore);
      console.log(`\n${retentionBar}`);
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

/**
 * Helper function to format timestamp
 */
function formatTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Helper function to format duration
 */
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

/**
 * Helper function to create progress bar
 */
function createProgressBar(percentage: number, width: number = 40): string {
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  return `[${bar}] ${percentage.toFixed(1)}%`;
}

// Error handling
process.on('unhandledRejection', (error) => {
  logger.error('Unhandled rejection', { error });
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});

process.on('SIGINT', async () => {
  console.log('\n\nGracefully shutting down...');
  await disconnectDatabase();
  process.exit(0);
});

// Register user authentication commands
registerAuthCommands(program);

// Register playlist management commands
registerPlaylistCommands(program);

// Register scheduler commands
registerSchedulerCommands(program);

program.parse();
