/**
 * Video Manager Module
 *
 * Manages video operations:
 * - Store video metadata
 * - Update video statistics
 * - Manage user video state (watch status, notes, etc.)
 * - Handle duplicates
 */

import { Video, UserVideoState } from '@prisma/client';
import { WatchStatus } from '../../types/enums';
import { db } from '../database/client';
import { getYouTubeClient } from '../../api/client';
import { getQuotaManager } from '../quota/manager';
import { logger } from '../../utils/logger';
import { RecordNotFoundError } from '../../utils/errors';
import { youtube_v3 } from 'googleapis';

/**
 * Video Manager
 *
 * Note: YouTube client and quota manager are lazily loaded to avoid
 * initializing at class instantiation time. This is required for
 * serverless environments where credentials may not be available
 * until the actual request is made.
 */
export class VideoManager {
  // Lazy getters for dependencies - only initialize when actually needed
  private get youtubeClient() {
    return getYouTubeClient();
  }
  private get quotaManager() {
    return getQuotaManager();
  }

  /**
   * Create or update video from YouTube data
   */
  public async upsertVideo(ytVideo: youtube_v3.Schema$Video): Promise<Video> {
    if (!ytVideo.id || !ytVideo.snippet || !ytVideo.contentDetails) {
      throw new Error('Invalid video data: missing required fields');
    }

    const videoData = {
      youtubeId: ytVideo.id,
      title: ytVideo.snippet.title ?? 'Untitled Video',
      description: ytVideo.snippet.description ?? null,
      channelId: ytVideo.snippet.channelId ?? '',
      channelTitle: ytVideo.snippet.channelTitle ?? '',
      publishedAt: ytVideo.snippet.publishedAt
        ? new Date(ytVideo.snippet.publishedAt)
        : new Date(),
      duration: this.parseDuration(ytVideo.contentDetails.duration ?? 'PT0S'),
      thumbnailUrls: JSON.stringify(ytVideo.snippet.thumbnails ?? {}),
      viewCount: parseInt(ytVideo.statistics?.viewCount ?? '0', 10),
      likeCount: parseInt(ytVideo.statistics?.likeCount ?? '0', 10),
      commentCount: parseInt(ytVideo.statistics?.commentCount ?? '0', 10),
      tags: ytVideo.snippet.tags ? JSON.stringify(ytVideo.snippet.tags) : null,
      categoryId: ytVideo.snippet.categoryId ?? null,
      language: ytVideo.snippet.defaultLanguage ?? ytVideo.snippet.defaultAudioLanguage ?? null,
    };

    const video = await db.video.upsert({
      where: { youtubeId: ytVideo.id },
      create: videoData,
      update: videoData,
    });

    return video;
  }

  /**
   * Batch upsert videos
   */
  public async upsertVideos(ytVideos: youtube_v3.Schema$Video[]): Promise<Video[]> {
    const videos: Video[] = [];

    for (const ytVideo of ytVideos) {
      try {
        const video = await this.upsertVideo(ytVideo);
        videos.push(video);
      } catch (error) {
        logger.error('Failed to upsert video', {
          videoId: ytVideo.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return videos;
  }

  /**
   * Fetch and store videos from YouTube
   */
  public async fetchAndStoreVideos(videoIds: string[]): Promise<Video[]> {
    if (videoIds.length === 0) {
      return [];
    }

    // Reserve quota
    const quotaCost = this.quotaManager.getOperationCost({
      type: 'video.details',
      itemCount: videoIds.length,
    });
    await this.quotaManager.reserveQuota('video.details', quotaCost);

    // Fetch from YouTube
    const ytVideos = await this.youtubeClient.getVideosBatch(videoIds);

    // Store in database
    return this.upsertVideos(ytVideos);
  }

  /**
   * Get video by ID or YouTube ID
   */
  public async getVideo(id: string): Promise<Video> {
    const video = await db.video.findFirst({
      where: {
        OR: [{ id }, { youtubeId: id }],
      },
    });

    if (!video) {
      throw new RecordNotFoundError('Video', id);
    }

    return video;
  }

  /**
   * Get video with user state
   */
  public async getVideoWithState(videoId: string): Promise<
    Video & {
      userState: UserVideoState | null;
    }
  > {
    const video = await this.getVideo(videoId);

    const videoWithState = await db.video.findUnique({
      where: { id: video.id },
      include: { userState: true },
    });

    if (!videoWithState) {
      throw new RecordNotFoundError('Video', videoId);
    }

    return videoWithState;
  }

  /**
   * Update user video state
   */
  public async updateUserState(
    videoId: string,
    data: {
      watchStatus?: WatchStatus;
      lastPosition?: number;
      notes?: string;
      summary?: string;
      tags?: string[];
      rating?: number;
    }
  ): Promise<UserVideoState> {
    const video = await this.getVideo(videoId);

    const state = await db.userVideoState.upsert({
      where: { videoId: video.id },
      create: {
        videoId: video.id,
        watchStatus: data.watchStatus ?? WatchStatus.UNWATCHED,
        lastPosition: data.lastPosition ?? 0,
        watchCount: data.watchStatus === WatchStatus.COMPLETED ? 1 : 0,
        notes: data.notes ?? null,
        summary: data.summary ?? null,
        tags: data.tags ? JSON.stringify(data.tags) : null,
        rating: data.rating ?? null,
      },
      update: {
        watchStatus: data.watchStatus,
        lastPosition: data.lastPosition,
        watchCount: data.watchStatus === WatchStatus.COMPLETED ? { increment: 1 } : undefined,
        notes: data.notes,
        summary: data.summary,
        tags: data.tags ? JSON.stringify(data.tags) : undefined,
        rating: data.rating,
      },
    });

    logger.info('User video state updated', { videoId: video.id });

    return state;
  }

  /**
   * Mark video as watched
   */
  public async markAsWatched(videoId: string, position?: number): Promise<UserVideoState> {
    return this.updateUserState(videoId, {
      watchStatus: WatchStatus.COMPLETED,
      lastPosition: position,
    });
  }

  /**
   * Update watch progress
   */
  public async updateProgress(videoId: string, position: number): Promise<UserVideoState> {
    return this.updateUserState(videoId, {
      watchStatus: WatchStatus.WATCHING,
      lastPosition: position,
    });
  }

  /**
   * Add notes to video
   */
  public async addNotes(videoId: string, notes: string): Promise<UserVideoState> {
    return this.updateUserState(videoId, { notes });
  }

  /**
   * Add summary to video
   */
  public async addSummary(videoId: string, summary: string): Promise<UserVideoState> {
    return this.updateUserState(videoId, { summary });
  }

  /**
   * Rate video
   */
  public async rateVideo(videoId: string, rating: number): Promise<UserVideoState> {
    if (rating < 1 || rating > 5) {
      throw new Error('Rating must be between 1 and 5');
    }
    return this.updateUserState(videoId, { rating });
  }

  /**
   * Find duplicate videos across playlists
   */
  public async findDuplicates(): Promise<
    Array<{
      youtubeId: string;
      title: string;
      count: number;
      playlists: string[];
    }>
  > {
    const duplicates = await db.$queryRaw<
      Array<{
        youtubeId: string;
        title: string;
        count: bigint;
      }>
    >`
      SELECT
        v.youtube_id as "youtubeId",
        v.title,
        COUNT(DISTINCT pi.playlist_id) as count
      FROM videos v
      INNER JOIN playlist_items pi ON v.id = pi.video_id
      WHERE pi.removed_at IS NULL
      GROUP BY v.youtube_id, v.title
      HAVING COUNT(DISTINCT pi.playlist_id) > 1
      ORDER BY count DESC
    `;

    const result = [];

    for (const dup of duplicates) {
      const video = await db.video.findUnique({
        where: { youtubeId: dup.youtubeId },
        include: {
          playlistItems: {
            where: { removedAt: null },
            include: { playlist: true },
          },
        },
      });

      if (video) {
        result.push({
          youtubeId: dup.youtubeId,
          title: dup.title,
          count: Number(dup.count),
          playlists: video.playlistItems.map((pi) => pi.playlist.title),
        });
      }
    }

    return result;
  }

  /**
   * Parse ISO 8601 duration to seconds
   */
  private parseDuration(duration: string): number {
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) {
      return 0;
    }

    const hours = parseInt(match[1] ?? '0', 10);
    const minutes = parseInt(match[2] ?? '0', 10);
    const seconds = parseInt(match[3] ?? '0', 10);

    return hours * 3600 + minutes * 60 + seconds;
  }

  /**
   * Update video statistics from YouTube
   */
  public async updateVideoStats(videoId: string): Promise<Video> {
    const video = await this.getVideo(videoId);

    // Reserve quota
    await this.quotaManager.reserveQuota('video.details', 1);

    // Fetch from YouTube
    const ytVideos = await this.youtubeClient.getVideos([video.youtubeId]);

    if (ytVideos.length === 0) {
      throw new RecordNotFoundError('Video', videoId);
    }

    // Update in database
    return this.upsertVideo(ytVideos[0]!);
  }
}

/**
 * Singleton instance
 */
let managerInstance: VideoManager | null = null;

/**
 * Get video manager instance
 */
export function getVideoManager(): VideoManager {
  if (!managerInstance) {
    managerInstance = new VideoManager();
  }
  return managerInstance;
}

export default getVideoManager;
