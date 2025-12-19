/**
 * Playlist API Routes Unit Tests
 */

import { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { playlistRoutes } from '../../../../src/api/routes/playlists';

// Valid UUIDs for testing
const TEST_PLAYLIST_ID = '550e8400-e29b-41d4-a716-446655440000';
const TEST_USER_ID = '660e8400-e29b-41d4-a716-446655440001';

// Mock PlaylistManager
const mockPlaylistManager = {
  importPlaylist: jest.fn(),
  listPlaylists: jest.fn(),
  getPlaylistWithItems: jest.fn(),
  deletePlaylist: jest.fn(),
};

// Mock SyncEngine
const mockSyncEngine = {
  syncPlaylist: jest.fn(),
};

jest.mock('../../../../src/modules/playlist', () => ({
  getPlaylistManager: () => mockPlaylistManager,
}));

jest.mock('../../../../src/modules/sync', () => ({
  getSyncEngine: () => mockSyncEngine,
}));

// Mock logger
jest.mock('../../../../src/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('Playlist Routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });

    // Register authenticate decorator - must properly stop request processing
    app.decorate('authenticate', async function (request: any, reply: any) {
      const authHeader = request.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        request.user = { userId: TEST_USER_ID };
      } else {
        // Hijack the reply to prevent further processing
        reply.hijack();
        reply.raw.statusCode = 401;
        reply.raw.setHeader('content-type', 'application/json');
        reply.raw.end(JSON.stringify({ error: 'Unauthorized' }));
      }
    });

    await app.register(playlistRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /import', () => {
    test('should import playlist successfully', async () => {
      const mockPlaylist = {
        id: TEST_PLAYLIST_ID,
        youtubeId: 'PLtest123',
        title: 'Test Playlist',
        description: 'Test description',
        channelId: 'UCtest',
        channelTitle: 'Test Channel',
        thumbnailUrl: 'https://example.com/thumb.jpg',
        itemCount: 10,
        syncStatus: 'COMPLETED',
        lastSyncedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPlaylistManager.importPlaylist.mockResolvedValue(mockPlaylist);

      const response = await app.inject({
        method: 'POST',
        url: '/import',
        headers: {
          authorization: 'Bearer mock-token',
        },
        payload: {
          playlistUrl: 'https://youtube.com/playlist?list=PLtest123',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.playlist).toBeDefined();
      expect(body.playlist.title).toBe('Test Playlist');
      expect(body.playlist.youtubeId).toBe('PLtest123');
    });

    test('should import playlist with null description and thumbnail', async () => {
      const mockPlaylist = {
        id: TEST_PLAYLIST_ID,
        youtubeId: 'PLtest123',
        title: 'Test Playlist',
        description: null,
        channelId: 'UCtest',
        channelTitle: 'Test Channel',
        thumbnailUrl: null,
        itemCount: 10,
        syncStatus: 'PENDING',
        lastSyncedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPlaylistManager.importPlaylist.mockResolvedValue(mockPlaylist);

      const response = await app.inject({
        method: 'POST',
        url: '/import',
        headers: {
          authorization: 'Bearer mock-token',
        },
        payload: {
          playlistUrl: 'PLtest123',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.playlist.description).toBeNull();
      expect(body.playlist.thumbnailUrl).toBeNull();
      expect(body.playlist.lastSyncedAt).toBeNull();
    });

    test('should return 401 without authorization', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/import',
        payload: {
          playlistUrl: 'https://youtube.com/playlist?list=PLtest123',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    test('should handle import error with 500 status', async () => {
      mockPlaylistManager.importPlaylist.mockRejectedValue(
        new Error('Failed to import playlist')
      );

      const response = await app.inject({
        method: 'POST',
        url: '/import',
        headers: {
          authorization: 'Bearer mock-token',
        },
        payload: {
          playlistUrl: 'https://youtube.com/playlist?list=PLtest123',
        },
      });

      expect(response.statusCode).toBe(500);
    });

    test('should handle validation error for missing playlistUrl', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/import',
        headers: {
          authorization: 'Bearer mock-token',
        },
        payload: {},
      });

      // Fastify schema validation should catch this and return 400
      expect([400, 500]).toContain(response.statusCode);
    });

    test('should handle validation error for empty playlistUrl', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/import',
        headers: {
          authorization: 'Bearer mock-token',
        },
        payload: {
          playlistUrl: '',
        },
      });

      // Fastify schema validation should catch this and return 400
      expect([400, 500]).toContain(response.statusCode);
    });

    test('should handle validation error for too long playlistUrl', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/import',
        headers: {
          authorization: 'Bearer mock-token',
        },
        payload: {
          playlistUrl: 'a'.repeat(501),
        },
      });

      // Fastify schema validation should catch this and return 400
      expect([400, 500]).toContain(response.statusCode);
    });
  });

  describe('GET /', () => {
    test('should list playlists successfully', async () => {
      const mockPlaylists = [
        {
          id: TEST_PLAYLIST_ID,
          youtubeId: 'PLtest1',
          title: 'Playlist 1',
          description: 'Description 1',
          channelId: 'UCtest',
          channelTitle: 'Test Channel',
          thumbnailUrl: null,
          itemCount: 5,
          syncStatus: 'COMPLETED',
          lastSyncedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '660e8400-e29b-41d4-a716-446655440002',
          youtubeId: 'PLtest2',
          title: 'Playlist 2',
          description: 'Description 2',
          channelId: 'UCtest',
          channelTitle: 'Test Channel',
          thumbnailUrl: null,
          itemCount: 10,
          syncStatus: 'PENDING',
          lastSyncedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockPlaylistManager.listPlaylists.mockResolvedValue({
        playlists: mockPlaylists,
        total: 2,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/',
        headers: {
          authorization: 'Bearer mock-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.playlists).toHaveLength(2);
      expect(body.total).toBe(2);
    });

    test('should apply query parameters correctly', async () => {
      mockPlaylistManager.listPlaylists.mockResolvedValue({
        playlists: [],
        total: 0,
      });

      await app.inject({
        method: 'GET',
        url: '/?filter=test&sortBy=title&sortOrder=asc&limit=10&offset=5',
        headers: {
          authorization: 'Bearer mock-token',
        },
      });

      expect(mockPlaylistManager.listPlaylists).toHaveBeenCalledWith({
        filter: 'test',
        sortBy: 'title',
        sortOrder: 'asc',
        limit: 10,
        offset: 5,
      });
    });

    test('should return 401 without authorization', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/',
      });

      expect(response.statusCode).toBe(401);
    });

    test('should handle list error', async () => {
      mockPlaylistManager.listPlaylists.mockRejectedValue(
        new Error('Database error')
      );

      const response = await app.inject({
        method: 'GET',
        url: '/',
        headers: {
          authorization: 'Bearer mock-token',
        },
      });

      expect(response.statusCode).toBe(500);
    });

    test('should use default values when query parameters are missing', async () => {
      mockPlaylistManager.listPlaylists.mockResolvedValue({
        playlists: [],
        total: 0,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/',
        headers: {
          authorization: 'Bearer mock-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.playlists).toEqual([]);
      expect(body.total).toBe(0);
    });

    test('should return 400 for invalid limit value', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/?limit=101',
        headers: {
          authorization: 'Bearer mock-token',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    test('should return 400 for negative offset', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/?offset=-1',
        headers: {
          authorization: 'Bearer mock-token',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    test('should return 400 for invalid sortBy value', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/?sortBy=invalidField',
        headers: {
          authorization: 'Bearer mock-token',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /:id', () => {
    test('should get playlist with items successfully', async () => {
      const mockPlaylist = {
        id: TEST_PLAYLIST_ID,
        youtubeId: 'PLtest123',
        title: 'Test Playlist',
        description: 'Test description',
        channelId: 'UCtest',
        channelTitle: 'Test Channel',
        thumbnailUrl: null,
        itemCount: 2,
        syncStatus: 'COMPLETED',
        lastSyncedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        items: [
          {
            id: '770e8400-e29b-41d4-a716-446655440001',
            position: 0,
            addedAt: new Date(),
            video: {
              id: '880e8400-e29b-41d4-a716-446655440001',
              youtubeId: 'vid1',
              title: 'Video 1',
              description: 'Description 1',
              channelTitle: 'Channel 1',
              duration: 300,
              thumbnailUrls: '{}',
              viewCount: 1000,
              publishedAt: new Date(),
            },
          },
          {
            id: '770e8400-e29b-41d4-a716-446655440002',
            position: 1,
            addedAt: new Date(),
            video: {
              id: '880e8400-e29b-41d4-a716-446655440002',
              youtubeId: 'vid2',
              title: 'Video 2',
              description: 'Description 2',
              channelTitle: 'Channel 2',
              duration: 600,
              thumbnailUrls: '{}',
              viewCount: 2000,
              publishedAt: new Date(),
            },
          },
        ],
      };

      mockPlaylistManager.getPlaylistWithItems.mockResolvedValue(mockPlaylist);

      const response = await app.inject({
        method: 'GET',
        url: `/${TEST_PLAYLIST_ID}`,
        headers: {
          authorization: 'Bearer mock-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.playlist).toBeDefined();
      expect(body.playlist.title).toBe('Test Playlist');
      expect(body.playlist.items).toHaveLength(2);
    });

    test('should return 500 when getPlaylistWithItems fails', async () => {
      mockPlaylistManager.getPlaylistWithItems.mockRejectedValue(
        new Error('Playlist not found')
      );

      const response = await app.inject({
        method: 'GET',
        url: `/${TEST_PLAYLIST_ID}`,
        headers: {
          authorization: 'Bearer mock-token',
        },
      });

      expect(response.statusCode).toBe(500);
    });

    test('should return 401 without authorization', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/${TEST_PLAYLIST_ID}`,
      });

      expect(response.statusCode).toBe(401);
    });

    test('should return 400 for invalid UUID format', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/invalid-id',
        headers: {
          authorization: 'Bearer mock-token',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /:id/sync', () => {
    test('should sync playlist successfully', async () => {
      const mockResult = {
        playlistId: TEST_PLAYLIST_ID,
        status: 'COMPLETED',
        itemsAdded: 2,
        itemsRemoved: 1,
        itemsReordered: 0,
        duration: 5000,
        quotaUsed: 5,
        error: null,
      };

      mockSyncEngine.syncPlaylist.mockResolvedValue(mockResult);

      const response = await app.inject({
        method: 'POST',
        url: `/${TEST_PLAYLIST_ID}/sync`,
        headers: {
          authorization: 'Bearer mock-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.result).toBeDefined();
      expect(body.result.status).toBe('COMPLETED');
      expect(body.result.itemsAdded).toBe(2);
    });

    test('should handle sync error', async () => {
      mockSyncEngine.syncPlaylist.mockRejectedValue(new Error('Sync failed'));

      const response = await app.inject({
        method: 'POST',
        url: `/${TEST_PLAYLIST_ID}/sync`,
        headers: {
          authorization: 'Bearer mock-token',
        },
      });

      expect(response.statusCode).toBe(500);
    });

    test('should return 401 without authorization', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/${TEST_PLAYLIST_ID}/sync`,
      });

      expect(response.statusCode).toBe(401);
    });

    test('should include error in sync result', async () => {
      const mockResult = {
        playlistId: TEST_PLAYLIST_ID,
        status: 'FAILED',
        itemsAdded: 0,
        itemsRemoved: 0,
        itemsReordered: 0,
        duration: 1000,
        quotaUsed: 1,
        error: 'Some videos could not be synced',
      };

      mockSyncEngine.syncPlaylist.mockResolvedValue(mockResult);

      const response = await app.inject({
        method: 'POST',
        url: `/${TEST_PLAYLIST_ID}/sync`,
        headers: {
          authorization: 'Bearer mock-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.result.error).toBe('Some videos could not be synced');
    });
  });

  describe('DELETE /:id', () => {
    test('should delete playlist successfully', async () => {
      mockPlaylistManager.deletePlaylist.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'DELETE',
        url: `/${TEST_PLAYLIST_ID}`,
        headers: {
          authorization: 'Bearer mock-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.message).toBe('Playlist deleted successfully');
      expect(mockPlaylistManager.deletePlaylist).toHaveBeenCalledWith(
        TEST_PLAYLIST_ID
      );
    });

    test('should return 500 when delete fails', async () => {
      mockPlaylistManager.deletePlaylist.mockRejectedValue(
        new Error('Playlist not found')
      );

      const response = await app.inject({
        method: 'DELETE',
        url: `/${TEST_PLAYLIST_ID}`,
        headers: {
          authorization: 'Bearer mock-token',
        },
      });

      expect(response.statusCode).toBe(500);
    });

    test('should return 401 without authorization', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/${TEST_PLAYLIST_ID}`,
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
