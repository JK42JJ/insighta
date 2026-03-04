/**
 * Video Manager Module
 *
 * Manages video operations:
 * - Store video metadata
 * - Update video statistics
 * - Manage user video state (watch status, notes, etc.)
 * - Handle duplicates
 */

import { youtube_videos, UserVideoState } from '@prisma/client';
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
  public async upsertVideo(ytVideo: youtube_v3.Schema$Video): Promise<youtube_videos> {
    if (!ytVideo.id || !ytVideo.snippet || !ytVideo.contentDetails) {
      throw new Error('Invalid video data: missing required fields');
    }

    const videoData = {
      youtube_video_id: ytVideo.id,
      title: ytVideo.snippet.title ?? 'Untitled Video',
      description: ytVideo.snippet.description ?? null,
      channel_title: ytVideo.snippet.channelTitle ?? '',
      published_at: ytVideo.snippet.publishedAt
        ? new Date(ytVideo.snippet.publishedAt)
        : new Date(),
      duration_seconds: this.parseDuration(ytVideo.contentDetails.duration ?? 'PT0S'),
      thumbnail_url: ytVideo.snippet.thumbnails?.default?.url ?? null,
      view_count: ytVideo.statistics?.viewCount ? BigInt(ytVideo.statistics.viewCount) : null,
      like_count: ytVideo.statistics?.likeCount ? BigInt(ytVideo.statistics.likeCount) : null,
    };

    const video = await db.youtube_videos.upsert({
      where: { youtube_video_id: ytVideo.id },
      create: videoData,
      update: videoData,
    });

    return video;
  }

  /**
   * Batch upsert videos
   */
  public async upsertVideos(ytVideos: youtube_v3.Schema$Video[]): Promise<youtube_videos[]> {
    const videos: youtube_videos[] = [];

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
  public async fetchAndStoreVideos(videoIds: string[]): Promise<youtube_videos[]> {
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
  public async getVideo(id: string): Promise<youtube_videos> {
    const video = await db.youtube_videos.findFirst({
      where: {
        OR: [{ id }, { youtube_video_id: id }],
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
  public async getVideoWithState(
    videoId: string,
    userId: string
  ): Promise<youtube_videos & { userState: UserVideoState | null }> {
    const video = await this.getVideo(videoId);

    const videoWithState = await db.youtube_videos.findUnique({
      where: { id: video.id },
      include: {
        userState: {
          where: { user_id: userId },
        },
      },
    });

    if (!videoWithState) {
      throw new RecordNotFoundError('Video', videoId);
    }

    return {
      ...videoWithState,
      userState: videoWithState.userState[0] ?? null,
    };
  }

  /**
   * Update user video state
   */
  public async updateUserState(
    videoId: string,
    userId: string,
    data: {
      watchStatus?: WatchStatus;
      lastPosition?: number;
      notes?: string;
      isWatched?: boolean;
    }
  ): Promise<UserVideoState> {
    const video = await this.getVideo(videoId);

    const state = await db.userVideoState.upsert({
      where: { user_id_videoId: { user_id: userId, videoId: video.id } },
      create: {
        user_id: userId,
        videoId: video.id,
        is_watched: data.isWatched ?? (data.watchStatus === WatchStatus.COMPLETED),
        watch_position_seconds: data.lastPosition ?? 0,
        user_note: data.notes ?? null,
      },
      update: {
        is_watched: data.isWatched ?? (data.watchStatus === WatchStatus.COMPLETED ? true : undefined),
        watch_position_seconds: data.lastPosition,
        user_note: data.notes,
      },
    });

    logger.info('User video state updated', { videoId: video.id, userId });

    return state;
  }

  /**
   * Mark video as watched
   */
  public async markAsWatched(videoId: string, userId: string, position?: number): Promise<UserVideoState> {
    return this.updateUserState(videoId, userId, {
      watchStatus: WatchStatus.COMPLETED,
      lastPosition: position,
      isWatched: true,
    });
  }

  /**
   * Update watch progress
   */
  public async updateProgress(videoId: string, userId: string, position: number): Promise<UserVideoState> {
    return this.updateUserState(videoId, userId, {
      watchStatus: WatchStatus.WATCHING,
      lastPosition: position,
    });
  }

  /**
   * Add notes to video
   */
  public async addNotes(videoId: string, userId: string, notes: string): Promise<UserVideoState> {
    return this.updateUserState(videoId, userId, { notes });
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
        youtube_video_id: string;
        title: string;
        count: bigint;
      }>
    >`
      SELECT
        v.youtube_video_id,
        v.title,
        COUNT(DISTINCT pi.playlist_id) as count
      FROM youtube_videos v
      INNER JOIN youtube_playlist_items pi ON v.id = pi.video_id
      WHERE pi.removed_at IS NULL
      GROUP BY v.youtube_video_id, v.title
      HAVING COUNT(DISTINCT pi.playlist_id) > 1
      ORDER BY count DESC
    `;

    const result = [];

    for (const dup of duplicates) {
      const video = await db.youtube_videos.findUnique({
        where: { youtube_video_id: dup.youtube_video_id },
        include: {
          youtube_playlist_items: {
            where: { removed_at: null },
            include: { youtube_playlists: true },
          },
        },
      });

      if (video) {
        result.push({
          youtubeId: dup.youtube_video_id,
          title: dup.title,
          count: Number(dup.count),
          playlists: video.youtube_playlist_items.map((pi) => pi.youtube_playlists.title ?? ''),
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
  public async updateVideoStats(videoId: string): Promise<youtube_videos> {
    const video = await this.getVideo(videoId);

    // Reserve quota
    await this.quotaManager.reserveQuota('video.details', 1);

    // Fetch from YouTube
    const ytVideos = await this.youtubeClient.getVideos([video.youtube_video_id]);

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
