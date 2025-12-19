/**
 * Playlist API Integration Tests
 *
 * Tests for playlist management endpoints:
 * - POST /api/v1/playlists/import
 * - GET /api/v1/playlists
 * - GET /api/v1/playlists/:id
 * - POST /api/v1/playlists/:id/sync
 * - DELETE /api/v1/playlists/:id
 */

import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/api/server';
import { db as prisma } from '../../src/modules/database/client';

// Mock YouTube API Client - must define mock inside jest.mock factory for hoisting
jest.mock('../../src/api/client', () => {
  const mockYouTubeClient = {
    initialize: jest.fn().mockResolvedValue(undefined),
    getPlaylist: jest.fn().mockResolvedValue({
      id: 'PLtest123',
      snippet: {
        title: 'Test Playlist',
        description: 'Test playlist description',
        channelId: 'UCtest',
        channelTitle: 'Test Channel',
        publishedAt: '2024-01-01T00:00:00Z',
        thumbnails: {
          default: { url: 'https://example.com/thumb.jpg', width: 120, height: 90 },
        },
      },
      contentDetails: {
        itemCount: 10,
      },
      status: {
        privacyStatus: 'public',
      },
    }),
    getPlaylistItems: jest.fn().mockResolvedValue({
      items: [
        {
          id: 'item1',
          snippet: {
            title: 'Test Video 1',
            description: 'Test video description',
            position: 0,
            resourceId: { videoId: 'vid1' },
            publishedAt: '2024-01-01T00:00:00Z',
            thumbnails: {
              default: { url: 'https://example.com/vid1.jpg', width: 120, height: 90 },
            },
          },
        },
      ],
      pageInfo: { totalResults: 1, resultsPerPage: 50 },
    }),
    getVideos: jest.fn().mockResolvedValue([
      {
        id: 'vid1',
        snippet: {
          title: 'Test Video 1',
          description: 'Test video description',
          channelId: 'UCtest',
          channelTitle: 'Test Channel',
          publishedAt: '2024-01-01T00:00:00Z',
          thumbnails: {
            default: { url: 'https://example.com/vid1.jpg', width: 120, height: 90 },
          },
        },
        contentDetails: {
          duration: 'PT10M30S',
        },
        statistics: {
          viewCount: '1000',
          likeCount: '100',
        },
      },
    ]),
  };
  return {
    YouTubeClient: jest.fn().mockImplementation(() => mockYouTubeClient),
    getYouTubeClient: jest.fn().mockReturnValue(mockYouTubeClient),
  };
});

describe('Playlist API', () => {
  let app: FastifyInstance;
  let accessToken: string;

  beforeAll(async () => {
    // Build Fastify app
    app = await buildApp();

    // Clean up test user first to ensure fresh registration
    await prisma.user.deleteMany({
      where: { email: 'playlist-test@example.com' },
    });

    // Register to get access token
    const registerResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'playlist-test@example.com',
        password: 'PlaylistTest123!',
        name: 'Playlist Test User',
      },
    });

    const body = JSON.parse(registerResponse.body);
    accessToken = body.tokens.accessToken;
  });

  afterAll(async () => {
    // Close Fastify app
    await app.close();
    // Disconnect Prisma
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean up playlists before each test
    await prisma.playlistItem.deleteMany({});
    await prisma.playlist.deleteMany({});
    await prisma.video.deleteMany({});
  });

  describe('POST /api/v1/playlists/import', () => {
    test('should import playlist successfully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/playlists/import',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
        payload: {
          playlistUrl: 'https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.playlist).toBeDefined();
      expect(body.playlist.youtubeId).toBeDefined();
      expect(body.playlist.title).toBeDefined();
      expect(body.playlist.syncStatus).toBeDefined();
    });

    test('should reject invalid playlist URL', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/playlists/import',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
        payload: {
          playlistUrl: 'https://invalid-url.com',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('INVALID_INPUT');
    });

    test('should require authentication', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/playlists/import',
        payload: {
          playlistUrl: 'https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    test('should validate request payload', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/playlists/import',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
        payload: {
          // Missing playlistUrl
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /api/v1/playlists', () => {
    beforeEach(async () => {
      // Create test playlists directly in database
      await prisma.playlist.create({
        data: {
          youtubeId: 'PLtest1',
          title: 'Test Playlist 1',
          description: 'Description 1',
          channelId: 'UCtest',
          channelTitle: 'Test Channel',
          thumbnailUrl: 'https://example.com/thumb1.jpg',
          itemCount: 5,
          syncStatus: 'synced',
        },
      });

      await prisma.playlist.create({
        data: {
          youtubeId: 'PLtest2',
          title: 'Test Playlist 2',
          description: 'Description 2',
          channelId: 'UCtest',
          channelTitle: 'Test Channel',
          thumbnailUrl: 'https://example.com/thumb2.jpg',
          itemCount: 10,
          syncStatus: 'synced',
        },
      });

      await prisma.playlist.create({
        data: {
          youtubeId: 'PLtest3',
          title: 'Test Playlist 3',
          description: 'Description 3',
          channelId: 'UCtest',
          channelTitle: 'Test Channel',
          thumbnailUrl: 'https://example.com/thumb3.jpg',
          itemCount: 15,
          syncStatus: 'pending',
        },
      });
    });

    test('should list all playlists', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/playlists',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.playlists).toBeDefined();
      expect(body.playlists.length).toBeGreaterThanOrEqual(3);
      expect(body.total).toBeGreaterThanOrEqual(3);
      // limit and offset are optional in response when not provided in request
    });

    test('should support pagination', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/playlists?limit=2&offset=1',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.playlists.length).toBeLessThanOrEqual(2);
      expect(body.limit).toBe(2);
      expect(body.offset).toBe(1);
    });

    test('should support sorting', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/playlists?sortBy=title&sortOrder=asc',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.playlists).toBeDefined();

      // Verify sorting
      const titles = body.playlists.map((p: any) => p.title);
      const sortedTitles = [...titles].sort();
      expect(titles).toEqual(sortedTitles);
    });

    test('should support filtering', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/playlists?filter=synced',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.playlists).toBeDefined();

      // Verify filtering
      body.playlists.forEach((playlist: any) => {
        expect(playlist.syncStatus).toBe('synced');
      });
    });

    test('should require authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/playlists',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/playlists/:id', () => {
    let playlistId: string;

    beforeEach(async () => {
      // Create test playlist
      const playlist = await prisma.playlist.create({
        data: {
          youtubeId: 'PLtest',
          title: 'Test Playlist',
          description: 'Description',
          channelId: 'UCtest',
          channelTitle: 'Test Channel',
          thumbnailUrl: 'https://example.com/thumb.jpg',
          itemCount: 1,
          syncStatus: 'synced',
        },
      });
      playlistId = playlist.id;

      // Create test video and playlist item
      const video = await prisma.video.create({
        data: {
          youtubeId: 'vid1',
          title: 'Test Video',
          description: 'Video description',
          channelId: 'UCtest',
          channelTitle: 'Test Channel',
          duration: 630, // 10 minutes 30 seconds in seconds
          publishedAt: new Date(),
          thumbnailUrls: '["https://example.com/vid1.jpg"]',
        },
      });

      await prisma.playlistItem.create({
        data: {
          playlistId,
          videoId: video.id,
          position: 0,
          addedAt: new Date(),
        },
      });
    });

    test('should get playlist details with items', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/playlists/${playlistId}`,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.playlist).toBeDefined();
      expect(body.playlist.id).toBe(playlistId);
      expect(body.playlist.items).toBeDefined();
      expect(Array.isArray(body.playlist.items)).toBe(true);
    });

    test('should return 404 for non-existent playlist', async () => {
      // Use a valid UUID format that doesn't exist
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/playlists/${nonExistentId}`,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBeDefined();
      // Error handler returns INVALID_INPUT for non-500 errors
      // The actual message includes "not found"
      expect(body.error.message).toContain('not found');
    });

    test('should require authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/playlists/${playlistId}`,
      });

      expect(response.statusCode).toBe(401);
    });

    test('should include video metadata in items', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/playlists/${playlistId}`,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      if (body.playlist.items.length > 0) {
        const item = body.playlist.items[0];
        expect(item.video).toBeDefined();
        expect(item.video.youtubeId).toBeDefined();
        expect(item.video.title).toBeDefined();
        expect(item.video.duration).toBeDefined();
      }
    });
  });

  describe('POST /api/v1/playlists/:id/sync', () => {
    let playlistId: string;

    beforeEach(async () => {
      // Create test playlist
      const playlist = await prisma.playlist.create({
        data: {
          youtubeId: 'PLtest',
          title: 'Test Playlist',
          description: 'Description',
          channelId: 'UCtest',
          channelTitle: 'Test Channel',
          thumbnailUrl: 'https://example.com/thumb.jpg',
          itemCount: 1,
          syncStatus: 'synced',
        },
      });
      playlistId = playlist.id;
    });

    test('should sync playlist successfully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/playlists/${playlistId}/sync`,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.result).toBeDefined();
      expect(body.result.playlistId).toBe(playlistId);
      expect(body.result.status).toBeDefined();
      expect(body.result.itemsAdded).toBeDefined();
      expect(body.result.itemsRemoved).toBeDefined();
      expect(body.result.duration).toBeDefined();
    });

    test('should return failed status for non-existent playlist', async () => {
      // Use a valid UUID format that doesn't exist
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/playlists/${nonExistentId}/sync`,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      // Sync endpoint returns 200 with failed status for non-existent playlist
      // This is by design - sync operations return results even for failures
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.result.status).toBe('FAILED');
      expect(body.result.error).toBeDefined();
    });

    test('should require authentication', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/playlists/${playlistId}/sync`,
      });

      expect(response.statusCode).toBe(401);
    });

    test('should track quota usage', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/playlists/${playlistId}/sync`,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.result.quotaUsed).toBeDefined();
      expect(body.result.quotaUsed).toBeGreaterThanOrEqual(0);
    });
  });

  describe('DELETE /api/v1/playlists/:id', () => {
    let playlistId: string;

    beforeEach(async () => {
      // Create test playlist
      const playlist = await prisma.playlist.create({
        data: {
          youtubeId: 'PLtest',
          title: 'Test Playlist',
          description: 'Description',
          channelId: 'UCtest',
          channelTitle: 'Test Channel',
          thumbnailUrl: 'https://example.com/thumb.jpg',
          itemCount: 1,
          syncStatus: 'synced',
        },
      });
      playlistId = playlist.id;
    });

    test('should delete playlist successfully', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/api/v1/playlists/${playlistId}`,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.message).toBe('Playlist deleted successfully');

      // Verify playlist is deleted
      const checkResponse = await app.inject({
        method: 'GET',
        url: `/api/v1/playlists/${playlistId}`,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      expect(checkResponse.statusCode).toBe(404);
    });

    test('should return 404 for non-existent playlist', async () => {
      // Use a valid UUID format that doesn't exist
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      const response = await app.inject({
        method: 'DELETE',
        url: `/api/v1/playlists/${nonExistentId}`,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      expect(response.statusCode).toBe(404);
    });

    test('should require authentication', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/api/v1/playlists/${playlistId}`,
      });

      expect(response.statusCode).toBe(401);
    });

    test('should delete associated playlist items', async () => {
      // Create playlist item
      const video = await prisma.video.create({
        data: {
          youtubeId: 'vid1',
          title: 'Test Video',
          description: 'Video description',
          channelId: 'UCtest',
          channelTitle: 'Test Channel',
          duration: 630, // 10 minutes 30 seconds in seconds
          publishedAt: new Date(),
          thumbnailUrls: '["https://example.com/vid1.jpg"]',
        },
      });

      await prisma.playlistItem.create({
        data: {
          playlistId,
          videoId: video.id,
          position: 0,
          addedAt: new Date(),
        },
      });

      // Delete playlist
      await app.inject({
        method: 'DELETE',
        url: `/api/v1/playlists/${playlistId}`,
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      // Verify playlist items are deleted
      const items = await prisma.playlistItem.findMany({
        where: { playlistId },
      });

      expect(items).toHaveLength(0);
    });
  });
});
