/**
 * Playlist Management Commands for CLI
 *
 * Commands for importing, listing, syncing, and managing playlists via API
 */

import { Command } from 'commander';
import * as readline from 'readline/promises';
import { createApiClient, ApiClientError } from '../api-client';
import { getTokenStorage } from '../token-storage';

/**
 * Prompt for text input
 */
async function promptText(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await rl.question(prompt);
  rl.close();
  return answer.trim();
}

/**
 * Prompt for confirmation (y/n)
 */
async function promptConfirm(prompt: string): Promise<boolean> {
  const answer = await promptText(`${prompt} (y/n): `);
  return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
}

/**
 * Get authenticated API client or exit
 */
async function getAuthenticatedClient() {
  const tokenStorage = getTokenStorage();
  const tokens = await tokenStorage.getValidTokens();

  if (!tokens) {
    console.error('\n❌ You are not logged in\n');
    console.error('Please login first using: yt-sync user-login\n');
    process.exit(1);
  }

  return createApiClient(tokens.accessToken);
}

/**
 * Format duration in seconds to human-readable format
 */
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}

/**
 * Format number with thousand separators
 */
function formatNumber(num: number): string {
  return num.toLocaleString();
}

/**
 * Import a playlist
 */
export async function importPlaylistCommand(playlistUrl?: string): Promise<void> {
  try {
    console.log('\n📥 Import YouTube Playlist\n');

    // Get playlist URL
    if (!playlistUrl) {
      playlistUrl = await promptText('Playlist URL or ID: ');
    }

    if (!playlistUrl) {
      console.error('❌ Playlist URL is required');
      process.exit(1);
    }

    // Import playlist
    console.log('\n🔄 Importing playlist...\n');

    const apiClient = await getAuthenticatedClient();
    const response = await apiClient.importPlaylist({ playlistUrl });

    console.log('✅ Playlist imported successfully!\n');
    console.log('═══════════════════════════════════════════');
    console.log(`   Title: ${response.playlist.title}`);
    console.log(`   Channel: ${response.playlist.channelTitle}`);
    console.log(`   Items: ${response.playlist.itemCount}`);
    console.log(`   Playlist ID: ${response.playlist.id}`);
    console.log(`   YouTube ID: ${response.playlist.youtubeId}`);
    console.log('═══════════════════════════════════════════\n');
    console.log('💡 Next steps:');
    console.log('   - View details: yt-sync playlist-get ' + response.playlist.id);
    console.log('   - Sync updates: yt-sync playlist-sync ' + response.playlist.id);
    console.log('   - List all: yt-sync playlist-list\n');
  } catch (error) {
    if (error instanceof ApiClientError) {
      console.error(`\n❌ Import failed: ${error.message}\n`);
      if (error.code === 'DUPLICATE_RESOURCE') {
        console.error('💡 This playlist is already imported. Use playlist-list to see all playlists.\n');
      } else if (error.statusCode === 401) {
        console.error('💡 Your session has expired. Please login again: yt-sync user-login\n');
      }
    } else {
      console.error(`\n❌ Unexpected error: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    process.exit(1);
  }
}

/**
 * List all playlists
 */
export async function listPlaylistsCommand(options: {
  filter?: string;
  sortBy?: 'title' | 'lastSyncedAt' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
  limit?: string;
  offset?: string;
}): Promise<void> {
  try {
    console.log('\n📋 Your Playlists\n');

    const apiClient = await getAuthenticatedClient();

    // Parse query parameters
    const query: any = {};
    if (options.filter) query.filter = options.filter;
    if (options.sortBy) query.sortBy = options.sortBy;
    if (options.sortOrder) query.sortOrder = options.sortOrder;
    if (options.limit) query.limit = parseInt(options.limit, 10);
    if (options.offset) query.offset = parseInt(options.offset, 10);

    const response = await apiClient.listPlaylists(query);

    if (response.playlists.length === 0) {
      console.log('⚠️  No playlists found\n');
      console.log('💡 Import your first playlist:');
      console.log('   yt-sync playlist-import <playlist-url>\n');
      return;
    }

    console.log(`Found ${response.total} playlist(s)\n`);
    console.log('═══════════════════════════════════════════════════════════════════\n');

    response.playlists.forEach((playlist, idx) => {
      console.log(`${idx + 1}. ${playlist.title}`);
      console.log(`   Channel: ${playlist.channelTitle}`);
      console.log(`   Items: ${playlist.itemCount} | Status: ${playlist.syncStatus}`);
      console.log(`   Last Synced: ${playlist.lastSyncedAt ? new Date(playlist.lastSyncedAt).toLocaleString() : 'Never'}`);
      console.log(`   ID: ${playlist.id}`);
      console.log('');
    });

    console.log('═══════════════════════════════════════════════════════════════════\n');
    console.log('💡 Commands:');
    console.log('   - View details: yt-sync playlist-get <id>');
    console.log('   - Sync playlist: yt-sync playlist-sync <id>');
    console.log('   - Delete playlist: yt-sync playlist-delete <id>\n');
  } catch (error) {
    if (error instanceof ApiClientError) {
      console.error(`\n❌ Failed to list playlists: ${error.message}\n`);
      if (error.statusCode === 401) {
        console.error('💡 Your session has expired. Please login again: yt-sync user-login\n');
      }
    } else {
      console.error(`\n❌ Unexpected error: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    process.exit(1);
  }
}

/**
 * Get playlist details
 */
export async function getPlaylistCommand(playlistId: string): Promise<void> {
  try {
    if (!playlistId) {
      console.error('\n❌ Playlist ID is required\n');
      console.error('Usage: yt-sync playlist-get <id>\n');
      process.exit(1);
    }

    console.log('\n🔍 Fetching playlist details...\n');

    const apiClient = await getAuthenticatedClient();
    const response = await apiClient.getPlaylist(playlistId);
    const playlist = response.playlist;

    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('                    📋 PLAYLIST DETAILS                    ');
    console.log('═══════════════════════════════════════════════════════════════════\n');

    console.log(`Title: ${playlist.title}`);
    console.log(`Channel: ${playlist.channelTitle}`);
    if (playlist.description) {
      console.log(`Description: ${playlist.description.substring(0, 200)}${playlist.description.length > 200 ? '...' : ''}`);
    }
    console.log(`\nTotal Items: ${playlist.itemCount}`);
    console.log(`Sync Status: ${playlist.syncStatus}`);
    console.log(`Last Synced: ${playlist.lastSyncedAt ? new Date(playlist.lastSyncedAt).toLocaleString() : 'Never'}`);
    console.log(`Created: ${new Date(playlist.createdAt).toLocaleString()}`);
    console.log(`\nPlaylist ID: ${playlist.id}`);
    console.log(`YouTube ID: ${playlist.youtubeId}`);

    if (playlist.items && playlist.items.length > 0) {
      console.log('\n───────────────────────────────────────────────────────────────────');
      console.log(`                    📹 VIDEOS (${playlist.items.length})                    `);
      console.log('───────────────────────────────────────────────────────────────────\n');

      playlist.items.slice(0, 10).forEach((item) => {
        const video = item.video;
        console.log(`${item.position + 1}. ${video.title}`);
        console.log(`   Channel: ${video.channelTitle}`);
        console.log(`   Duration: ${formatDuration(video.duration)} | Views: ${formatNumber(video.viewCount)}`);
        console.log(`   Published: ${new Date(video.publishedAt).toLocaleDateString()}`);
        console.log(`   YouTube ID: ${video.youtubeId}`);
        console.log('');
      });

      if (playlist.items.length > 10) {
        console.log(`   ... and ${playlist.items.length - 10} more videos\n`);
      }
    }

    console.log('═══════════════════════════════════════════════════════════════════\n');
    console.log('💡 Commands:');
    console.log(`   - Sync updates: yt-sync playlist-sync ${playlist.id}`);
    console.log(`   - Delete playlist: yt-sync playlist-delete ${playlist.id}\n`);
  } catch (error) {
    if (error instanceof ApiClientError) {
      console.error(`\n❌ Failed to get playlist: ${error.message}\n`);
      if (error.statusCode === 404) {
        console.error('💡 Playlist not found. Use playlist-list to see available playlists.\n');
      } else if (error.statusCode === 401) {
        console.error('💡 Your session has expired. Please login again: yt-sync user-login\n');
      }
    } else {
      console.error(`\n❌ Unexpected error: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    process.exit(1);
  }
}

/**
 * Sync playlist
 */
export async function syncPlaylistCommand(playlistId: string): Promise<void> {
  try {
    if (!playlistId) {
      console.error('\n❌ Playlist ID is required\n');
      console.error('Usage: yt-sync playlist-sync <id>\n');
      process.exit(1);
    }

    console.log('\n🔄 Syncing playlist with YouTube...\n');

    const apiClient = await getAuthenticatedClient();
    const response = await apiClient.syncPlaylist(playlistId);
    const result = response.result;

    console.log('✅ Sync completed successfully!\n');
    console.log('═══════════════════════════════════════════');
    console.log('          📊 SYNC RESULTS 📊          ');
    console.log('═══════════════════════════════════════════\n');

    console.log(`   Status: ${result.status}`);
    console.log(`   Items Added: ${result.itemsAdded}`);
    console.log(`   Items Removed: ${result.itemsRemoved}`);
    console.log(`   Items Reordered: ${result.itemsReordered}`);
    console.log(`   Duration: ${formatDuration(Math.floor(result.duration / 1000))}`);
    console.log(`   API Quota Used: ${result.quotaUsed} units`);

    if (result.error) {
      console.log(`\n   ⚠️  Error: ${result.error}`);
    }

    console.log('\n═══════════════════════════════════════════\n');
    console.log('💡 Next steps:');
    console.log(`   - View updated details: yt-sync playlist-get ${result.playlistId}\n`);
  } catch (error) {
    if (error instanceof ApiClientError) {
      console.error(`\n❌ Sync failed: ${error.message}\n`);
      if (error.statusCode === 404) {
        console.error('💡 Playlist not found. Use playlist-list to see available playlists.\n');
      } else if (error.statusCode === 409) {
        console.error('💡 Sync is already in progress. Please wait for it to complete.\n');
      } else if (error.statusCode === 401) {
        console.error('💡 Your session has expired. Please login again: yt-sync user-login\n');
      }
    } else {
      console.error(`\n❌ Unexpected error: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    process.exit(1);
  }
}

/**
 * Delete playlist
 */
export async function deletePlaylistCommand(playlistId: string, options: { force?: boolean }): Promise<void> {
  try {
    if (!playlistId) {
      console.error('\n❌ Playlist ID is required\n');
      console.error('Usage: yt-sync playlist-delete <id>\n');
      process.exit(1);
    }

    // Confirm deletion unless --force flag is used
    if (!options.force) {
      console.log('\n⚠️  WARNING: This will permanently delete the playlist and all associated data.\n');
      const confirmed = await promptConfirm('Are you sure you want to continue?');

      if (!confirmed) {
        console.log('\n❌ Deletion cancelled\n');
        return;
      }
    }

    console.log('\n🗑️  Deleting playlist...\n');

    const apiClient = await getAuthenticatedClient();
    await apiClient.deletePlaylist(playlistId);

    console.log('✅ Playlist deleted successfully!\n');
    console.log('💡 Use playlist-list to see remaining playlists.\n');
  } catch (error) {
    if (error instanceof ApiClientError) {
      console.error(`\n❌ Delete failed: ${error.message}\n`);
      if (error.statusCode === 404) {
        console.error('💡 Playlist not found. It may have already been deleted.\n');
      } else if (error.statusCode === 401) {
        console.error('💡 Your session has expired. Please login again: yt-sync user-login\n');
      }
    } else {
      console.error(`\n❌ Unexpected error: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    process.exit(1);
  }
}

/**
 * Register playlist commands
 */
export function registerPlaylistCommands(program: Command): void {
  program
    .command('playlist-import [url]')
    .description('Import a YouTube playlist by URL or ID')
    .action(importPlaylistCommand);

  program
    .command('playlist-list')
    .description('List all imported playlists')
    .option('-f, --filter <text>', 'Filter playlists by title')
    .option('-s, --sort-by <field>', 'Sort by field (title, lastSyncedAt, createdAt)')
    .option('-o, --sort-order <order>', 'Sort order (asc, desc)')
    .option('-l, --limit <number>', 'Limit number of results')
    .option('--offset <number>', 'Offset for pagination')
    .action(listPlaylistsCommand);

  program
    .command('playlist-get <id>')
    .description('Get detailed playlist information')
    .action(getPlaylistCommand);

  program
    .command('playlist-sync <id>')
    .description('Sync playlist with YouTube')
    .action(syncPlaylistCommand);

  program
    .command('playlist-delete <id>')
    .description('Delete a playlist')
    .option('--force', 'Skip confirmation prompt')
    .action(deletePlaylistCommand);
}
