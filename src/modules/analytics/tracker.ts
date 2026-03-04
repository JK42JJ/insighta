/**
 * Analytics Tracker
 *
 * Tracks watch sessions and calculates learning analytics
 */

import { getPrismaClient } from '../database';
import { logger } from '../../utils/logger';
import type {
  WatchSession,
  CreateSessionInput,
  VideoAnalytics,
  PlaylistAnalytics,
  LearningDashboard,
  RetentionMetrics,
  SessionOperationResult,
  RecentActivity,
  TopVideo,
  LearningStreak,
} from './types';

/**
 * Analytics Tracker Service
 */
export class AnalyticsTracker {
  private db = getPrismaClient();

  /**
   * Record a watch session
   */
  public async recordSession(input: CreateSessionInput): Promise<SessionOperationResult> {
    try {
      logger.info('Recording watch session', { videoId: input.videoId });

      // Verify video exists
      const video = await this.db.youtube_videos.findUnique({
        where: { youtube_video_id: input.videoId },
      });

      if (!video) {
        return {
          success: false,
          error: 'Video not found in database',
        };
      }

      // Calculate duration
      const startedAt = input.startedAt || new Date();
      const endedAt = input.endedAt || new Date();
      const duration = Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000);

      // Create session
      const session = await this.db.watch_sessions.create({
        data: {
          video_id: video.id,
          started_at: startedAt,
          ended_at: endedAt,
          start_pos: input.startPos,
          end_pos: input.endPos,
          duration,
        },
      });

      logger.info('Watch session recorded', { sessionId: session.id });

      return {
        success: true,
        session: this.mapToWatchSession(session),
      };
    } catch (error) {
      logger.error('Failed to record session', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get analytics for a specific video
   */
  public async getVideoAnalytics(videoId: string): Promise<VideoAnalytics | null> {
    try {
      const video = await this.db.youtube_videos.findUnique({
        where: { youtube_video_id: videoId },
        include: {
          watch_sessions: {
            orderBy: { started_at: 'asc' },
          },
        },
      });

      if (!video) {
        return null;
      }

      const sessions = video.watch_sessions;
      const videoDuration = video.duration_seconds ?? 0;

      if (sessions.length === 0) {
        return {
          videoId,
          videoTitle: video.title,
          totalDuration: videoDuration,
          totalWatchTime: 0,
          completionPercentage: 0,
          watchCount: 0,
          lastWatchedAt: null,
          firstWatchedAt: null,
          averageSessionDuration: 0,
          rewatchCount: 0,
        };
      }

      // Calculate metrics
      const totalWatchTime = sessions.reduce((sum, s) => sum + s.duration, 0);
      const maxPosition = Math.max(...sessions.map((s) => s.end_pos));
      const completionPercentage =
        videoDuration > 0 ? Math.min(100, (maxPosition / videoDuration) * 100) : 0;
      const averageSessionDuration = totalWatchTime / sessions.length;

      // Count rewatches (sessions after reaching 80% completion)
      const completionThreshold = videoDuration * 0.8;
      const firstCompleteIndex = sessions.findIndex((s) => s.end_pos >= completionThreshold);
      const rewatchCount = firstCompleteIndex >= 0 ? sessions.length - firstCompleteIndex - 1 : 0;

      return {
        videoId,
        videoTitle: video.title,
        totalDuration: videoDuration,
        totalWatchTime,
        completionPercentage: Math.round(completionPercentage * 100) / 100,
        watchCount: sessions.length,
        lastWatchedAt: sessions[sessions.length - 1]!.started_at,
        firstWatchedAt: sessions[0]!.started_at,
        averageSessionDuration: Math.round(averageSessionDuration),
        rewatchCount,
      };
    } catch (error) {
      logger.error('Failed to get video analytics', { videoId, error });
      return null;
    }
  }

  /**
   * Get analytics for a playlist
   */
  public async getPlaylistAnalytics(playlistId: string): Promise<PlaylistAnalytics | null> {
    try {
      const playlist = await this.db.youtube_playlists.findFirst({
        where: {
          OR: [{ id: playlistId }, { youtube_playlist_id: playlistId }],
        },
        include: {
          youtube_playlist_items: {
            where: { removed_at: null },
            include: {
              youtube_videos: {
                include: {
                  watch_sessions: true,
                },
              },
            },
          },
        },
      });

      if (!playlist) {
        return null;
      }

      const videos = playlist.youtube_playlist_items.map((item) => item.youtube_videos);
      const totalVideos = videos.length;

      if (totalVideos === 0) {
        return {
          playlistId,
          playlistTitle: playlist.title ?? '',
          totalVideos: 0,
          watchedVideos: 0,
          completedVideos: 0,
          totalWatchTime: 0,
          averageCompletion: 0,
          lastActivity: null,
          videoAnalytics: [],
        };
      }

      // Calculate video analytics
      const videoAnalyticsList: VideoAnalytics[] = [];
      let totalWatchTime = 0;
      let totalCompletion = 0;
      let watchedVideos = 0;
      let completedVideos = 0;
      let lastActivity: Date | null = null;

      for (const video of videos) {
        const analytics = await this.getVideoAnalytics(video.youtube_video_id);
        if (analytics) {
          videoAnalyticsList.push(analytics);
          totalWatchTime += analytics.totalWatchTime;
          totalCompletion += analytics.completionPercentage;

          if (analytics.watchCount > 0) {
            watchedVideos++;
          }

          if (analytics.completionPercentage >= 80) {
            completedVideos++;
          }

          if (analytics.lastWatchedAt) {
            if (!lastActivity || analytics.lastWatchedAt > lastActivity) {
              lastActivity = analytics.lastWatchedAt;
            }
          }
        }
      }

      return {
        playlistId,
        playlistTitle: playlist.title ?? '',
        totalVideos,
        watchedVideos,
        completedVideos,
        totalWatchTime,
        averageCompletion: Math.round((totalCompletion / totalVideos) * 100) / 100,
        lastActivity,
        videoAnalytics: videoAnalyticsList,
      };
    } catch (error) {
      logger.error('Failed to get playlist analytics', { playlistId, error });
      return null;
    }
  }

  /**
   * Get learning dashboard with overall statistics
   */
  public async getLearningDashboard(): Promise<LearningDashboard> {
    try {
      // Get all videos with sessions
      const videos = await this.db.youtube_videos.findMany({
        include: {
          watch_sessions: {
            orderBy: { started_at: 'desc' },
          },
        },
      });

      const totalVideos = videos.length;
      let totalWatchTime = 0;
      let totalSessions = 0;
      let completedVideos = 0;
      let inProgressVideos = 0;
      let notStartedVideos = 0;

      const recentActivityList: RecentActivity[] = [];
      const topVideosList: TopVideo[] = [];

      for (const video of videos) {
        const sessions = video.watch_sessions;
        const sessionCount = sessions.length;
        totalSessions += sessionCount;
        const videoDuration = video.duration_seconds ?? 0;

        if (sessionCount === 0) {
          notStartedVideos++;
          continue;
        }

        const watchTime = sessions.reduce((sum, s) => sum + s.duration, 0);
        totalWatchTime += watchTime;

        const maxPosition = Math.max(...sessions.map((s) => s.end_pos));
        const completion = videoDuration > 0 ? (maxPosition / videoDuration) * 100 : 0;

        if (completion >= 80) {
          completedVideos++;
        } else {
          inProgressVideos++;
        }

        // Add to top videos
        topVideosList.push({
          videoId: video.youtube_video_id,
          videoTitle: video.title,
          watchTime,
          sessionCount,
          completionRate: Math.round(completion * 100) / 100,
        });

        // Add recent activity (last 10 sessions across all videos)
        if (recentActivityList.length < 10 && sessions.length > 0) {
          const lastSession = sessions[0]!;
          recentActivityList.push({
            videoId: video.youtube_video_id,
            videoTitle: video.title,
            watchedAt: lastSession.started_at,
            duration: lastSession.duration,
            progress: Math.round(completion * 100) / 100,
          });
        }
      }

      // Sort and limit top videos
      topVideosList.sort((a, b) => b.watchTime - a.watchTime);
      const topVideos = topVideosList.slice(0, 10);

      // Sort recent activity by date
      recentActivityList.sort((a, b) => b.watchedAt.getTime() - a.watchedAt.getTime());

      // Calculate learning streak
      const learningStreak = await this.calculateLearningStreak();

      const averageSessionDuration = totalSessions > 0 ? totalWatchTime / totalSessions : 0;

      return {
        totalVideos,
        totalWatchTime,
        totalSessions,
        averageSessionDuration: Math.round(averageSessionDuration),
        completedVideos,
        inProgressVideos,
        notStartedVideos,
        recentActivity: recentActivityList,
        topVideos,
        learningStreak,
      };
    } catch (error) {
      logger.error('Failed to get learning dashboard', { error });
      return {
        totalVideos: 0,
        totalWatchTime: 0,
        totalSessions: 0,
        averageSessionDuration: 0,
        completedVideos: 0,
        inProgressVideos: 0,
        notStartedVideos: 0,
        recentActivity: [],
        topVideos: [],
        learningStreak: {
          currentStreak: 0,
          longestStreak: 0,
          lastActiveDate: null,
        },
      };
    }
  }

  /**
   * Calculate retention metrics for a video
   */
  public async getRetentionMetrics(videoId: string): Promise<RetentionMetrics | null> {
    try {
      const analytics = await this.getVideoAnalytics(videoId);
      if (!analytics) {
        return null;
      }

      // Determine difficulty based on rewatch patterns
      let difficulty: 'easy' | 'medium' | 'hard';
      if (analytics.rewatchCount === 0) {
        difficulty = 'easy';
      } else if (analytics.rewatchCount <= 2) {
        difficulty = 'medium';
      } else {
        difficulty = 'hard';
      }

      // Calculate retention score (0-100)
      const completionFactor = analytics.completionPercentage / 100;
      const rewatchPenalty = Math.max(0, 1 - analytics.rewatchCount * 0.15);
      const retentionScore = Math.round(completionFactor * rewatchPenalty * 100);

      // Recommend review date based on retention score
      let recommendedReviewDate: Date | null = null;
      if (analytics.lastWatchedAt && analytics.completionPercentage >= 50) {
        const daysUntilReview =
          retentionScore >= 80 ? 30 : retentionScore >= 60 ? 14 : retentionScore >= 40 ? 7 : 3;

        recommendedReviewDate = new Date(analytics.lastWatchedAt);
        recommendedReviewDate.setDate(recommendedReviewDate.getDate() + daysUntilReview);
      }

      return {
        videoId,
        videoTitle: analytics.videoTitle,
        difficulty,
        retentionScore,
        recommendedReviewDate,
        lastReviewedAt: analytics.lastWatchedAt,
        reviewCount: analytics.rewatchCount,
      };
    } catch (error) {
      logger.error('Failed to get retention metrics', { videoId, error });
      return null;
    }
  }

  /**
   * Calculate learning streak
   */
  private async calculateLearningStreak(): Promise<LearningStreak> {
    try {
      // Get all sessions ordered by date
      const sessions = await this.db.watch_sessions.findMany({
        orderBy: { started_at: 'desc' },
      });

      if (sessions.length === 0) {
        return {
          currentStreak: 0,
          longestStreak: 0,
          lastActiveDate: null,
        };
      }

      // Group sessions by date
      const dateMap = new Map<string, boolean>();
      for (const session of sessions) {
        const dateStr = session.started_at.toISOString().split('T')[0]!;
        dateMap.set(dateStr, true);
      }

      const dates = Array.from(dateMap.keys()).sort().reverse();
      const lastActiveDate = new Date(dates[0]!);

      // Calculate current streak
      let currentStreak = 0;
      const today = new Date().toISOString().split('T')[0]!;
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0]!;

      // Current streak starts from today or yesterday
      if (dates[0] === today || dates[0] === yesterdayStr) {
        currentStreak = 1;
        let currentDate = new Date(dates[0]);

        for (let i = 1; i < dates.length; i++) {
          const prevDate = new Date(currentDate);
          prevDate.setDate(prevDate.getDate() - 1);
          const prevDateStr = prevDate.toISOString().split('T')[0]!;

          if (dates[i] === prevDateStr) {
            currentStreak++;
            currentDate = new Date(dates[i]!);
          } else {
            break;
          }
        }
      }

      // Calculate longest streak
      let longestStreak = 1;
      let tempStreak = 1;

      for (let i = 1; i < dates.length; i++) {
        const currentDate = new Date(dates[i]!);
        const prevDate = new Date(dates[i - 1]!);
        const diffDays = Math.floor(
          (prevDate.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24)
        );

        if (diffDays === 1) {
          tempStreak++;
          longestStreak = Math.max(longestStreak, tempStreak);
        } else {
          tempStreak = 1;
        }
      }

      return {
        currentStreak,
        longestStreak,
        lastActiveDate,
      };
    } catch (error) {
      logger.error('Failed to calculate learning streak', { error });
      return {
        currentStreak: 0,
        longestStreak: 0,
        lastActiveDate: null,
      };
    }
  }

  /**
   * Delete a watch session
   */
  public async deleteSession(sessionId: string): Promise<SessionOperationResult> {
    try {
      await this.db.watch_sessions.delete({
        where: { id: sessionId },
      });

      logger.info('Watch session deleted', { sessionId });

      return {
        success: true,
      };
    } catch (error) {
      logger.error('Failed to delete session', { sessionId, error });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get all sessions for a video
   */
  public async getVideoSessions(videoId: string): Promise<WatchSession[]> {
    try {
      const video = await this.db.youtube_videos.findUnique({
        where: { youtube_video_id: videoId },
        include: {
          watch_sessions: {
            orderBy: { started_at: 'desc' },
          },
        },
      });

      if (!video) {
        return [];
      }

      return video.watch_sessions.map((s) => this.mapToWatchSession(s));
    } catch (error) {
      logger.error('Failed to get video sessions', { videoId, error });
      return [];
    }
  }

  /**
   * Map database session to WatchSession type
   */
  private mapToWatchSession(session: any): WatchSession {
    return {
      id: session.id,
      videoId: session.video_id,
      startedAt: session.started_at,
      endedAt: session.ended_at,
      startPos: session.start_pos,
      endPos: session.end_pos,
      duration: session.duration,
      createdAt: session.created_at,
    };
  }
}

/**
 * Singleton instance
 */
let trackerInstance: AnalyticsTracker | null = null;

/**
 * Get analytics tracker instance
 */
export function getAnalyticsTracker(): AnalyticsTracker {
  if (!trackerInstance) {
    trackerInstance = new AnalyticsTracker();
  }
  return trackerInstance;
}

export default getAnalyticsTracker;
