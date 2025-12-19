/**
 * Analytics API Routes
 *
 * REST API endpoints for learning analytics and progress tracking
 */

import { FastifyPluginCallback } from 'fastify';
import { getAnalyticsTracker } from '../../modules/analytics';
import {
  GetVideoAnalyticsParamsSchema,
  GetPlaylistAnalyticsParamsSchema,
  RecordSessionRequestSchema,
  getDashboardSchema,
  getVideoAnalyticsSchema,
  getPlaylistAnalyticsSchema,
  recordSessionSchema,
  type GetVideoAnalyticsParams,
  type GetPlaylistAnalyticsParams,
  type RecordSessionRequest,
  type DashboardResponse,
  type VideoAnalyticsResponse,
  type PlaylistAnalyticsResponse,
  type WatchSessionResponse,
} from '../schemas/analytics.schema';
import { logger } from '../../utils/logger';

/**
 * Analytics routes plugin
 */
export const analyticsRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  const analyticsTracker = getAnalyticsTracker();

  /**
   * GET /api/v1/analytics/dashboard - Learning dashboard
   */
  fastify.get<{ Reply: { dashboard: DashboardResponse } }>(
    '/dashboard',
    {
      schema: getDashboardSchema,
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      // Type guard for authenticated user
      if (!request.user || !('userId' in request.user)) {
        throw new Error('Unauthorized');
      }

      logger.info('Getting learning dashboard', { userId: request.user.userId });

      const dashboard = await analyticsTracker.getLearningDashboard();

      const response: DashboardResponse = {
        totalVideos: dashboard.totalVideos,
        totalWatchTime: dashboard.totalWatchTime,
        totalSessions: dashboard.totalSessions,
        averageSessionDuration: dashboard.averageSessionDuration,
        completedVideos: dashboard.completedVideos,
        inProgressVideos: dashboard.inProgressVideos,
        notStartedVideos: dashboard.notStartedVideos,
        recentActivity: dashboard.recentActivity.map((activity) => ({
          videoId: activity.videoId,
          videoTitle: activity.videoTitle,
          watchedAt: activity.watchedAt.toISOString(),
          duration: activity.duration,
          progress: activity.progress,
        })),
        topVideos: dashboard.topVideos.map((video) => ({
          videoId: video.videoId,
          videoTitle: video.videoTitle,
          watchTime: video.watchTime,
          sessionCount: video.sessionCount,
          completionRate: video.completionRate,
        })),
        learningStreak: {
          currentStreak: dashboard.learningStreak.currentStreak,
          longestStreak: dashboard.learningStreak.longestStreak,
          lastActiveDate: dashboard.learningStreak.lastActiveDate?.toISOString() ?? null,
        },
      };

      return reply.code(200).send({ dashboard: response });
    }
  );

  /**
   * GET /api/v1/analytics/videos/:id - Video analytics
   */
  fastify.get<{ Params: GetVideoAnalyticsParams; Reply: { analytics: VideoAnalyticsResponse } | { error: unknown } }>(
    '/videos/:id',
    {
      schema: getVideoAnalyticsSchema,
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      // Type guard for authenticated user
      if (!request.user || !('userId' in request.user)) {
        throw new Error('Unauthorized');
      }

      const validatedParams = GetVideoAnalyticsParamsSchema.parse(request.params);
      const { id } = validatedParams;

      logger.info('Getting video analytics', { videoId: id, userId: request.user.userId });

      const analytics = await analyticsTracker.getVideoAnalytics(id);

      if (!analytics) {
        return reply.code(404).send({
          error: {
            code: 'VIDEO_NOT_FOUND',
            message: 'Video not found or no analytics available',
            timestamp: new Date().toISOString(),
            path: request.url,
          },
        });
      }

      const response: VideoAnalyticsResponse = {
        videoId: analytics.videoId,
        videoTitle: analytics.videoTitle,
        totalDuration: analytics.totalDuration,
        totalWatchTime: analytics.totalWatchTime,
        completionPercentage: analytics.completionPercentage,
        watchCount: analytics.watchCount,
        lastWatchedAt: analytics.lastWatchedAt?.toISOString() ?? null,
        firstWatchedAt: analytics.firstWatchedAt?.toISOString() ?? null,
        averageSessionDuration: analytics.averageSessionDuration,
        rewatchCount: analytics.rewatchCount,
      };

      return reply.code(200).send({ analytics: response });
    }
  );

  /**
   * GET /api/v1/analytics/playlists/:id - Playlist analytics
   */
  fastify.get<{ Params: GetPlaylistAnalyticsParams; Reply: { analytics: PlaylistAnalyticsResponse } | { error: unknown } }>(
    '/playlists/:id',
    {
      schema: getPlaylistAnalyticsSchema,
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      // Type guard for authenticated user
      if (!request.user || !('userId' in request.user)) {
        throw new Error('Unauthorized');
      }

      const validatedParams = GetPlaylistAnalyticsParamsSchema.parse(request.params);
      const { id } = validatedParams;

      logger.info('Getting playlist analytics', { playlistId: id, userId: request.user.userId });

      const analytics = await analyticsTracker.getPlaylistAnalytics(id);

      if (!analytics) {
        return reply.code(404).send({
          error: {
            code: 'PLAYLIST_NOT_FOUND',
            message: 'Playlist not found or no analytics available',
            timestamp: new Date().toISOString(),
            path: request.url,
          },
        });
      }

      const response: PlaylistAnalyticsResponse = {
        playlistId: analytics.playlistId,
        playlistTitle: analytics.playlistTitle,
        totalVideos: analytics.totalVideos,
        watchedVideos: analytics.watchedVideos,
        completedVideos: analytics.completedVideos,
        totalWatchTime: analytics.totalWatchTime,
        averageCompletion: analytics.averageCompletion,
        lastActivity: analytics.lastActivity?.toISOString() ?? null,
      };

      return reply.code(200).send({ analytics: response });
    }
  );

  /**
   * POST /api/v1/analytics/sessions - Record watch session
   */
  fastify.post<{ Body: RecordSessionRequest; Reply: { session: WatchSessionResponse } | { error: unknown } }>(
    '/sessions',
    {
      schema: recordSessionSchema,
      onRequest: [fastify.authenticate],
    },
    async (request, reply) => {
      // Type guard for authenticated user
      if (!request.user || !('userId' in request.user)) {
        throw new Error('Unauthorized');
      }

      const validatedData = RecordSessionRequestSchema.parse(request.body);

      logger.info('Recording watch session', {
        videoId: validatedData.videoId,
        userId: request.user.userId,
      });

      const result = await analyticsTracker.recordSession({
        videoId: validatedData.videoId,
        startPos: validatedData.startPosition,
        endPos: validatedData.endPosition,
        startedAt: validatedData.startTime ? new Date(validatedData.startTime) : undefined,
        endedAt: validatedData.endTime ? new Date(validatedData.endTime) : undefined,
      });

      if (!result.success || !result.session) {
        return reply.code(404).send({
          error: {
            code: 'VIDEO_NOT_FOUND',
            message: result.error || 'Failed to record session',
            timestamp: new Date().toISOString(),
            path: request.url,
          },
        });
      }

      const response: WatchSessionResponse = {
        id: result.session.id,
        videoId: result.session.videoId,
        startedAt: result.session.startedAt.toISOString(),
        endedAt: result.session.endedAt.toISOString(),
        startPos: result.session.startPos,
        endPos: result.session.endPos,
        duration: result.session.duration,
        createdAt: result.session.createdAt.toISOString(),
      };

      logger.info('Watch session recorded successfully', { sessionId: result.session.id });

      return reply.code(200).send({ session: response });
    }
  );

  fastify.log.info('Analytics routes registered');

  done();
};

export default analyticsRoutes;
