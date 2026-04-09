/**
 * Sync Engine Module
 *
 * Orchestrates playlist synchronization:
 * - Detect changes (additions, deletions, reordering)
 * - Apply changes incrementally
 * - Track sync history
 * - Handle errors and retries
 */

import { fork } from 'child_process';
import { resolve } from 'path';
import { SyncStatus, SyncHistoryStatus } from '../../types/enums';
import { db } from '../database/client';
import { getPlaylistManager } from '../playlist/manager';
import { getVideoManager } from '../video/manager';
import { getYouTubeClient } from '../../api/client';
import { getQuotaManager } from '../quota/manager';
import { logger, logSyncOperation } from '../../utils/logger';
import { executeTransaction } from '../database/client';
import { getErrorRecoveryManager, RecoveryStrategy } from '../../utils/error-recovery';
import { Tier, DEFAULT_TIER } from '../../config/quota';

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
 *
 * Note: Managers are lazily loaded to avoid initializing at class instantiation time.
 * This is required for serverless environments where credentials may not be available
 * until the actual request is made.
 */
export class SyncEngine {
  // Lazy getters for dependencies - only initialize when actually needed
  private get playlistManager() {
    return getPlaylistManager();
  }
  private get videoManager() {
    return getVideoManager();
  }
  private get youtubeClient() {
    return getYouTubeClient();
  }
  private get quotaManager() {
    return getQuotaManager();
  }
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

      // Load user's OAuth credentials before sync
      await this.ensureOAuthCredentials(playlist.user_id);

      // Acquire sync lock
      await this.playlistManager.acquireSyncLock(playlist.id);

      logSyncOperation(playlist.id, 'started', {
        youtubeId: playlist.youtube_playlist_id,
        title: playlist.title,
      });

      // Record sync history start
      const syncHistory = await db.youtube_sync_history.create({
        data: {
          playlist_id: playlist.id,
          status: SyncHistoryStatus.STARTED,
          started_at: new Date(),
        },
      });

      try {
        // Fetch playlist items from YouTube
        const { items: allYtItems, quotaCost } = await this.fetchPlaylistItems(
          playlist.youtube_playlist_id
        );
        quotaUsed += quotaCost;

        // Free-tier cutoff: only sync items published after channel subscription date.
        // Pro/lifetime/admin: no cutoff (full historical sync).
        const userTier = await this.resolveUserTier(playlist.user_id);
        const ytItems = this.applyTierSyncFilter(allYtItems, playlist.created_at, userTier);

        if (allYtItems.length !== ytItems.length) {
          logger.info('Free-tier sync cutoff applied', {
            playlistId,
            total: allYtItems.length,
            afterCutoff: ytItems.length,
            cutoffDate: playlist.created_at.toISOString(),
          });
        }

        // Fetch video details
        const videoIds = ytItems
          .map((item: any) => item.snippet?.resourceId?.videoId)
          .filter(Boolean) as string[];
        const { videos, quotaCost: videosQuotaCost } = await this.fetchVideos(videoIds);
        quotaUsed += videosQuotaCost;

        // Store videos
        await this.videoManager.upsertVideos(videos);

        // Get current state from database
        const currentItems = await db.youtube_playlist_items.findMany({
          where: {
            playlist_id: playlist.id,
            removed_at: null,
          },
          include: { youtube_videos: true },
        });

        // Detect changes
        const changes = await this.detectChanges(playlist.id, currentItems, ytItems);

        // Apply changes in transaction
        await executeTransaction(async (tx) => {
          // Remove items
          for (const item of changes.removed) {
            await tx.youtube_playlist_items.update({
              where: { id: item.id },
              data: { removed_at: new Date() },
            });
            itemsRemoved++;
          }

          // Add new items
          for (const ytItem of changes.added) {
            const videoId = ytItem.snippet?.resourceId?.videoId;
            if (!videoId) continue;

            const video = await tx.youtube_videos.findUnique({
              where: { youtube_video_id: videoId },
            });

            if (!video) continue;

            await tx.youtube_playlist_items.create({
              data: {
                playlist_id: playlist.id,
                video_id: video.id,
                position: ytItem.snippet?.position ?? 0,
                added_at: ytItem.snippet?.publishedAt
                  ? new Date(ytItem.snippet.publishedAt)
                  : new Date(),
              },
            });
            itemsAdded++;
          }

          // Update positions
          for (const { item, newPosition } of changes.reordered) {
            await tx.youtube_playlist_items.update({
              where: { id: item.id },
              data: { position: newPosition },
            });
            itemsReordered++;
          }

          // Update playlist metadata
          await tx.youtube_playlists.update({
            where: { id: playlist.id },
            data: {
              item_count: ytItems.length,
              last_synced_at: new Date(),
            },
          });

          // Create user_video_states for all playlist videos (ideation cards)
          const allPlaylistItems = await tx.youtube_playlist_items.findMany({
            where: { playlist_id: playlist.id, removed_at: null },
            select: { video_id: true },
          });
          const allVideoIds = allPlaylistItems.map((item) => item.video_id);

          if (allVideoIds.length > 0) {
            const existingStates = await tx.userVideoState.findMany({
              where: {
                user_id: playlist.user_id,
                videoId: { in: allVideoIds },
              },
              select: { videoId: true },
            });
            const existingVideoIds = new Set(existingStates.map((s) => s.videoId));

            const newStates = allVideoIds
              .filter((vid) => !existingVideoIds.has(vid))
              .map((vid, idx) => ({
                user_id: playlist.user_id,
                videoId: vid,
                is_in_ideation: true,
                sort_order: idx,
              }));

            if (newStates.length > 0) {
              await tx.userVideoState.createMany({ data: newStates });
              logger.info('Created user_video_states', {
                playlistId: playlist.id,
                count: newStates.length,
              });
            }
          }
        });

        // Update sync history
        const duration = Date.now() - startTime;
        await db.youtube_sync_history.update({
          where: { id: syncHistory.id },
          data: {
            status: SyncHistoryStatus.COMPLETED,
            completed_at: new Date(),
            items_added: itemsAdded,
            items_removed: itemsRemoved,
            quota_used: quotaUsed,
          },
        });

        // Release lock
        await this.playlistManager.releaseSyncLock(playlist.id, SyncStatus.COMPLETED);

        // Trigger async enrichment for newly synced videos
        if (itemsAdded > 0) {
          const newVideoIds = changes.added
            .map((ytItem: any) => ytItem.snippet?.resourceId?.videoId)
            .filter(Boolean) as string[];
          this.triggerAsyncEnrichment(newVideoIds);
        }

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
        await db.youtube_sync_history.update({
          where: { id: syncHistory.id },
          data: {
            status: SyncHistoryStatus.FAILED,
            completed_at: new Date(),
            error_message: error instanceof Error ? error.message : String(error),
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

        const MAX_PLAYLIST_ITEMS = 500;
        const items = await this.youtubeClient.getPlaylistItems(playlistId, MAX_PLAYLIST_ITEMS);

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
      currentItems.map((item) => [item.youtube_videos.youtube_video_id, item])
    );

    const ytMap = new Map(ytItems.map((item: any) => [item.snippet?.resourceId?.videoId, item]));

    // Find added items (in YouTube but not in DB)
    const added = ytItems.filter(
      (ytItem: any) => !currentMap.has(ytItem.snippet?.resourceId?.videoId)
    );

    // Find removed items (in DB but not in YouTube)
    const removed = currentItems.filter((item) => !ytMap.has(item.youtube_videos.youtube_video_id));

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
   * Resolve user's subscription tier from DB.
   * Falls back to 'free' if no subscription exists.
   */
  private async resolveUserTier(userId: string): Promise<Tier> {
    try {
      const sub = await db.user_subscriptions.findUnique({
        where: { user_id: userId },
        select: { tier: true },
      });
      return (sub?.tier as Tier) ?? DEFAULT_TIER;
    } catch {
      return DEFAULT_TIER;
    }
  }

  /**
   * For free-tier users, filter YouTube items to only include videos published
   * after the playlist/channel subscription date. Pro+ gets full history.
   */
  private applyTierSyncFilter(items: any[], subscriptionDate: Date, tier: Tier): any[] {
    if (tier !== 'free') return items;

    return items.filter((item: any) => {
      const publishedAt = item.snippet?.publishedAt;
      if (!publishedAt) return true; // keep items without date (safety)
      return new Date(publishedAt) >= subscriptionDate;
    });
  }

  /**
   * Load OAuth credentials from youtube_sync_settings and set on YouTubeClient.
   * Required for private playlists and channel uploads (API key only works for public data).
   */
  private async ensureOAuthCredentials(userId: string): Promise<void> {
    try {
      const settings = await db.youtube_sync_settings.findUnique({
        where: { user_id: userId },
      });

      if (!settings?.youtube_access_token) {
        logger.warn('No OAuth credentials for user, sync may fail for private data', { userId });
        return;
      }

      this.youtubeClient.setCredentials({
        access_token: settings.youtube_access_token,
        refresh_token: settings.youtube_refresh_token,
        expiry_date: settings.youtube_token_expires_at?.getTime() ?? null,
      });

      logger.debug('OAuth credentials loaded for sync', { userId });
    } catch (error) {
      logger.warn('Failed to load OAuth credentials (continuing with API key)', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
   * Sync all playlists for a specific user.
   * If userId is omitted (CLI/admin), syncs all playlists in the system.
   */
  public async syncAll(userId?: string): Promise<SyncResult[]> {
    const { playlists } = await this.playlistManager.listPlaylists(userId ? { userId } : {});
    return this.syncPlaylists(playlists.map((p) => p.id));
  }

  private triggerAsyncEnrichment(youtubeVideoIds: string[]): void {
    if (youtubeVideoIds.length === 0) return;

    const workerPath = resolve(__dirname, '../ontology/enrich-worker.js');
    try {
      const child = fork(workerPath, [], {
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        detached: true,
      });
      child.send({ limit: youtubeVideoIds.length, delayMs: 2000 });
      child.unref();
      logger.info('Async enrichment triggered for synced videos', {
        count: youtubeVideoIds.length,
      });
    } catch (err) {
      logger.warn('Failed to spawn enrichment worker', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
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
