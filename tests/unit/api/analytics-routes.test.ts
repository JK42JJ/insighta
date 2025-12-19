/**
 * Analytics API Routes Tests
 *
 * Unit tests for analytics endpoints
 */

import Fastify, { FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';
import type { LearningDashboard, VideoAnalytics, PlaylistAnalytics, SessionOperationResult } from '../../../src/modules/analytics/types';

// Mock analytics tracker
const mockGetLearningDashboard = jest.fn();
const mockGetVideoAnalytics = jest.fn();
const mockGetPlaylistAnalytics = jest.fn();
const mockRecordSession = jest.fn();

jest.mock('../../../src/modules/analytics', () => ({
  getAnalyticsTracker: () => ({
    getLearningDashboard: mockGetLearningDashboard,
    getVideoAnalytics: mockGetVideoAnalytics,
    getPlaylistAnalytics: mockGetPlaylistAnalytics,
    recordSession: mockRecordSession,
  }),
}));

import { analyticsRoutes } from '../../../src/api/routes/analytics';

describe('Analytics API Routes', () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    app = Fastify();

    // Register JWT
    await app.register(jwt, {
      secret: 'test-secret-key-for-analytics-routes-testing',
    });

    // Add authenticate decorator
    app.decorate('authenticate', async function (request: any) {
      try {
        await request.jwtVerify();
      } catch (err) {
        const authError = new Error('Unauthorized') as any;
        authError.statusCode = 401;
        authError.code = 'UNAUTHORIZED';
        throw authError;
      }
    });

    // Add error handler for validation errors and auth errors
    app.setErrorHandler((error: any, request, reply) => {
      const timestamp = new Date().toISOString();
      const path = request.url;

      // Handle authentication errors
      if (error.statusCode === 401 || error.code === 'UNAUTHORIZED') {
        return reply.code(401).send({
          error: { code: 'UNAUTHORIZED', message: 'Invalid token', timestamp, path },
        });
      }
      // Handle Fastify JSON schema validation errors (AJV)
      if (error.validation || error.code === 'FST_ERR_VALIDATION') {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: error.message || 'Request validation failed',
            details: { validation: error.validation },
            timestamp,
            path,
          },
        });
      }
      // Handle Zod validation errors
      if (error.name === 'ZodError' || error.issues) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Validation failed',
            details: { issues: error.issues },
            timestamp,
            path,
          },
        });
      }
      return reply.code(error.statusCode || 500).send({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'Internal server error',
          timestamp,
          path,
        },
      });
    });

    // Register routes
    await app.register(analyticsRoutes, { prefix: '/api/v1/analytics' });

    await app.ready();

    // Generate test token
    token = app.jwt.sign({ userId: 'test-user-id' });

    // Reset mocks
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /api/v1/analytics/dashboard', () => {
    it('should return learning dashboard', async () => {
      const mockDashboard: LearningDashboard = {
        totalVideos: 10,
        totalWatchTime: 3600,
        totalSessions: 15,
        averageSessionDuration: 240,
        completedVideos: 3,
        inProgressVideos: 4,
        notStartedVideos: 3,
        recentActivity: [
          {
            videoId: 'video1',
            videoTitle: 'Test Video 1',
            watchedAt: new Date('2024-01-01T10:00:00Z'),
            duration: 300,
            progress: 75.5,
          },
        ],
        topVideos: [
          {
            videoId: 'video2',
            videoTitle: 'Test Video 2',
            watchTime: 600,
            sessionCount: 5,
            completionRate: 95.5,
          },
        ],
        learningStreak: {
          currentStreak: 5,
          longestStreak: 10,
          lastActiveDate: new Date('2024-01-01T10:00:00Z'),
        },
      };

      mockGetLearningDashboard.mockResolvedValue(mockDashboard);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/analytics/dashboard',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.dashboard).toBeDefined();
      expect(body.dashboard.totalVideos).toBe(10);
      expect(body.dashboard.recentActivity).toHaveLength(1);
      expect(body.dashboard.topVideos).toHaveLength(1);
      expect(body.dashboard.learningStreak.currentStreak).toBe(5);
    });

    it('should require authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/analytics/dashboard',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/analytics/videos/:id', () => {
    it('should return video analytics', async () => {
      const mockAnalytics: VideoAnalytics = {
        videoId: 'test-video-id',
        videoTitle: 'Test Video',
        totalDuration: 600,
        totalWatchTime: 450,
        completionPercentage: 75.5,
        watchCount: 3,
        lastWatchedAt: new Date('2024-01-01T10:00:00Z'),
        firstWatchedAt: new Date('2024-01-01T09:00:00Z'),
        averageSessionDuration: 150,
        rewatchCount: 1,
      };

      mockGetVideoAnalytics.mockResolvedValue(mockAnalytics);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/analytics/videos/test-video-id',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.analytics).toBeDefined();
      expect(body.analytics.videoId).toBe('test-video-id');
      expect(body.analytics.completionPercentage).toBe(75.5);
      expect(mockGetVideoAnalytics).toHaveBeenCalledWith('test-video-id');
    });

    it('should return 404 when video not found', async () => {
      mockGetVideoAnalytics.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/analytics/videos/nonexistent',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VIDEO_NOT_FOUND');
    });

    it('should require authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/analytics/videos/test-video-id',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/analytics/playlists/:id', () => {
    it('should return playlist analytics', async () => {
      const mockAnalytics: PlaylistAnalytics = {
        playlistId: 'test-playlist-id',
        playlistTitle: 'Test Playlist',
        totalVideos: 10,
        watchedVideos: 6,
        completedVideos: 3,
        totalWatchTime: 3600,
        averageCompletion: 55.5,
        lastActivity: new Date('2024-01-01T10:00:00Z'),
        videoAnalytics: [],
      };

      mockGetPlaylistAnalytics.mockResolvedValue(mockAnalytics);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/analytics/playlists/550e8400-e29b-41d4-a716-446655440000',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.analytics).toBeDefined();
      expect(body.analytics.playlistId).toBe('test-playlist-id');
      expect(body.analytics.totalVideos).toBe(10);
      expect(body.analytics.averageCompletion).toBe(55.5);
    });

    it('should return 404 when playlist not found', async () => {
      mockGetPlaylistAnalytics.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/analytics/playlists/550e8400-e29b-41d4-a716-446655440000',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('PLAYLIST_NOT_FOUND');
    });

    it('should validate UUID format', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/analytics/playlists/invalid-uuid',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should require authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/analytics/playlists/550e8400-e29b-41d4-a716-446655440000',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /api/v1/analytics/sessions', () => {
    it('should record watch session', async () => {
      const mockResult: SessionOperationResult = {
        success: true,
        session: {
          id: 'session-id',
          videoId: 'video-id',
          startedAt: new Date('2024-01-01T10:00:00Z'),
          endedAt: new Date('2024-01-01T10:05:00Z'),
          startPos: 0,
          endPos: 300,
          duration: 300,
          createdAt: new Date('2024-01-01T10:05:00Z'),
        },
      };

      mockRecordSession.mockResolvedValue(mockResult);

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/analytics/sessions',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          videoId: 'test-video-id',
          startPosition: 0,
          endPosition: 300,
          startTime: '2024-01-01T10:00:00Z',
          endTime: '2024-01-01T10:05:00Z',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.session).toBeDefined();
      expect(body.session.id).toBe('session-id');
      expect(body.session.duration).toBe(300);
      expect(mockRecordSession).toHaveBeenCalledWith({
        videoId: 'test-video-id',
        startPos: 0,
        endPos: 300,
        startedAt: new Date('2024-01-01T10:00:00Z'),
        endedAt: new Date('2024-01-01T10:05:00Z'),
      });
    });

    it('should handle video not found', async () => {
      mockRecordSession.mockResolvedValue({
        success: false,
        error: 'Video not found',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/analytics/sessions',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          videoId: 'nonexistent',
          startPosition: 0,
          endPosition: 300,
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VIDEO_NOT_FOUND');
    });

    it('should validate required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/analytics/sessions',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          videoId: 'test-video-id',
          // Missing startPosition and endPosition
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should validate position values', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/analytics/sessions',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          videoId: 'test-video-id',
          startPosition: -10, // Invalid negative value
          endPosition: 300,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should require authentication', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/analytics/sessions',
        payload: {
          videoId: 'test-video-id',
          startPosition: 0,
          endPosition: 300,
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
