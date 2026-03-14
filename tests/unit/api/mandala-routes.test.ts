/**
 * Mandala API Routes Unit Tests
 *
 * Tests for mandalaRoutes Fastify plugin including:
 * - Backward-compatible endpoints (GET /, PUT /, PATCH /levels/:levelKey)
 * - Public endpoints (GET /public/:slug, GET /explore)
 * - Multi-Mandala CRUD (GET /list, POST /create, GET /:id, PUT /:id, PUT /:id/levels, DELETE /:id)
 * - Sharing (PATCH /:id/share, POST /:id/subscribe, DELETE /:id/subscribe)
 * - Activity log (GET /:id/activity)
 * - Quota (GET /quota, GET /subscriptions)
 */

import Fastify, { FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';

// Mock MandalaManager methods
const mockGetMandala = jest.fn();
const mockGetMandalaById = jest.fn();
const mockListMandalas = jest.fn();
const mockCreateMandala = jest.fn();
const mockUpdateMandala = jest.fn();
const mockUpdateMandalaLevels = jest.fn();
const mockDeleteMandala = jest.fn();
const mockGetUserQuota = jest.fn();
const mockUpsertMandala = jest.fn();
const mockLinkCardsToMandala = jest.fn();
const mockUpdateLevel = jest.fn();
const mockTogglePublic = jest.fn();
const mockGetPublicMandala = jest.fn();
const mockListPublicMandalas = jest.fn();
const mockSubscribe = jest.fn();
const mockUnsubscribe = jest.fn();
const mockListSubscriptions = jest.fn();
const mockLogActivity = jest.fn();
const mockGetActivityLog = jest.fn();

jest.mock('../../../src/modules/mandala', () => ({
  getMandalaManager: () => ({
    getMandala: mockGetMandala,
    getMandalaById: mockGetMandalaById,
    listMandalas: mockListMandalas,
    createMandala: mockCreateMandala,
    updateMandala: mockUpdateMandala,
    updateMandalaLevels: mockUpdateMandalaLevels,
    deleteMandala: mockDeleteMandala,
    getUserQuota: mockGetUserQuota,
    upsertMandala: mockUpsertMandala,
    linkCardsToMandala: mockLinkCardsToMandala,
    updateLevel: mockUpdateLevel,
    togglePublic: mockTogglePublic,
    getPublicMandala: mockGetPublicMandala,
    listPublicMandalas: mockListPublicMandalas,
    subscribe: mockSubscribe,
    unsubscribe: mockUnsubscribe,
    listSubscriptions: mockListSubscriptions,
    logActivity: mockLogActivity,
    getActivityLog: mockGetActivityLog,
  }),
}));

import { mandalaRoutes } from '../../../src/api/routes/mandalas';

// ─── Test Fixtures ───

const mockMandala = {
  id: 'mandala-1',
  userId: 'test-user-id',
  title: 'Test Mandala',
  isDefault: true,
  isPublic: false,
  shareSlug: null,
  position: 0,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  levels: [
    {
      id: 'level-root',
      levelKey: 'root',
      centerGoal: 'Root Goal',
      subjects: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'],
      position: 0,
      depth: 0,
      color: null,
      parentLevelId: null,
    },
  ],
};

const PREFIX = '/api/v1/mandalas';

describe('Mandala API Routes', () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    app = Fastify();

    await app.register(jwt, {
      secret: 'test-secret-key-for-mandala-routes-testing',
    });

    app.decorate('authenticate', async function (request: any) {
      try {
        await request.jwtVerify();
      } catch {
        const authError = new Error('Unauthorized') as any;
        authError.statusCode = 401;
        authError.code = 'UNAUTHORIZED';
        throw authError;
      }
    });

    app.setErrorHandler((error: any, _request, reply) => {
      if (error.statusCode === 401 || error.code === 'UNAUTHORIZED') {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      return reply.code(error.statusCode || 500).send({
        error: error.message || 'Internal server error',
      });
    });

    await app.register(mandalaRoutes, { prefix: PREFIX });
    await app.ready();

    token = app.jwt.sign({ userId: 'test-user-id' });

    jest.clearAllMocks();
  });

  afterEach(async () => {
    await app.close();
  });

  // Helper
  function authHeaders() {
    return { authorization: `Bearer ${token}` };
  }

  // ─── GET / (default mandala) ───

  describe('GET /', () => {
    test('should return 200 with default mandala', async () => {
      mockGetMandala.mockResolvedValue(mockMandala);

      const res = await app.inject({
        method: 'GET',
        url: PREFIX,
        headers: authHeaders(),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().mandala.title).toBe('Test Mandala');
    });

    test('should return 404 when no default mandala exists', async () => {
      mockGetMandala.mockResolvedValue(null);

      const res = await app.inject({
        method: 'GET',
        url: PREFIX,
        headers: authHeaders(),
      });

      expect(res.statusCode).toBe(404);
    });

    test('should return 401 without auth', async () => {
      const res = await app.inject({
        method: 'GET',
        url: PREFIX,
      });

      expect(res.statusCode).toBe(401);
    });
  });

  // ─── PUT / (upsert default mandala) ───

  describe('PUT /', () => {
    const validBody = {
      title: 'My Mandala',
      levels: [
        {
          levelKey: 'root',
          centerGoal: 'Goal',
          subjects: ['S1'],
          position: 0,
          depth: 0,
        },
      ],
    };

    test('should return 200 on successful upsert', async () => {
      mockUpsertMandala.mockResolvedValue(mockMandala);
      mockLinkCardsToMandala.mockResolvedValue({ videoStates: 0, localCards: 0 });

      const res = await app.inject({
        method: 'PUT',
        url: PREFIX,
        headers: authHeaders(),
        payload: validBody,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().mandala).toBeDefined();
      expect(res.json().linked).toBeDefined();
    });

    test('should return 400 when title is missing', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: PREFIX,
        headers: authHeaders(),
        payload: { levels: [] },
      });

      expect(res.statusCode).toBe(400);
    });

    test('should return 400 when levels is not an array', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: PREFIX,
        headers: authHeaders(),
        payload: { title: 'Test', levels: 'not-array' },
      });

      expect(res.statusCode).toBe(400);
    });

    test('should return 500 when upsert throws', async () => {
      mockUpsertMandala.mockRejectedValue(new Error('DB error'));

      const res = await app.inject({
        method: 'PUT',
        url: PREFIX,
        headers: authHeaders(),
        payload: validBody,
      });

      expect(res.statusCode).toBe(500);
    });

    test('should call linkCardsToMandala after upsert', async () => {
      mockUpsertMandala.mockResolvedValue(mockMandala);
      mockLinkCardsToMandala.mockResolvedValue({ videoStates: 2, localCards: 1 });

      const res = await app.inject({
        method: 'PUT',
        url: PREFIX,
        headers: authHeaders(),
        payload: validBody,
      });

      expect(res.statusCode).toBe(200);
      expect(mockLinkCardsToMandala).toHaveBeenCalledWith('test-user-id', 'mandala-1');
    });
  });

  // ─── PATCH /levels/:levelKey ───

  describe('PATCH /levels/:levelKey', () => {
    test('should return 200 on successful level update', async () => {
      mockUpdateLevel.mockResolvedValue(undefined);

      const res = await app.inject({
        method: 'PATCH',
        url: `${PREFIX}/levels/root`,
        headers: authHeaders(),
        payload: { centerGoal: 'Updated Goal' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    });

    test('should return 401 without auth', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `${PREFIX}/levels/root`,
        payload: { centerGoal: 'X' },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  // ─── GET /public/:slug ───

  describe('GET /public/:slug', () => {
    test('should return 200 with public mandala', async () => {
      mockGetPublicMandala.mockResolvedValue({ ...mockMandala, isPublic: true, shareSlug: 'abc' });

      const res = await app.inject({
        method: 'GET',
        url: `${PREFIX}/public/abc`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().mandala).toBeDefined();
    });

    test('should return 404 for non-existent slug', async () => {
      mockGetPublicMandala.mockResolvedValue(null);

      const res = await app.inject({
        method: 'GET',
        url: `${PREFIX}/public/no-such-slug`,
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ─── GET /explore ───

  describe('GET /explore', () => {
    test('should return 200 with public mandalas', async () => {
      mockListPublicMandalas.mockResolvedValue({
        mandalas: [mockMandala],
        total: 1,
        page: 1,
        limit: 20,
      });

      const res = await app.inject({
        method: 'GET',
        url: `${PREFIX}/explore`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().mandalas).toHaveLength(1);
    });

    test('should return 400 for invalid page parameter', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${PREFIX}/explore?page=0`,
      });

      expect(res.statusCode).toBe(400);
    });

    test('should pass pagination parameters', async () => {
      mockListPublicMandalas.mockResolvedValue({
        mandalas: [],
        total: 0,
        page: 2,
        limit: 5,
      });

      const res = await app.inject({
        method: 'GET',
        url: `${PREFIX}/explore?page=2&limit=5`,
      });

      expect(res.statusCode).toBe(200);
      expect(mockListPublicMandalas).toHaveBeenCalledWith({ page: 2, limit: 5 });
    });
  });

  // ─── GET /subscriptions ───

  describe('GET /subscriptions', () => {
    test('should return 200 with subscription list', async () => {
      mockListSubscriptions.mockResolvedValue({
        subscriptions: [],
        total: 0,
        page: 1,
        limit: 20,
      });

      const res = await app.inject({
        method: 'GET',
        url: `${PREFIX}/subscriptions`,
        headers: authHeaders(),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().subscriptions).toBeDefined();
    });

    test('should return 401 without auth', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${PREFIX}/subscriptions`,
      });

      expect(res.statusCode).toBe(401);
    });
  });

  // ─── GET /quota ───

  describe('GET /quota', () => {
    test('should return 200 with quota info', async () => {
      mockGetUserQuota.mockResolvedValue({
        tier: 'free',
        limit: 3,
        used: 1,
        remaining: 2,
      });

      const res = await app.inject({
        method: 'GET',
        url: `${PREFIX}/quota`,
        headers: authHeaders(),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().quota.tier).toBe('free');
    });

    test('should return 401 without auth', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${PREFIX}/quota`,
      });

      expect(res.statusCode).toBe(401);
    });
  });

  // ─── GET /list ───

  describe('GET /list', () => {
    test('should return 200 with mandala list', async () => {
      mockListMandalas.mockResolvedValue({
        mandalas: [mockMandala],
        total: 1,
        page: 1,
        limit: 20,
      });

      const res = await app.inject({
        method: 'GET',
        url: `${PREFIX}/list`,
        headers: authHeaders(),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().mandalas).toHaveLength(1);
      expect(res.json().total).toBe(1);
    });

    test('should return 400 for invalid pagination', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${PREFIX}/list?page=-1`,
        headers: authHeaders(),
      });

      expect(res.statusCode).toBe(400);
    });

    test('should return 401 without auth', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${PREFIX}/list`,
      });

      expect(res.statusCode).toBe(401);
    });
  });

  // ─── POST /create ───

  describe('POST /create', () => {
    test('should return 201 on successful creation', async () => {
      mockCreateMandala.mockResolvedValue({ ...mockMandala, isDefault: false });

      const res = await app.inject({
        method: 'POST',
        url: `${PREFIX}/create`,
        headers: authHeaders(),
        payload: { title: 'New Mandala' },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().mandala).toBeDefined();
    });

    test('should return 400 for empty title', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${PREFIX}/create`,
        headers: authHeaders(),
        payload: { title: '' },
      });

      expect(res.statusCode).toBe(400);
    });

    test('should return 400 for title over 200 characters', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${PREFIX}/create`,
        headers: authHeaders(),
        payload: { title: 'A'.repeat(201) },
      });

      expect(res.statusCode).toBe(400);
    });

    test('should return 409 when quota exceeded', async () => {
      const quotaErr = new Error('Mandala quota exceeded') as any;
      quotaErr.quota = 3;
      quotaErr.current = 3;
      mockCreateMandala.mockRejectedValue(quotaErr);

      const res = await app.inject({
        method: 'POST',
        url: `${PREFIX}/create`,
        headers: authHeaders(),
        payload: { title: 'Over Quota' },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().quota).toBe(3);
    });

    test('should call linkCardsToMandala when isDefault', async () => {
      mockCreateMandala.mockResolvedValue({ ...mockMandala, isDefault: true });
      mockLinkCardsToMandala.mockResolvedValue({ videoStates: 0, localCards: 0 });

      await app.inject({
        method: 'POST',
        url: `${PREFIX}/create`,
        headers: authHeaders(),
        payload: { title: 'First Mandala' },
      });

      expect(mockLinkCardsToMandala).toHaveBeenCalled();
    });
  });

  // ─── GET /:id ───

  describe('GET /:id', () => {
    test('should return 200 with mandala', async () => {
      mockGetMandalaById.mockResolvedValue(mockMandala);

      const res = await app.inject({
        method: 'GET',
        url: `${PREFIX}/mandala-1`,
        headers: authHeaders(),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().mandala.id).toBe('mandala-1');
    });

    test('should return 404 when not found', async () => {
      mockGetMandalaById.mockResolvedValue(null);

      const res = await app.inject({
        method: 'GET',
        url: `${PREFIX}/non-existent`,
        headers: authHeaders(),
      });

      expect(res.statusCode).toBe(404);
    });

    test('should return 401 without auth', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${PREFIX}/mandala-1`,
      });

      expect(res.statusCode).toBe(401);
    });
  });

  // ─── PUT /:id ───

  describe('PUT /:id', () => {
    test('should return 200 on successful update', async () => {
      mockUpdateMandala.mockResolvedValue({ ...mockMandala, title: 'Updated' });

      const res = await app.inject({
        method: 'PUT',
        url: `${PREFIX}/mandala-1`,
        headers: authHeaders(),
        payload: { title: 'Updated' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().mandala.title).toBe('Updated');
    });

    test('should return 400 for empty title string', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `${PREFIX}/mandala-1`,
        headers: authHeaders(),
        payload: { title: '' },
      });

      expect(res.statusCode).toBe(400);
    });

    test('should return 400 for title over 200 characters', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `${PREFIX}/mandala-1`,
        headers: authHeaders(),
        payload: { title: 'B'.repeat(201) },
      });

      expect(res.statusCode).toBe(400);
    });

    test('should return 404 when mandala not found', async () => {
      mockUpdateMandala.mockRejectedValue(new Error('Mandala not found'));

      const res = await app.inject({
        method: 'PUT',
        url: `${PREFIX}/non-existent`,
        headers: authHeaders(),
        payload: { title: 'X' },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ─── PUT /:id/levels ───

  describe('PUT /:id/levels', () => {
    const validLevels = [
      { levelKey: 'root', centerGoal: 'G', subjects: [], position: 0, depth: 0 },
    ];

    test('should return 200 on successful level replacement', async () => {
      mockUpdateMandalaLevels.mockResolvedValue(mockMandala);

      const res = await app.inject({
        method: 'PUT',
        url: `${PREFIX}/mandala-1/levels`,
        headers: authHeaders(),
        payload: { levels: validLevels },
      });

      expect(res.statusCode).toBe(200);
    });

    test('should return 400 when levels is missing', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `${PREFIX}/mandala-1/levels`,
        headers: authHeaders(),
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });

    test('should return 404 when mandala not found', async () => {
      mockUpdateMandalaLevels.mockRejectedValue(new Error('Mandala not found'));

      const res = await app.inject({
        method: 'PUT',
        url: `${PREFIX}/non-existent/levels`,
        headers: authHeaders(),
        payload: { levels: validLevels },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ─── DELETE /:id ───

  describe('DELETE /:id', () => {
    test('should return 204 on successful deletion', async () => {
      mockDeleteMandala.mockResolvedValue(undefined);

      const res = await app.inject({
        method: 'DELETE',
        url: `${PREFIX}/mandala-1`,
        headers: authHeaders(),
      });

      expect(res.statusCode).toBe(204);
    });

    test('should return 404 when mandala not found', async () => {
      mockDeleteMandala.mockRejectedValue(new Error('Mandala not found'));

      const res = await app.inject({
        method: 'DELETE',
        url: `${PREFIX}/non-existent`,
        headers: authHeaders(),
      });

      expect(res.statusCode).toBe(404);
    });

    test('should return 401 without auth', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `${PREFIX}/mandala-1`,
      });

      expect(res.statusCode).toBe(401);
    });
  });

  // ─── PATCH /:id/share ───

  describe('PATCH /:id/share', () => {
    test('should return 200 when toggling public', async () => {
      mockTogglePublic.mockResolvedValue({ ...mockMandala, isPublic: true, shareSlug: 'slug-1' });
      mockLogActivity.mockResolvedValue(undefined);

      const res = await app.inject({
        method: 'PATCH',
        url: `${PREFIX}/mandala-1/share`,
        headers: authHeaders(),
        payload: { isPublic: true },
      });

      expect(res.statusCode).toBe(200);
      expect(mockLogActivity).toHaveBeenCalledWith(
        'mandala-1',
        'test-user-id',
        'share_enabled',
        'mandala'
      );
    });

    test('should return 400 when isPublic is missing', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `${PREFIX}/mandala-1/share`,
        headers: authHeaders(),
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });

    test('should return 404 when mandala not found', async () => {
      mockTogglePublic.mockRejectedValue(new Error('Mandala not found'));

      const res = await app.inject({
        method: 'PATCH',
        url: `${PREFIX}/non-existent/share`,
        headers: authHeaders(),
        payload: { isPublic: true },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ─── POST /:id/subscribe ───

  describe('POST /:id/subscribe', () => {
    test('should return 201 on successful subscription', async () => {
      mockSubscribe.mockResolvedValue(undefined);

      const res = await app.inject({
        method: 'POST',
        url: `${PREFIX}/mandala-1/subscribe`,
        headers: authHeaders(),
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().success).toBe(true);
    });

    test('should return 404 when mandala not found or not public', async () => {
      mockSubscribe.mockRejectedValue(new Error('Mandala not found or not public'));

      const res = await app.inject({
        method: 'POST',
        url: `${PREFIX}/non-existent/subscribe`,
        headers: authHeaders(),
      });

      expect(res.statusCode).toBe(404);
    });

    test('should return 400 when subscribing to own mandala', async () => {
      mockSubscribe.mockRejectedValue(new Error('Cannot subscribe to own mandala'));

      const res = await app.inject({
        method: 'POST',
        url: `${PREFIX}/mandala-1/subscribe`,
        headers: authHeaders(),
      });

      expect(res.statusCode).toBe(400);
    });

    test('should return 409 on duplicate subscription', async () => {
      const dupErr = new Error('Unique constraint') as any;
      dupErr.code = 'P2002';
      mockSubscribe.mockRejectedValue(dupErr);

      const res = await app.inject({
        method: 'POST',
        url: `${PREFIX}/mandala-1/subscribe`,
        headers: authHeaders(),
      });

      expect(res.statusCode).toBe(409);
    });
  });

  // ─── DELETE /:id/subscribe ───

  describe('DELETE /:id/subscribe', () => {
    test('should return 204 on successful unsubscription', async () => {
      mockUnsubscribe.mockResolvedValue(undefined);

      const res = await app.inject({
        method: 'DELETE',
        url: `${PREFIX}/mandala-1/subscribe`,
        headers: authHeaders(),
      });

      expect(res.statusCode).toBe(204);
    });

    test('should return 404 when subscription not found', async () => {
      mockUnsubscribe.mockRejectedValue(new Error('Subscription not found'));

      const res = await app.inject({
        method: 'DELETE',
        url: `${PREFIX}/non-existent/subscribe`,
        headers: authHeaders(),
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ─── GET /:id/activity ───

  describe('GET /:id/activity', () => {
    test('should return 200 with activity log', async () => {
      mockGetActivityLog.mockResolvedValue({
        activities: [
          {
            id: 'log-1',
            action: 'share_enabled',
            entityType: 'mandala',
            entityId: null,
            metadata: null,
            createdAt: new Date(),
          },
        ],
        total: 1,
        page: 1,
        limit: 50,
      });

      const res = await app.inject({
        method: 'GET',
        url: `${PREFIX}/mandala-1/activity`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().activities).toHaveLength(1);
    });

    test('should return 404 for non-public mandala', async () => {
      mockGetActivityLog.mockRejectedValue(new Error('Mandala not found or not public'));

      const res = await app.inject({
        method: 'GET',
        url: `${PREFIX}/private-mandala/activity`,
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
