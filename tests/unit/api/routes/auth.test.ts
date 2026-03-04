/**
 * Auth API Routes Unit Tests (Supabase Auth)
 *
 * Tests for the simplified auth routes that delegate
 * registration/login to Supabase Auth.
 * Only /auth/me and /auth/logout are backend-managed.
 */

import { FastifyInstance } from 'fastify';
import Fastify from 'fastify';

// Create mock objects that are accessible in tests
const mockUserMethods = {
  findUnique: jest.fn(),
  findFirst: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
};

// Mock modules before importing authRoutes
jest.mock('../../../../src/modules/database/client', () => ({
  db: {
    users: mockUserMethods,
  },
  getPrismaClient: () => ({
    users: mockUserMethods,
  }),
  prisma: {
    users: mockUserMethods,
  },
}));

// Mock auth plugin (no longer exports createJWTPayload/verifyRefreshToken)
jest.mock('../../../../src/api/plugins/auth', () => ({
  extractTokenFromHeader: jest.fn((header?: string) => {
    if (!header) return null;
    const parts = header.split(' ');
    return parts.length === 2 && parts[0] === 'Bearer' ? parts[1] : null;
  }),
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

// Import after mocks are set up
import { authRoutes } from '../../../../src/api/routes/auth';

describe('Auth Routes (Supabase Auth)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });

    // Register authenticate decorator (simulates Supabase JWT verification)
    app.decorate('authenticate', async function (request: any, reply: any) {
      if (request.headers.authorization) {
        request.user = {
          userId: 'test-user-id',
          email: 'test@example.com',
          name: 'Test User',
        };
      } else {
        reply.hijack();
        reply.raw.statusCode = 401;
        reply.raw.setHeader('content-type', 'application/json');
        reply.raw.end(JSON.stringify({ error: 'Unauthorized' }));
      }
    });

    // Custom error handler
    app.setErrorHandler((error, request, reply) => {
      if (error.validation) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: error.message,
            timestamp: new Date().toISOString(),
            path: request.url,
            details: { validation: error.validation },
          },
        });
      }
      return reply.code(error.statusCode || 500).send({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message,
          timestamp: new Date().toISOString(),
          path: request.url,
        },
      });
    });

    await app.register(authRoutes, { prefix: '/auth' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Removed endpoints (handled by Supabase)', () => {
    test('POST /auth/register should return 404', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'test@example.com',
          password: 'Password123!',
          name: 'Test User',
        },
      });

      expect(response.statusCode).toBe(404);
    });

    test('POST /auth/login should return 404', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'test@example.com',
          password: 'password123',
        },
      });

      expect(response.statusCode).toBe(404);
    });

    test('POST /auth/refresh should return 404', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: {
          refreshToken: 'some-token',
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /auth/logout', () => {
    test('should logout successfully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/logout',
        headers: {
          authorization: 'Bearer mock-supabase-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.message).toBe('Logged out successfully');
    });

    test('should return 401 without authorization header', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/logout',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /auth/me', () => {
    test('should return current user profile', async () => {
      mockUserMethods.findUnique.mockResolvedValue({
        id: 'test-user-id',
        email: 'test@example.com',
        raw_user_meta_data: { name: 'Test User' },
        created_at: new Date(),
        updated_at: new Date(),
      });

      const response = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: {
          authorization: 'Bearer mock-supabase-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.user).toBeDefined();
      expect(body.user.email).toBe('test@example.com');
      expect(body.user.name).toBe('Test User');
    });

    test('should extract name from full_name metadata', async () => {
      mockUserMethods.findUnique.mockResolvedValue({
        id: 'test-user-id',
        email: 'test@example.com',
        raw_user_meta_data: { full_name: 'Google User' },
        created_at: new Date(),
        updated_at: new Date(),
      });

      const response = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: {
          authorization: 'Bearer mock-supabase-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.user.name).toBe('Google User');
    });

    test('should fallback to email prefix for name', async () => {
      mockUserMethods.findUnique.mockResolvedValue({
        id: 'test-user-id',
        email: 'test@example.com',
        raw_user_meta_data: {},
        created_at: new Date(),
        updated_at: new Date(),
      });

      const response = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: {
          authorization: 'Bearer mock-supabase-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.user.name).toBe('test');
    });

    test('should return 401 without authorization header', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/auth/me',
      });

      expect(response.statusCode).toBe(401);
    });

    test('should return 404 if user not found in database', async () => {
      mockUserMethods.findUnique.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: {
          authorization: 'Bearer mock-supabase-token',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('RESOURCE_NOT_FOUND');
    });
  });
});
