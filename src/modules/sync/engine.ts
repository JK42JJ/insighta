/**
 * Sync Engine Module
 *
 * Orchestrates playlist synchronization:
 * - Detect changes (additions, deletions, reordering)
 * - Apply changes incrementally
 * - Track sync history
 * - Handle errors and retries
 */

import { SyncStatus } from '../../types/enums';
import { db } from '../database/client';
import { getPlaylistManager } from '../playlist/manager';
import { getVideoManager } from '../video/manager';
import { getYouTubeClient } from '../../api/client';
import { getQuotaManager } from '../quota/manager';
import { logger, logSyncOperation } from '../../utils/logger';
import { executeTransaction } from '../database/client';
import { getErrorRecoveryManager, RecoveryStrategy } from '../../utils/error-recovery';

/**
 * Sync result
 */
export interface SyncResult {
  playlistId: string;
  status: SyncStatus;
  itemsAdded: number;
  itemsRemoved: number;
  itemsReordered: number;
  duration: number;
  quotaUsed: number;
  error?: string;
  recoveryAttempts?: number;
  recoveryStrategy?: RecoveryStrategy;
  recoveryTime?: number;
}

/**
 * Sync Engine
 */
export class SyncEngine {
  private playlistManager = getPlaylistManager();
  private videoManager = getVideoManager();
  private youtubeClient = getYouTubeClient();
  private quotaManager = getQuotaManager();
  private recoveryManager = getErrorRecoveryManager({
    maxRetries: 5,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    enableCircuitBreaker: true,
    onRecoveryAttempt: (attempt, error, strategy) => {
      logger.info('Recovery attempt', {
        attempt,
        error: error.message,
        strategy,
      });
    },
    onRecoverySuccess: (result) => {
      logger.info('Recovery successful', {
        attemptsUsed: result.attemptsUsed,
        recoveryTime: result.recoveryTime,
      });
    },
    onRecoveryFailure: (result) => {
      logger.error('Recovery failed', {
        attemptsUsed: result.attemptsUsed,
        error: result.error?.message,
      });
    },
  });

  /**
   * Sync playlist with YouTube
   */
  public async syncPlaylist(playlistId: string): Promise<SyncResult> {
    const startTime = Date.now();
    let quotaUsed = 0;
    let itemsAdded = 0;
    let itemsRemoved = 0;
    let itemsReordered = 0;

    try {
      // Get playlist
      const playlist = await this.playlistManager.getPlaylist(playlistId);

      // Acquire sync lock
      await this.playlistManager.acquireSyncLock(playlist.id);

      logSyncOperation(playlist.id, 'started', {
        youtubeId: playlist.youtubeId,
        title: playlist.title,
      });

      // Record sync history start
      const syncHistory = await db.syncHistory.create({
        data: {
          playlistId: playlist.id,
          status: SyncStatus.IN_PROGRESS,
          startedAt: new Date(),
        },
      });

      try {
        // Fetch playlist items from YouTube
        const { items: ytItems, quotaCost } = await this.fetchPlaylistItems(playlist.youtubeId);
        quotaUsed += quotaCost;

        // Fetch video details
        const videoIds = ytItems.map((item) => item.snippet?.resourceId?.videoId).filter(Boolean) as string[];
        const { videos, quotaCost: videosQuotaCost } = await this.fetchVideos(videoIds);
        quotaUsed += videosQuotaCost;

        // Store videos
        await this.videoManager.upsertVideos(videos);

        // Get current state from database
        const currentItems = await db.playlistItem.findMany({
          where: {
            playlistId: playlist.id,
            removedAt: null,
          },
          include: { video: true },
        });

        // Detect changes
        const changes = await this.detectChanges(playlist.id, currentItems, ytItems);

        // Apply changes in transaction
        await executeTransaction(async (tx) => {
          // Remove items
          for (const item of changes.removed) {
            await tx.playlistItem.update({
              where: { id: item.id },
              data: { removedAt: new Date() },
            });
            itemsRemoved++;
          }

          // Add new items
          for (const ytItem of changes.added) {
            const videoId = ytItem.snippet?.resourceId?.videoId;
            if (!videoId) continue;

            const video = await tx.video.findUnique({
              where: { youtubeId: videoId },
            });

            if (!video) continue;

            await tx.playlistItem.create({
              data: {
                playlistId: playlist.id,
                videoId: video.id,
                position: ytItem.snippet?.position ?? 0,
                addedAt: ytItem.snippet?.publishedAt
                  ? new Date(ytItem.snippet.publishedAt)
                  : new Date(),
              },
            });
            itemsAdded++;
          }

          // Update positions
          for (const { item, newPosition } of changes.reordered) {
            await tx.playlistItem.update({
              where: { id: item.id },
              data: { position: newPosition },
            });
            itemsReordered++;
          }

          // Update playlist metadata
          await tx.playlist.update({
            where: { id: playlist.id },
            data: {
              itemCount: ytItems.length,
              lastSyncedAt: new Date(),
            },
          });
        });

        // Update sync history
        const duration = Date.now() - startTime;
        await db.syncHistory.update({
          where: { id: syncHistory.id },
          data: {
            status: SyncStatus.COMPLETED,
            completedAt: new Date(),
            duration,
            itemsAdded,
            itemsRemoved,
            itemsReordered,
            quotaUsed,
          },
        });

        // Release lock
        await this.playlistManager.releaseSyncLock(playlist.id, SyncStatus.COMPLETED);

        logSyncOperation(playlist.id, 'completed', {
          itemsAdded,
          itemsRemoved,
          itemsReordered,
          duration,
        });

        return {
          playlistId: playlist.id,
          status: SyncStatus.COMPLETED,
          itemsAdded,
          itemsRemoved,
          itemsReordered,
          duration,
          quotaUsed,
        };
      } catch (error) {
        // Update sync history with error
        await db.syncHistory.update({
          where: { id: syncHistory.id },
          data: {
            status: SyncStatus.FAILED,
            completedAt: new Date(),
            duration: Date.now() - startTime,
            errorMessage: error instanceof Error ? error.message : String(error),
          },
        });

        // Release lock
        await this.playlistManager.releaseSyncLock(playlist.id, SyncStatus.FAILED);

        throw error;
      }
    } catch (error) {
      logSyncOperation(playlistId, 'failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        playlistId,
        status: SyncStatus.FAILED,
        itemsAdded,
        itemsRemoved,
        itemsReordered,
        duration: Date.now() - startTime,
        quotaUsed,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Fetch playlist items from YouTube
   */
  private async fetchPlaylistItems(playlistId: string): Promise<{
    items: any[];
    quotaCost: number;
  }> {
    const result = await this.recoveryManager.executeWithRecovery(
      async () => {
        // Reserve quota
        const quotaCost = this.quotaManager.getOperationCost({
          type: 'playlist.items',
          itemCount: 50, // Initial estimate
        });
        await this.quotaManager.reserveQuota('playlist.items', quotaCost);

        // Fetch items
        const items = await this.youtubeClient.getPlaylistItems(playlistId);

        logger.debug('Fetched playlist items', {
          playlistId,
          count: items.length,
          quotaCost,
        });

        return { items, quotaCost };
      },
      { playlistId, operation: 'fetchPlaylistItems' }
    );

    if (!result.success || !result.data) {
      throw result.error || new Error('Failed to fetch playlist items');
    }

    return result.data;
  }

  /**
   * Fetch videos from YouTube
   */
  private async fetchVideos(videoIds: string[]): Promise<{
    videos: any[];
    quotaCost: number;
  }> {
    if (videoIds.length === 0) {
      return { videos: [], quotaCost: 0 };
    }

    const result = await this.recoveryManager.executeWithRecovery(
      async () => {
        // Reserve quota
        const quotaCost = this.quotaManager.getOperationCost({
          type: 'video.details',
          itemCount: videoIds.length,
        });
        await this.quotaManager.reserveQuota('video.details', quotaCost);

        // Fetch videos
        const videos = await this.youtubeClient.getVideosBatch(videoIds);

        logger.debug('Fetched videos', {
          count: videos.length,
          quotaCost,
        });

        return { videos, quotaCost };
      },
      { videoCount: videoIds.length, operation: 'fetchVideos' }
    );

    if (!result.success || !result.data) {
      throw result.error || new Error('Failed to fetch videos');
    }

    return result.data;
  }

  /**
   * Detect changes between current and YouTube state
   */
  private async detectChanges(
    playlistId: string,
    currentItems: any[],
    ytItems: any[]
  ): Promise<{
    added: any[];
    removed: any[];
    reordered: Array<{ item: any; newPosition: number }>;
  }> {
    const currentMap = new Map(
      currentItems.map((item) => [item.video.youtubeId, item])
    );

    const ytMap = new Map(
      ytItems.map((item) => [item.snippet?.resourceId?.videoId, item])
    );

    // Find added items (in YouTube but not in DB)
    const added = ytItems.filter(
      (ytItem) => !currentMap.has(ytItem.snippet?.resourceId?.videoId)
    );

    // Find removed items (in DB but not in YouTube)
    const removed = currentItems.filter(
      (item) => !ytMap.has(item.video.youtubeId)
    );

    // Find reordered items
    const reordered: Array<{ item: any; newPosition: number }> = [];
    for (const [youtubeId, ytItem] of ytMap) {
      const currentItem = currentMap.get(youtubeId);
      const newPosition = ytItem.snippet?.position ?? 0;

      if (currentItem && currentItem.position !== newPosition) {
        reordered.push({ item: currentItem, newPosition });
      }
    }

    logger.debug('Changes detected', {
      playlistId,
      added: added.length,
      removed: removed.length,
      reordered: reordered.length,
    });

    return { added, removed, reordered };
  }

  /**
   * Sync multiple playlists
   */
  public async syncPlaylists(playlistIds: string[]): Promise<SyncResult[]> {
    const results: SyncResult[] = [];

    for (const playlistId of playlistIds) {
      try {
        const result = await this.syncPlaylist(playlistId);
        results.push(result);
      } catch (error) {
        logger.error('Failed to sync playlist', {
          playlistId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  /**
   * Sync all playlists
   */
  public async syncAll(): Promise<SyncResult[]> {
    const { playlists } = await this.playlistManager.listPlaylists();
    return this.syncPlaylists(playlists.map((p) => p.id));
  }
}

/**
 * Singleton instance
 */
let engineInstance: SyncEngine | null = null;

/**
 * Get sync engine instance
 */
export function getSyncEngine(): SyncEngine {
  if (!engineInstance) {
    engineInstance = new SyncEngine();
  }
  return engineInstance;
}

export default getSyncEngine;
