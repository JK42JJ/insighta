/**
 * Mandala Generate Routes — Regression Tests
 *
 * Tests for mandalaGenerateRoutes Fastify plugin:
 * - POST /generate: validation, retry exhaustion (503), success
 * - GET /status: authentication guard
 * - repairJson: array extraction priority
 */

import Fastify, { FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';

// Mock config
jest.mock('../../../src/config', () => ({
  config: {
    huggingface: {
      spaceUrl: 'https://fake-hf-space.test',
    },
  },
}));

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

import { mandalaGenerateRoutes } from '../../../src/api/routes/mandala-generate';

const PREFIX = '/api/v1/mandala';

describe('Mandala Generate Routes', () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    app = Fastify();

    await app.register(jwt, {
      secret: 'test-secret-key-for-mandala-generate-testing',
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

    await app.register(mandalaGenerateRoutes, { prefix: PREFIX });
    await app.ready();

    token = app.jwt.sign({ userId: 'test-user-id' });

    jest.clearAllMocks();
  });

  afterEach(async () => {
    await app.close();
  });

  function authHeaders() {
    return { authorization: `Bearer ${token}` };
  }

  // ─── POST /generate ───

  describe('POST /generate', () => {
    test('should return 400 with VALIDATION_ERROR when prompt is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${PREFIX}/generate`,
        headers: authHeaders(),
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toBe('prompt is required');
    });

    test('should return 400 when prompt is empty string', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${PREFIX}/generate`,
        headers: authHeaders(),
        payload: { prompt: '   ' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    });

    test('should return 401 without auth', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${PREFIX}/generate`,
        payload: { prompt: 'test' },
      });

      expect(res.statusCode).toBe(401);
    });

    /**
     * Regression test: HF Space failure should return HTTP 503 (not 502)
     * with ErrorCode.SERVICE_UNAVAILABLE.
     *
     * Previously returned 502 which was inconsistent with the
     * SERVICE_UNAVAILABLE error code convention (503).
     */
    test('should return 503 with SERVICE_UNAVAILABLE after all retries fail', async () => {
      // Mock fetch to always reject (simulating HF Space down)
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      const res = await app.inject({
        method: 'POST',
        url: `${PREFIX}/generate`,
        headers: authHeaders(),
        payload: { prompt: 'Generate a mandala plan' },
      });

      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
      expect(body.error.message).toBe('Failed to generate mandala plan');
      expect(body.error.details).toBeDefined();
      expect(body.error.details.detail).toBe('Connection refused');
    });

    test('should return success with parsed JSON on valid HF response', async () => {
      const mockJson = { goal: 'Learn Math', subjects: ['Algebra'] };
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ data: [JSON.stringify(mockJson)] }),
      });

      const res = await app.inject({
        method: 'POST',
        url: `${PREFIX}/generate`,
        headers: authHeaders(),
        payload: { prompt: 'Generate a math mandala' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data).toEqual(mockJson);
      expect(body.meta.model).toBe('insighta-mandala-v13');
    });

    /**
     * Regression test: repairJson should extract full JSON arrays,
     * not just the first inner object.
     */
    test('should correctly parse JSON array responses (not truncate to first object)', async () => {
      const jsonArray = [
        { id: 1, name: 'Step 1' },
        { id: 2, name: 'Step 2' },
      ];
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ data: [JSON.stringify(jsonArray)] }),
      });

      const res = await app.inject({
        method: 'POST',
        url: `${PREFIX}/generate`,
        headers: authHeaders(),
        payload: { prompt: 'Generate steps' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      // Should return the full array, not just { id: 1, name: 'Step 1' }
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data).toHaveLength(2);
      expect(body.data[1].name).toBe('Step 2');
    });
  });

  // ─── GET /status ───

  describe('GET /status', () => {
    /**
     * Regression test: /status endpoint must require authentication.
     */
    test('should return 401 without auth', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${PREFIX}/status`,
      });

      expect(res.statusCode).toBe(401);
    });

    test('should return online status when HF Space is reachable', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      const res = await app.inject({
        method: 'GET',
        url: `${PREFIX}/status`,
        headers: authHeaders(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('online');
      expect(body.model).toBe('insighta-mandala-v13');
    });

    test('should return offline status when HF Space is unreachable', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      const res = await app.inject({
        method: 'GET',
        url: `${PREFIX}/status`,
        headers: authHeaders(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('offline');
      expect(body.error).toBe('ECONNREFUSED');
    });
  });
});
