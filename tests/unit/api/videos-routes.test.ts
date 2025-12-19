/**
 * Videos API Routes Unit Tests
 */

import Fastify, { FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';

// Mock dependencies
const mockGetVideo = jest.fn();
const mockGetVideoWithState = jest.fn();
const mockExtractCaptions = jest.fn();
const mockGetAvailableLanguages = jest.fn();
const mockAddSummary = jest.fn();
const mockFindMany = jest.fn();
const mockCount = jest.fn();

jest.mock('../../../src/modules/video', () => ({
  getVideoManager: () => ({
    getVideo: mockGetVideo,
    getVideoWithState: mockGetVideoWithState,
    addSummary: mockAddSummary,
  }),
}));

jest.mock('../../../src/modules/caption/extractor', () => ({
  getCaptionExtractor: () => ({
    extractCaptions: mockExtractCaptions,
    getAvailableLanguages: mockGetAvailableLanguages,
  }),
}));

jest.mock('../../../src/modules/database', () => ({
  getPrismaClient: () => ({
    video: {
      findMany: mockFindMany,
      count: mockCount,
    },
  }),
}));

import { videoRoutes } from '../../../src/api/routes/videos';

describe('Videos API Routes', () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    app = Fastify();

    // Register JWT
    await app.register(jwt, {
      secret: 'test-secret-key-for-videos-routes-testing',
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

    // Add error handler
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
    await app.register(videoRoutes, { prefix: '/api/v1/videos' });

    await app.ready();

    // Generate test token
    token = app.jwt.sign({ userId: 'test-user-id' });

    // Reset mocks
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /api/v1/videos', () => {
    test('should list videos successfully', async () => {
      const mockVideos = [
        {
          id: '123e4567-e89b-12d3-a456-426614174000',
          youtubeId: 'test123',
          title: 'Test Video',
          description: 'Test Description',
          channelId: 'channel123',
          channelTitle: 'Test Channel',
          duration: 300,
          thumbnailUrls: '{}',
          viewCount: 1000,
          likeCount: 100,
          commentCount: 10,
          publishedAt: new Date('2024-01-01'),
          tags: null,
          categoryId: null,
          language: 'en',
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
      ];

      // Mock Prisma calls
      mockFindMany.mockResolvedValue(mockVideos);
      mockCount.mockResolvedValue(1);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/videos',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.videos).toHaveLength(1);
      expect(body.total).toBe(1);
      expect(body.page).toBe(1);
      expect(body.limit).toBe(20);
    });

    test('should filter videos by playlistId', async () => {
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/videos?playlistId=123e4567-e89b-12d3-a456-426614174000',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            playlistItems: expect.any(Object),
          }),
        })
      );
    });

    test('should require authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/videos',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/videos/:id', () => {
    test('should get video details with user state', async () => {
      const mockVideo = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        youtubeId: 'test123',
        title: 'Test Video',
        description: 'Test Description',
        channelId: 'channel123',
        channelTitle: 'Test Channel',
        duration: 300,
        thumbnailUrls: '{}',
        viewCount: 1000,
        likeCount: 100,
        commentCount: 10,
        publishedAt: new Date('2024-01-01'),
        tags: null,
        categoryId: null,
        language: 'en',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
        userState: {
          watchStatus: 'WATCHING',
          lastPosition: 120,
          watchCount: 1,
          notes: null,
          summary: null,
          tags: null,
          rating: null,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
      };

      mockGetVideoWithState.mockResolvedValue(mockVideo);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/videos/123e4567-e89b-12d3-a456-426614174000',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.video.id).toBe(mockVideo.id);
      expect(body.video.userState).toBeDefined();
      expect(body.video.userState.watchStatus).toBe('WATCHING');
    });

    test('should return 500 for non-existent video', async () => {
      mockGetVideoWithState.mockRejectedValue(new Error('Video not found'));

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/videos/123e4567-e89b-12d3-a456-426614174000',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('GET /api/v1/videos/:id/captions', () => {
    test('should get video captions', async () => {
      const mockVideo = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        youtubeId: 'test123',
      };

      const mockCaption = {
        videoId: 'test123',
        language: 'en',
        fullText: 'This is a test caption',
        segments: [
          { text: 'This is', start: 0, duration: 1 },
          { text: 'a test', start: 1, duration: 1 },
          { text: 'caption', start: 2, duration: 1 },
        ],
      };

      mockGetVideo.mockResolvedValue(mockVideo);
      mockExtractCaptions.mockResolvedValue({
        success: true,
        videoId: 'test123',
        language: 'en',
        caption: mockCaption,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/videos/123e4567-e89b-12d3-a456-426614174000/captions',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.caption.fullText).toBe('This is a test caption');
      expect(body.caption.segments).toHaveLength(3);
    });

    test('should support language parameter', async () => {
      const mockVideo = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        youtubeId: 'test123',
      };

      mockGetVideo.mockResolvedValue(mockVideo);
      mockExtractCaptions.mockResolvedValue({
        success: true,
        videoId: 'test123',
        language: 'ko',
        caption: {
          videoId: 'test123',
          language: 'ko',
          fullText: 'Korean caption',
          segments: [],
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/videos/123e4567-e89b-12d3-a456-426614174000/captions?language=ko',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockExtractCaptions).toHaveBeenCalledWith('test123', 'ko');
    });

    test('should return 404 when captions not found', async () => {
      const mockVideo = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        youtubeId: 'test123',
      };

      mockGetVideo.mockResolvedValue(mockVideo);
      mockExtractCaptions.mockResolvedValue({
        success: false,
        videoId: 'test123',
        language: 'en',
        error: 'No captions found',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/videos/123e4567-e89b-12d3-a456-426614174000/captions',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /api/v1/videos/:id/captions/languages', () => {
    test('should get available caption languages', async () => {
      const mockVideo = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        youtubeId: 'test123',
      };

      mockGetVideo.mockResolvedValue(mockVideo);
      mockGetAvailableLanguages.mockResolvedValue({
        videoId: 'test123',
        languages: ['en', 'ko', 'ja'],
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/videos/123e4567-e89b-12d3-a456-426614174000/captions/languages',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.languages).toEqual(['en', 'ko', 'ja']);
    });
  });

  describe('GET /api/v1/videos/:id/summary', () => {
    test('should get existing summary', async () => {
      const mockVideo = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        youtubeId: 'test123',
        userState: {
          summary: 'This is a test summary',
          updatedAt: new Date('2024-01-01'),
        },
      };

      mockGetVideoWithState.mockResolvedValue(mockVideo);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/videos/123e4567-e89b-12d3-a456-426614174000/summary',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.summary.summary).toBe('This is a test summary');
    });

    test('should return 404 when summary not found', async () => {
      const mockVideo = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        youtubeId: 'test123',
        userState: null,
      };

      mockGetVideoWithState.mockResolvedValue(mockVideo);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/videos/123e4567-e89b-12d3-a456-426614174000/summary',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /api/v1/videos/:id/summary', () => {
    test('should generate summary from captions', async () => {
      const mockVideo = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        youtubeId: 'test123',
      };

      const mockCaption = {
        videoId: 'test123',
        language: 'en',
        fullText: 'This is a long test caption with many words that will be summarized'.repeat(10),
        segments: [],
      };

      mockGetVideo.mockResolvedValue(mockVideo);
      mockExtractCaptions.mockResolvedValue({
        success: true,
        videoId: 'test123',
        language: 'en',
        caption: mockCaption,
      });
      mockAddSummary.mockResolvedValue({});

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/videos/123e4567-e89b-12d3-a456-426614174000/summary',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          level: 'brief',
          language: 'en',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.summary.summary).toBeDefined();
      expect(body.summary.level).toBe('brief');
      expect(mockAddSummary).toHaveBeenCalled();
    });

    test('should return 404 when captions not available', async () => {
      const mockVideo = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        youtubeId: 'test123',
      };

      mockGetVideo.mockResolvedValue(mockVideo);
      mockExtractCaptions.mockResolvedValue({
        success: false,
        videoId: 'test123',
        language: 'en',
        error: 'No captions found',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/videos/123e4567-e89b-12d3-a456-426614174000/summary',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          level: 'brief',
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
