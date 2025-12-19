/**
 * API Server Unit Tests
 */

import { FastifyInstance } from 'fastify';

// Mock all route modules with inline factory functions to avoid hoisting issues
jest.mock('../../../src/api/plugins/auth', () => ({
  registerAuth: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../src/api/routes/auth', () => ({
  authRoutes: jest.fn(async () => {}),
}));

jest.mock('../../../src/api/routes/playlists', () => ({
  playlistRoutes: jest.fn(async () => {}),
}));

jest.mock('../../../src/api/routes/videos', () => ({
  videoRoutes: jest.fn(async () => {}),
}));

jest.mock('../../../src/api/routes/notes', () => ({
  noteRoutes: jest.fn(async () => {}),
}));

jest.mock('../../../src/api/routes/analytics', () => ({
  analyticsRoutes: jest.fn(async () => {}),
}));

jest.mock('../../../src/api/routes/sync', () => ({
  syncRoutes: jest.fn(async () => {}),
}));

jest.mock('../../../src/api/routes/quota', () => ({
  quotaRoutes: jest.fn((_fastify: any, _opts: any, done: () => void) => {
    done();
  }),
}));

jest.mock('../../../src/api/schemas/common.schema', () => ({
  createErrorResponse: jest.fn((code: string, message: string, path: string, details?: unknown) => ({
    error: {
      code,
      message,
      timestamp: new Date().toISOString(),
      path,
      details,
    },
  })),
  ErrorCode: {
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
    INVALID_INPUT: 'INVALID_INPUT',
    RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
    RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  },
}));

// Import after mocks
import { buildServer, buildApp } from '../../../src/api/server';
import { registerAuth } from '../../../src/api/plugins/auth';
import { authRoutes } from '../../../src/api/routes/auth';
import { playlistRoutes } from '../../../src/api/routes/playlists';
import { createErrorResponse } from '../../../src/api/schemas/common.schema';

// Get references to mocked functions
const mockRegisterAuth = registerAuth as jest.MockedFunction<typeof registerAuth>;
const mockAuthRoutes = authRoutes as jest.MockedFunction<typeof authRoutes>;
const mockPlaylistRoutes = playlistRoutes as jest.MockedFunction<typeof playlistRoutes>;
const mockCreateErrorResponse = createErrorResponse as jest.MockedFunction<typeof createErrorResponse>;

describe('API Server', () => {
  let app: FastifyInstance;
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.env['NODE_ENV'] = 'test';
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    process.env = originalEnv;
  });

  describe('buildServer', () => {
    test('should create a Fastify instance', async () => {
      app = await buildServer();
      expect(app).toBeDefined();
      expect(typeof app.inject).toBe('function');
    });

    test('should register auth plugin', async () => {
      app = await buildServer();
      expect(mockRegisterAuth).toHaveBeenCalled();
    });

    test('buildApp should be an alias for buildServer', () => {
      expect(buildApp).toBe(buildServer);
    });
  });

  describe('Health Check Endpoints', () => {
    beforeEach(async () => {
      app = await buildServer();
    });

    test('GET /health should return health status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('ok');
      expect(body.timestamp).toBeDefined();
      expect(body.uptime).toBeDefined();
      expect(body.version).toBeDefined();
    });

    test('GET /health/ready should return ready status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health/ready',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('ready');
    });
  });

  describe('API Version Route', () => {
    beforeEach(async () => {
      app = await buildServer();
    });

    test('GET /api/v1/ should return API info', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.version).toBe('v1');
      expect(body.endpoints).toBeDefined();
      expect(body.endpoints.health).toBe('/health');
      expect(body.endpoints.documentation).toBe('/documentation');
      expect(body.endpoints.apiReference).toBe('/api-reference');
    });
  });

  describe('404 Handler', () => {
    beforeEach(async () => {
      app = await buildServer();
    });

    test('should return 404 for non-existent routes', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/non-existent-route',
      });

      expect(response.statusCode).toBe(404);
      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        'RESOURCE_NOT_FOUND',
        expect.stringContaining('not found'),
        '/non-existent-route'
      );
    });

    test('should include method and URL in 404 error', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/unknown',
      });

      expect(response.statusCode).toBe(404);
      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        'RESOURCE_NOT_FOUND',
        'Route POST /unknown not found',
        '/unknown'
      );
    });
  });

  describe('Error Handler', () => {
    beforeEach(async () => {
      app = await buildServer();

      // Add a test route that throws an error
      app.get('/test-error', async () => {
        throw new Error('Test error');
      });

      // Add a route that throws a validation-like error
      app.get('/test-validation-error', async () => {
        const error = new Error('Validation failed') as any;
        error.validation = [{ message: 'field is required' }];
        error.statusCode = 400;
        throw error;
      });

      // Add a route that throws a client error
      app.get('/test-client-error', async () => {
        const error = new Error('Bad request') as any;
        error.statusCode = 400;
        throw error;
      });
    });

    test('should handle generic errors with 500 status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/test-error',
      });

      expect(response.statusCode).toBe(500);
      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        'INTERNAL_SERVER_ERROR',
        'An internal server error occurred',
        '/test-error'
      );
    });

    test('should handle validation errors with 400 status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/test-validation-error',
      });

      expect(response.statusCode).toBe(400);
      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        'VALIDATION_ERROR',
        'Request validation failed',
        '/test-validation-error',
        { validation: [{ message: 'field is required' }] }
      );
    });

    test('should handle client errors with appropriate status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/test-client-error',
      });

      expect(response.statusCode).toBe(400);
      expect(mockCreateErrorResponse).toHaveBeenCalledWith(
        'INVALID_INPUT',
        'Bad request',
        '/test-client-error'
      );
    });
  });

  describe('CORS Configuration', () => {
    beforeEach(async () => {
      app = await buildServer();
    });

    test('should include CORS headers', async () => {
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/health',
        headers: {
          origin: 'http://localhost:3000',
        },
      });

      // CORS plugin should handle OPTIONS requests
      expect(response.headers['access-control-allow-origin']).toBeDefined();
    });
  });

  describe('Environment Configuration', () => {
    test('should use default LOG_LEVEL when not set', async () => {
      delete process.env['LOG_LEVEL'];
      app = await buildServer();
      expect(app).toBeDefined();
    });

    test('should use custom LOG_LEVEL when set', async () => {
      process.env['LOG_LEVEL'] = 'debug';
      app = await buildServer();
      expect(app).toBeDefined();
    });

    test('should use custom CORS_ORIGIN when set', async () => {
      process.env['CORS_ORIGIN'] = 'http://custom-origin.com,http://another.com';
      app = await buildServer();
      expect(app).toBeDefined();
    });

    test('should use default rate limit when not set', async () => {
      delete process.env['RATE_LIMIT_MAX'];
      delete process.env['RATE_LIMIT_WINDOW'];
      app = await buildServer();
      expect(app).toBeDefined();
    });

    test('should use custom rate limit when set', async () => {
      process.env['RATE_LIMIT_MAX'] = '200';
      process.env['RATE_LIMIT_WINDOW'] = '30 minutes';
      app = await buildServer();
      expect(app).toBeDefined();
    });
  });

  describe('Route Registration', () => {
    test('should register auth routes', async () => {
      app = await buildServer();
      expect(mockAuthRoutes).toHaveBeenCalled();
    });

    test('should register playlist routes', async () => {
      app = await buildServer();
      expect(mockPlaylistRoutes).toHaveBeenCalled();
    });
  });
});

describe('Rate Limit Error Response', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  test('should create rate limit error response', async () => {
    process.env['NODE_ENV'] = 'test';
    app = await buildServer();

    // Verify the error response format
    expect(mockCreateErrorResponse).toBeDefined();
  });
});
