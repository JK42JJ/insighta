/**
 * Playlist Manager Module
 *
 * Manages playlist operations:
 * - Import playlists
 * - Sync playlists with YouTube
 * - Track playlist changes
 * - Manage playlist items
 */

import { youtube_playlists, youtube_playlist_items } from '@prisma/client';
import { SyncStatus } from '../../types/enums';
import { db } from '../database/client';
import { getYouTubeClient } from '../../api/client';
import { getQuotaManager } from '../quota/manager';
import { logger } from '../../utils/logger';
import { InvalidPlaylistError, RecordNotFoundError, ConcurrentSyncError } from '../../utils/errors';

/**
 * Playlist Manager
 *
 * Note: YouTube client and quota manager are lazily loaded to avoid
 * initializing at class instantiation time. This is required for
 * serverless environments where credentials may not be available
 * until the actual request is made.
 */
export class PlaylistManager {
  // Lazy getters for dependencies - only initialize when actually needed
  private get youtubeClient() {
    return getYouTubeClient();
  }
  private get quotaManager() {
    return getQuotaManager();
  }

  /**
   * Import playlist from YouTube
   */
  public async importPlaylist(playlistIdOrUrl: string, userId: string): Promise<youtube_playlists> {
    const playlistId = this.extractPlaylistId(playlistIdOrUrl);

    // Check if already exists
    const existing = await db.youtube_playlists.findFirst({
      where: { youtube_playlist_id: playlistId, user_id: userId },
    });

    if (existing) {
      logger.info('Playlist already imported', { playlistId });
      return existing;
    }

    // Reserve quota
    await this.quotaManager.reserveQuota('playlist.details', 1);

    // Fetch from YouTube
    const ytPlaylist = await this.youtubeClient.getPlaylist(playlistId);

    if (!ytPlaylist.snippet) {
      throw new InvalidPlaylistError(playlistId, { reason: 'Missing snippet data' });
    }

    // Create in database
    const playlist = await db.youtube_playlists.create({
      data: {
        user_id: userId,
        youtube_playlist_id: playlistId,
        youtube_playlist_url: `https://www.youtube.com/playlist?list=${playlistId}`,
        title: ytPlaylist.snippet.title ?? 'Untitled Playlist',
        description: ytPlaylist.snippet.description ?? null,
        channel_title: ytPlaylist.snippet.channelTitle ?? '',
        thumbnail_url: ytPlaylist.snippet.thumbnails?.default?.url ?? null,
        item_count: ytPlaylist.contentDetails?.itemCount ?? 0,
        sync_status: SyncStatus.PENDING,
      },
    });

    logger.info('Playlist imported successfully', {
      playlistId: playlist.id,
      youtubeId: playlist.youtube_playlist_id,
      title: playlist.title,
    });

    return playlist;
  }

  /**
   * Get playlist by ID or YouTube ID
   */
  public async getPlaylist(id: string): Promise<youtube_playlists> {
    const playlist = await db.youtube_playlists.findFirst({
      where: {
        OR: [{ id }, { youtube_playlist_id: id }],
      },
    });

    if (!playlist) {
      throw new RecordNotFoundError('Playlist', id);
    }

    return playlist;
  }

  /**
   * List all playlists for a specific user
   */
  public async listPlaylists(
    options: {
      userId?: string;
      filter?: string;
      sortBy?: 'title' | 'last_synced_at' | 'created_at';
      sortOrder?: 'asc' | 'desc';
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ playlists: youtube_playlists[]; total: number }> {
    const where: any = {};

    if (options.userId) {
      where.user_id = options.userId;
    }

    if (options.filter) {
      where.OR = [
        { title: { contains: options.filter } },
        { channel_title: { contains: options.filter } },
      ];
    }

    const orderBy = { [options.sortBy ?? 'created_at']: options.sortOrder ?? 'desc' };

    const [playlists, total] = await Promise.all([
      db.youtube_playlists.findMany({
        where,
        orderBy,
        take: options.limit,
        skip: options.offset,
      }),
      db.youtube_playlists.count({ where }),
    ]);

    return { playlists, total };
  }

  /**
   * Update playlist metadata from YouTube
   */
  public async updatePlaylistMetadata(playlistId: string): Promise<youtube_playlists> {
    const playlist = await this.getPlaylist(playlistId);

    // Reserve quota
    await this.quotaManager.reserveQuota('playlist.details', 1);

    // Fetch latest data
    const ytPlaylist = await this.youtubeClient.getPlaylist(playlist.youtube_playlist_id);

    if (!ytPlaylist.snippet) {
      throw new InvalidPlaylistError(playlist.youtube_playlist_id, {
        reason: 'Missing snippet data',
      });
    }

    // Update in database
    const updated = await db.youtube_playlists.update({
      where: { id: playlist.id },
      data: {
        title: ytPlaylist.snippet.title ?? playlist.title,
        description: ytPlaylist.snippet.description ?? playlist.description,
        channel_title: ytPlaylist.snippet.channelTitle ?? playlist.channel_title,
        thumbnail_url: ytPlaylist.snippet.thumbnails?.default?.url ?? playlist.thumbnail_url,
        item_count: ytPlaylist.contentDetails?.itemCount ?? playlist.item_count,
        updated_at: new Date(),
      },
    });

    logger.info('Playlist metadata updated', { playlistId: updated.id });

    return updated;
  }

  /**
   * Delete playlist
   */
  public async deletePlaylist(playlistId: string): Promise<void> {
    const playlist = await this.getPlaylist(playlistId);

    await db.youtube_playlists.delete({
      where: { id: playlist.id },
    });

    logger.info('Playlist deleted', { playlistId: playlist.id });
  }

  /**
   * Get playlist with items
   */
  public async getPlaylistWithItems(playlistId: string): Promise<
    youtube_playlists & {
      youtube_playlist_items: (youtube_playlist_items & { youtube_videos: any })[];
    }
  > {
    const playlist = await this.getPlaylist(playlistId);

    const playlistWithItems = await db.youtube_playlists.findUnique({
      where: { id: playlist.id },
      include: {
        youtube_playlist_items: {
          where: { removed_at: null },
          include: { youtube_videos: true },
          orderBy: { position: 'asc' },
        },
      },
    });

    if (!playlistWithItems) {
      throw new RecordNotFoundError('Playlist', playlistId);
    }

    return playlistWithItems;
  }

  /**
   * Set playlist sync status
   */
  public async setSyncStatus(playlistId: string, status: SyncStatus): Promise<void> {
    await db.youtube_playlists.update({
      where: { id: playlistId },
      data: { sync_status: status },
    });
  }

  /**
   * Check if playlist is being synced
   */
  public async isSyncing(playlistId: string): Promise<boolean> {
    const playlist = await this.getPlaylist(playlistId);
    return playlist.sync_status === SyncStatus.IN_PROGRESS;
  }

  /**
   * Acquire sync lock
   */
  public async acquireSyncLock(playlistId: string): Promise<void> {
    const playlist = await this.getPlaylist(playlistId);

    if (playlist.sync_status === SyncStatus.IN_PROGRESS) {
      throw new ConcurrentSyncError(playlistId);
    }

    await this.setSyncStatus(playlist.id, SyncStatus.IN_PROGRESS);
  }

  /**
   * Release sync lock
   */
  public async releaseSyncLock(playlistId: string, status: SyncStatus): Promise<void> {
    await db.youtube_playlists.update({
      where: { id: playlistId },
      data: {
        sync_status: status,
        last_synced_at: status === SyncStatus.COMPLETED ? new Date() : undefined,
      },
    });
  }

  /**
   * Extract playlist ID from URL or ID string
   */
  private extractPlaylistId(input: string): string {
    // Already a playlist ID
    if (/^[A-Za-z0-9_-]+$/.test(input) && !input.includes('/')) {
      return input;
    }

    // Extract from URL
    const patterns = [
      /[?&]list=([A-Za-z0-9_-]+)/,
      /youtube\.com\/playlist\?list=([A-Za-z0-9_-]+)/,
      /youtube\.com\/watch\?.*list=([A-Za-z0-9_-]+)/,
    ];

    for (const pattern of patterns) {
      const match = input.match(pattern);
      if (match?.[1]) {
        return match[1];
      }
    }

    throw new InvalidPlaylistError(input, { reason: 'Invalid playlist URL or ID format' });
  }

  /**
   * Get sync statistics
   */
  public async getSyncStats(playlistId: string): Promise<{
    totalSyncs: number;
    successfulSyncs: number;
    failedSyncs: number;
    lastSync: Date | null;
    averageDuration: number | null;
  }> {
    const playlist = await this.getPlaylist(playlistId);

    const history = await db.youtube_sync_history.findMany({
      where: { playlist_id: playlist.id },
      orderBy: { started_at: 'desc' },
    });

    const totalSyncs = history.length;
    const successfulSyncs = history.filter(
      (h) => h.status === (SyncStatus.COMPLETED as string)
    ).length;
    const failedSyncs = history.filter((h) => h.status === (SyncStatus.FAILED as string)).length;
    const lastSync = history[0]?.started_at ?? null;

    // New schema does not have a duration column; compute from started_at/completed_at
    const completedSyncs = history.filter((h) => h.completed_at !== null);
    const averageDuration =
      completedSyncs.length > 0
        ? completedSyncs.reduce(
            (sum, h) => sum + (h.completed_at!.getTime() - h.started_at.getTime()),
            0
          ) / completedSyncs.length
        : null;

    return {
      totalSyncs,
      successfulSyncs,
      failedSyncs,
      lastSync,
      averageDuration,
    };
  }
}

/**
 * Singleton instance
 */
let managerInstance: PlaylistManager | null = null;

/**
 * Get playlist manager instance
 */
export function getPlaylistManager(): PlaylistManager {
  if (!managerInstance) {
    managerInstance = new PlaylistManager();
  }
  return managerInstance;
}

export default getPlaylistManager;
