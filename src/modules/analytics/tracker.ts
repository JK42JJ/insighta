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
      const video = await this.db.video.findUnique({
        where: { youtubeId: input.videoId },
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
      const session = await this.db.watchSession.create({
        data: {
          videoId: video.id,
          startedAt,
          endedAt,
          startPos: input.startPos,
          endPos: input.endPos,
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
      const video = await this.db.video.findUnique({
        where: { youtubeId: videoId },
        include: {
          watchSessions: {
            orderBy: { startedAt: 'asc' },
          },
        },
      });

      if (!video) {
        return null;
      }

      const sessions = video.watchSessions;

      if (sessions.length === 0) {
        return {
          videoId,
          videoTitle: video.title,
          totalDuration: video.duration,
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
      const maxPosition = Math.max(...sessions.map(s => s.endPos));
      const completionPercentage = Math.min(100, (maxPosition / video.duration) * 100);
      const averageSessionDuration = totalWatchTime / sessions.length;

      // Count rewatches (sessions after reaching 80% completion)
      const completionThreshold = video.duration * 0.8;
      const firstCompleteIndex = sessions.findIndex(s => s.endPos >= completionThreshold);
      const rewatchCount =
        firstCompleteIndex >= 0 ? sessions.length - firstCompleteIndex - 1 : 0;

      return {
        videoId,
        videoTitle: video.title,
        totalDuration: video.duration,
        totalWatchTime,
        completionPercentage: Math.round(completionPercentage * 100) / 100,
        watchCount: sessions.length,
        lastWatchedAt: sessions[sessions.length - 1]!.startedAt,
        firstWatchedAt: sessions[0]!.startedAt,
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
      const playlist = await this.db.playlist.findFirst({
        where: {
          OR: [{ id: playlistId }, { youtubeId: playlistId }],
        },
        include: {
          items: {
            where: { removedAt: null },
            include: {
              video: {
                include: {
                  watchSessions: true,
                },
              },
            },
          },
        },
      });

      if (!playlist) {
        return null;
      }

      const videos = playlist.items.map(item => item.video);
      const totalVideos = videos.length;

      if (totalVideos === 0) {
        return {
          playlistId,
          playlistTitle: playlist.title,
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
        const analytics = await this.getVideoAnalytics(video.youtubeId);
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
        playlistTitle: playlist.title,
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
      const videos = await this.db.video.findMany({
        include: {
          watchSessions: {
            orderBy: { startedAt: 'desc' },
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
        const sessions = video.watchSessions;
        const sessionCount = sessions.length;
        totalSessions += sessionCount;

        if (sessionCount === 0) {
          notStartedVideos++;
          continue;
        }

        const watchTime = sessions.reduce((sum, s) => sum + s.duration, 0);
        totalWatchTime += watchTime;

        const maxPosition = Math.max(...sessions.map(s => s.endPos));
        const completion = (maxPosition / video.duration) * 100;

        if (completion >= 80) {
          completedVideos++;
        } else {
          inProgressVideos++;
        }

        // Add to top videos
        topVideosList.push({
          videoId: video.youtubeId,
          videoTitle: video.title,
          watchTime,
          sessionCount,
          completionRate: Math.round(completion * 100) / 100,
        });

        // Add recent activity (last 10 sessions across all videos)
        if (recentActivityList.length < 10 && sessions.length > 0) {
          const lastSession = sessions[0]!;
          recentActivityList.push({
            videoId: video.youtubeId,
            videoTitle: video.title,
            watchedAt: lastSession.startedAt,
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
      // Higher score = better retention (fewer rewatches needed, higher completion)
      const completionFactor = analytics.completionPercentage / 100;
      const rewatchPenalty = Math.max(0, 1 - analytics.rewatchCount * 0.15);
      const retentionScore = Math.round(completionFactor * rewatchPenalty * 100);

      // Recommend review date based on retention score
      // Higher retention = longer interval before review
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
      const sessions = await this.db.watchSession.findMany({
        orderBy: { startedAt: 'desc' },
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
        const dateStr = session.startedAt.toISOString().split('T')[0]!;
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
        let currentDate = new Date(dates[0]!);

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
      await this.db.watchSession.delete({
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
      const video = await this.db.video.findUnique({
        where: { youtubeId: videoId },
        include: {
          watchSessions: {
            orderBy: { startedAt: 'desc' },
          },
        },
      });

      if (!video) {
        return [];
      }

      return video.watchSessions.map(s => this.mapToWatchSession(s));
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
      videoId: session.videoId,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      startPos: session.startPos,
      endPos: session.endPos,
      duration: session.duration,
      createdAt: session.createdAt,
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
