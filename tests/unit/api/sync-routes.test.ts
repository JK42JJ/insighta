/**
 * Sync API Routes Tests
 *
 * Unit tests for sync endpoints
 */

import Fastify, { FastifyInstance } from 'fastify';
import type { ScheduleInfo } from '../../../src/modules/scheduler/manager';

// Mock playlist manager
const mockListPlaylists = jest.fn();
const mockGetPlaylist = jest.fn();

jest.mock('../../../src/modules/playlist', () => ({
  getPlaylistManager: () => ({
    listPlaylists: mockListPlaylists,
    getPlaylist: mockGetPlaylist,
  }),
}));

// Mock scheduler manager
const mockListSchedules = jest.fn();
const mockCreateSchedule = jest.fn();
const mockUpdateSchedule = jest.fn();
const mockDeleteSchedule = jest.fn();

jest.mock('../../../src/modules/scheduler', () => ({
  getSchedulerManager: () => ({
    listSchedules: mockListSchedules,
    createSchedule: mockCreateSchedule,
    updateSchedule: mockUpdateSchedule,
    deleteSchedule: mockDeleteSchedule,
  }),
}));

// Mock Prisma client
const mockSyncHistoryFindMany = jest.fn();
const mockSyncHistoryCount = jest.fn();
const mockSyncHistoryFindUnique = jest.fn();

jest.mock('../../../src/modules/database', () => ({
  getPrismaClient: () => ({
    syncHistory: {
      findMany: mockSyncHistoryFindMany,
      count: mockSyncHistoryCount,
      findUnique: mockSyncHistoryFindUnique,
    },
  }),
}));

import { syncRoutes } from '../../../src/api/routes/sync';

describe('Sync API Routes', () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    app = Fastify();

    // Add authenticate decorator - uses reply.hijack() pattern for proper auth error handling
    app.decorate('authenticate', async function (request: any, reply: any) {
      const authHeader = request.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        request.user = { userId: 'test-user-id' };
      } else {
        // Hijack the reply to prevent further processing
        reply.hijack();
        reply.raw.statusCode = 401;
        reply.raw.setHeader('content-type', 'application/json');
        reply.raw.end(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } }));
      }
    });

    // Add error handler for validation errors
    app.setErrorHandler((error: any, request, reply) => {
      const timestamp = new Date().toISOString();
      const path = request.url;

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
    await app.register(syncRoutes, { prefix: '/api/v1/sync' });

    await app.ready();

    // Token is just a marker for the authenticate decorator
    token = 'test-token';

    // Reset mocks
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /api/v1/sync/status', () => {
    it('should return all sync statuses', async () => {
      const mockPlaylists = {
        playlists: [
          {
            id: '550e8400-e29b-41d4-a716-446655440001',
            syncStatus: 'COMPLETED',
            lastSyncedAt: new Date('2024-01-01T10:00:00Z'),
            itemCount: 10,
          },
          {
            id: '550e8400-e29b-41d4-a716-446655440002',
            syncStatus: 'IN_PROGRESS',
            lastSyncedAt: null,
            itemCount: 5,
          },
        ],
        total: 2,
      };

      mockListPlaylists.mockResolvedValue(mockPlaylists);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/sync/status',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.statuses).toHaveLength(2);
      expect(body.statuses[0].playlistId).toBe('550e8400-e29b-41d4-a716-446655440001');
      expect(body.statuses[0].isRunning).toBe(false);
      expect(body.statuses[1].isRunning).toBe(true);
    });

    it('should require authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/sync/status',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/sync/status/:playlistId', () => {
    it('should return playlist sync status', async () => {
      const mockPlaylist = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        syncStatus: 'COMPLETED',
        lastSyncedAt: new Date('2024-01-01T10:00:00Z'),
        itemCount: 10,
      };

      mockGetPlaylist.mockResolvedValue(mockPlaylist);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/sync/status/550e8400-e29b-41d4-a716-446655440000',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBeDefined();
      expect(body.status.playlistId).toBe('550e8400-e29b-41d4-a716-446655440000');
      expect(body.status.status).toBe('COMPLETED');
    });

    it('should validate UUID format', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/sync/status/invalid-uuid',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should require authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/sync/status/550e8400-e29b-41d4-a716-446655440000',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/sync/history', () => {
    it('should return sync history with pagination', async () => {
      const mockHistory = [
        {
          id: '550e8400-e29b-41d4-a716-446655440001',
          playlistId: '550e8400-e29b-41d4-a716-446655440000',
          status: 'COMPLETED',
          startedAt: new Date('2024-01-01T10:00:00Z'),
          completedAt: new Date('2024-01-01T10:05:00Z'),
          duration: 300000,
          itemsAdded: 5,
          itemsRemoved: 2,
          itemsReordered: 1,
          quotaUsed: 10,
          errorMessage: null,
        },
      ];

      mockSyncHistoryCount.mockResolvedValue(1);
      mockSyncHistoryFindMany.mockResolvedValue(mockHistory);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/sync/history?page=1&limit=20',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.history).toHaveLength(1);
      expect(body.total).toBe(1);
      expect(body.page).toBe(1);
      expect(body.limit).toBe(20);
      expect(body.totalPages).toBe(1);
    });

    it('should filter by playlist ID', async () => {
      mockSyncHistoryCount.mockResolvedValue(0);
      mockSyncHistoryFindMany.mockResolvedValue([]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/sync/history?playlistId=550e8400-e29b-41d4-a716-446655440000',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockSyncHistoryCount).toHaveBeenCalledWith({
        where: { playlistId: '550e8400-e29b-41d4-a716-446655440000' },
      });
    });

    it('should filter by status', async () => {
      mockSyncHistoryCount.mockResolvedValue(0);
      mockSyncHistoryFindMany.mockResolvedValue([]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/sync/history?status=COMPLETED',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockSyncHistoryCount).toHaveBeenCalledWith({
        where: { status: 'COMPLETED' },
      });
    });

    it('should require authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/sync/history',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/sync/history/:syncId', () => {
    it('should return sync details', async () => {
      const mockSyncHistory = {
        id: '550e8400-e29b-41d4-a716-446655440001',
        playlistId: '550e8400-e29b-41d4-a716-446655440000',
        status: 'COMPLETED',
        startedAt: new Date('2024-01-01T10:00:00Z'),
        completedAt: new Date('2024-01-01T10:05:00Z'),
        duration: 300000,
        itemsAdded: 5,
        itemsRemoved: 2,
        itemsReordered: 1,
        quotaUsed: 10,
        errorMessage: null,
        playlist: {
          title: 'Test Playlist',
        },
      };

      mockSyncHistoryFindUnique.mockResolvedValue(mockSyncHistory);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/sync/history/550e8400-e29b-41d4-a716-446655440001',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.sync).toBeDefined();
      expect(body.sync.id).toBe('550e8400-e29b-41d4-a716-446655440001');
      expect(body.sync.playlistTitle).toBe('Test Playlist');
    });

    it('should return 404 when sync not found', async () => {
      mockSyncHistoryFindUnique.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/sync/history/550e8400-e29b-41d4-a716-446655440001',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('RESOURCE_NOT_FOUND');
    });

    it('should validate UUID format', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/sync/history/invalid-uuid',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should require authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/sync/history/550e8400-e29b-41d4-a716-446655440001',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/sync/schedule', () => {
    it('should return all schedules', async () => {
      const mockSchedules: ScheduleInfo[] = [
        {
          id: '550e8400-e29b-41d4-a716-446655440001',
          playlistId: '550e8400-e29b-41d4-a716-446655440000',
          interval: 3600000,
          enabled: true,
          lastRun: new Date('2024-01-01T10:00:00Z'),
          nextRun: new Date('2024-01-01T11:00:00Z'),
          retryCount: 0,
          maxRetries: 3,
          createdAt: new Date('2024-01-01T09:00:00Z'),
          updatedAt: new Date('2024-01-01T09:00:00Z'),
        },
      ];

      mockListSchedules.mockResolvedValue(mockSchedules);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/sync/schedule',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.schedules).toHaveLength(1);
      expect(body.schedules[0].interval).toBe(3600000);
    });

    it('should require authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/sync/schedule',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /api/v1/sync/schedule', () => {
    it('should create schedule', async () => {
      const mockSchedule: ScheduleInfo = {
        id: '550e8400-e29b-41d4-a716-446655440001',
        playlistId: '550e8400-e29b-41d4-a716-446655440000',
        interval: 3600000,
        enabled: true,
        lastRun: null,
        nextRun: new Date('2024-01-01T11:00:00Z'),
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date('2024-01-01T10:00:00Z'),
        updatedAt: new Date('2024-01-01T10:00:00Z'),
      };

      mockGetPlaylist.mockResolvedValue({ id: '550e8400-e29b-41d4-a716-446655440000' });
      mockCreateSchedule.mockResolvedValue(mockSchedule);

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sync/schedule',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          playlistId: '550e8400-e29b-41d4-a716-446655440000',
          interval: 3600000,
          enabled: true,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.schedule).toBeDefined();
      expect(body.schedule.interval).toBe(3600000);
      expect(mockCreateSchedule).toHaveBeenCalledWith({
        playlistId: '550e8400-e29b-41d4-a716-446655440000',
        interval: 3600000,
        enabled: true,
      });
    });

    it('should validate required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sync/schedule',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          // Missing playlistId and interval
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should validate minimum interval', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sync/schedule',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          playlistId: '550e8400-e29b-41d4-a716-446655440000',
          interval: 30000, // Less than 60000 (1 minute)
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should require authentication', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sync/schedule',
        payload: {
          playlistId: '550e8400-e29b-41d4-a716-446655440000',
          interval: 3600000,
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('PATCH /api/v1/sync/schedule/:id', () => {
    it('should update schedule', async () => {
      const mockSchedule: ScheduleInfo = {
        id: '550e8400-e29b-41d4-a716-446655440001',
        playlistId: '550e8400-e29b-41d4-a716-446655440000',
        interval: 7200000,
        enabled: false,
        lastRun: new Date('2024-01-01T10:00:00Z'),
        nextRun: new Date('2024-01-01T12:00:00Z'),
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date('2024-01-01T09:00:00Z'),
        updatedAt: new Date('2024-01-01T11:00:00Z'),
      };

      mockUpdateSchedule.mockResolvedValue(mockSchedule);

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/sync/schedule/550e8400-e29b-41d4-a716-446655440000',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          interval: 7200000,
          enabled: false,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.schedule).toBeDefined();
      expect(body.schedule.interval).toBe(7200000);
      expect(body.schedule.enabled).toBe(false);
    });

    it('should validate UUID format', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/sync/schedule/invalid-uuid',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          enabled: false,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should require authentication', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/sync/schedule/550e8400-e29b-41d4-a716-446655440000',
        payload: {
          enabled: false,
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('DELETE /api/v1/sync/schedule/:id', () => {
    it('should delete schedule', async () => {
      mockDeleteSchedule.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/sync/schedule/550e8400-e29b-41d4-a716-446655440000',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.message).toBe('Schedule deleted successfully');
      expect(mockDeleteSchedule).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440000');
    });

    it('should validate UUID format', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/sync/schedule/invalid-uuid',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should require authentication', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/sync/schedule/550e8400-e29b-41d4-a716-446655440000',
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
