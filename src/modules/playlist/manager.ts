/**
 * Playlist Manager Module
 *
 * Manages playlist operations:
 * - Import playlists
 * - Sync playlists with YouTube
 * - Track playlist changes
 * - Manage playlist items
 */

import { Playlist, PlaylistItem } from '@prisma/client';
import { SyncStatus } from '../../types/enums';
import { db } from '../database/client';
import { getYouTubeClient } from '../../api/client';
import { getQuotaManager } from '../quota/manager';
import { logger } from '../../utils/logger';
import {
  InvalidPlaylistError,
  RecordNotFoundError,
  ConcurrentSyncError,
} from '../../utils/errors';

/**
 * Playlist Manager
 */
export class PlaylistManager {
  private youtubeClient = getYouTubeClient();
  private quotaManager = getQuotaManager();

  /**
   * Import playlist from YouTube
   */
  public async importPlaylist(playlistIdOrUrl: string): Promise<Playlist> {
    const playlistId = this.extractPlaylistId(playlistIdOrUrl);

    // Check if already exists
    const existing = await db.playlist.findUnique({
      where: { youtubeId: playlistId },
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
    const playlist = await db.playlist.create({
      data: {
        youtubeId: playlistId,
        title: ytPlaylist.snippet.title ?? 'Untitled Playlist',
        description: ytPlaylist.snippet.description ?? null,
        channelId: ytPlaylist.snippet.channelId ?? '',
        channelTitle: ytPlaylist.snippet.channelTitle ?? '',
        thumbnailUrl: ytPlaylist.snippet.thumbnails?.default?.url ?? null,
        itemCount: ytPlaylist.contentDetails?.itemCount ?? 0,
        syncStatus: SyncStatus.PENDING,
      },
    });

    logger.info('Playlist imported successfully', {
      playlistId: playlist.id,
      youtubeId: playlist.youtubeId,
      title: playlist.title,
    });

    return playlist;
  }

  /**
   * Get playlist by ID or YouTube ID
   */
  public async getPlaylist(id: string): Promise<Playlist> {
    const playlist = await db.playlist.findFirst({
      where: {
        OR: [{ id }, { youtubeId: id }],
      },
    });

    if (!playlist) {
      throw new RecordNotFoundError('Playlist', id);
    }

    return playlist;
  }

  /**
   * List all playlists
   */
  public async listPlaylists(options: {
    filter?: string;
    sortBy?: 'title' | 'lastSyncedAt' | 'createdAt';
    sortOrder?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
  } = {}): Promise<{ playlists: Playlist[]; total: number }> {
    // Note: SQLite doesn't support mode: 'insensitive', but it's case-insensitive by default
    const where = options.filter
      ? {
          OR: [
            { title: { contains: options.filter } },
            { channelTitle: { contains: options.filter } },
          ],
        }
      : undefined;

    const [playlists, total] = await Promise.all([
      db.playlist.findMany({
        where,
        orderBy: { [options.sortBy ?? 'createdAt']: options.sortOrder ?? 'desc' },
        take: options.limit,
        skip: options.offset,
      }),
      db.playlist.count({ where }),
    ]);

    return { playlists, total };
  }

  /**
   * Update playlist metadata from YouTube
   */
  public async updatePlaylistMetadata(playlistId: string): Promise<Playlist> {
    const playlist = await this.getPlaylist(playlistId);

    // Reserve quota
    await this.quotaManager.reserveQuota('playlist.details', 1);

    // Fetch latest data
    const ytPlaylist = await this.youtubeClient.getPlaylist(playlist.youtubeId);

    if (!ytPlaylist.snippet) {
      throw new InvalidPlaylistError(playlist.youtubeId, { reason: 'Missing snippet data' });
    }

    // Update in database
    const updated = await db.playlist.update({
      where: { id: playlist.id },
      data: {
        title: ytPlaylist.snippet.title ?? playlist.title,
        description: ytPlaylist.snippet.description ?? playlist.description,
        channelTitle: ytPlaylist.snippet.channelTitle ?? playlist.channelTitle,
        thumbnailUrl: ytPlaylist.snippet.thumbnails?.default?.url ?? playlist.thumbnailUrl,
        itemCount: ytPlaylist.contentDetails?.itemCount ?? playlist.itemCount,
        updatedAt: new Date(),
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

    await db.playlist.delete({
      where: { id: playlist.id },
    });

    logger.info('Playlist deleted', { playlistId: playlist.id });
  }

  /**
   * Get playlist with items
   */
  public async getPlaylistWithItems(playlistId: string): Promise<
    Playlist & {
      items: (PlaylistItem & { video: any })[];
    }
  > {
    const playlist = await this.getPlaylist(playlistId);

    const playlistWithItems = await db.playlist.findUnique({
      where: { id: playlist.id },
      include: {
        items: {
          where: { removedAt: null },
          include: { video: true },
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
    await db.playlist.update({
      where: { id: playlistId },
      data: { syncStatus: status },
    });
  }

  /**
   * Check if playlist is being synced
   */
  public async isSyncing(playlistId: string): Promise<boolean> {
    const playlist = await this.getPlaylist(playlistId);
    return playlist.syncStatus === SyncStatus.IN_PROGRESS;
  }

  /**
   * Acquire sync lock
   */
  public async acquireSyncLock(playlistId: string): Promise<void> {
    const playlist = await this.getPlaylist(playlistId);

    if (playlist.syncStatus === SyncStatus.IN_PROGRESS) {
      throw new ConcurrentSyncError(playlistId);
    }

    await this.setSyncStatus(playlist.id, SyncStatus.IN_PROGRESS);
  }

  /**
   * Release sync lock
   */
  public async releaseSyncLock(playlistId: string, status: SyncStatus): Promise<void> {
    await db.playlist.update({
      where: { id: playlistId },
      data: {
        syncStatus: status,
        lastSyncedAt: status === SyncStatus.COMPLETED ? new Date() : undefined,
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

    const history = await db.syncHistory.findMany({
      where: { playlistId: playlist.id },
      orderBy: { startedAt: 'desc' },
    });

    const totalSyncs = history.length;
    const successfulSyncs = history.filter((h) => h.status === SyncStatus.COMPLETED).length;
    const failedSyncs = history.filter((h) => h.status === SyncStatus.FAILED).length;
    const lastSync = history[0]?.startedAt ?? null;

    const completedSyncs = history.filter((h) => h.duration !== null);
    const averageDuration =
      completedSyncs.length > 0
        ? completedSyncs.reduce((sum, h) => sum + (h.duration ?? 0), 0) / completedSyncs.length
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
