/**
 * Auth API Routes Unit Tests
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

const mockRefreshTokenMethods = {
  create: jest.fn(),
  findFirst: jest.fn(),
  delete: jest.fn(),
  deleteMany: jest.fn(),
};

const mockTransaction = jest.fn((callback: any) => callback({
  user: mockUserMethods,
  refreshToken: mockRefreshTokenMethods,
}));

// Mock modules before importing authRoutes
jest.mock('../../../../src/modules/database/client', () => ({
  db: {
    user: mockUserMethods,
    refreshToken: mockRefreshTokenMethods,
    $transaction: mockTransaction,
  },
  getPrismaClient: () => ({
    user: mockUserMethods,
    refreshToken: mockRefreshTokenMethods,
    $transaction: mockTransaction,
  }),
  prisma: {
    user: mockUserMethods,
    refreshToken: mockRefreshTokenMethods,
    $transaction: mockTransaction,
  },
}));

// Mock bcrypt
jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
  compare: jest.fn().mockResolvedValue(true),
}));

// Mock auth plugin functions
jest.mock('../../../../src/api/plugins/auth', () => ({
  createJWTPayload: jest.fn((user) => ({
    userId: user.id,
    email: user.email,
    name: user.name,
  })),
  verifyRefreshToken: jest.fn().mockResolvedValue({
    userId: 'test-user-id',
    email: 'test@example.com',
    name: 'Test User',
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

describe('Auth Routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });

    // Register generateTokens decorator
    app.decorate('generateTokens', async () => ({
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
      expiresIn: 900,
    }));

    // Register JWT decorator with all required properties
    app.decorate('jwt', {
      sign: jest.fn().mockReturnValue('mock-token'),
      verify: jest.fn(),
      decode: jest.fn(),
      lookupToken: jest.fn(),
      options: {},
    } as any);

    // Register authenticate decorator - must properly stop request processing
    app.decorate('authenticate', async function (request: any, reply: any) {
      if (request.headers.authorization) {
        request.user = { userId: 'test-user-id' };
      } else {
        reply.hijack();
        reply.raw.statusCode = 401;
        reply.raw.setHeader('content-type', 'application/json');
        reply.raw.end(JSON.stringify({ error: 'Unauthorized' }));
      }
    });

    // Custom error handler to format validation errors correctly
    app.setErrorHandler((error, request, reply) => {
      if (error.validation) {
        // Fastify validation error - format it correctly
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
      // For other errors, return as-is
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

  describe('POST /auth/register', () => {
    const validRegisterPayload = {
      email: 'test@example.com',
      password: 'Password123!',
      name: 'Test User',
    };

    test('should register a new user successfully', async () => {
      mockUserMethods.findUnique.mockResolvedValue(null);
      mockUserMethods.create.mockResolvedValue({
        id: 'new-user-id',
        email: 'test@example.com',
        name: 'Test User',
        passwordHash: 'hashed-password',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: validRegisterPayload,
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.user).toBeDefined();
      expect(body.user.email).toBe('test@example.com');
      expect(body.tokens).toBeDefined();
      expect(body.tokens.accessToken).toBe('mock-access-token');
    });

    test('should convert email to lowercase', async () => {
      mockUserMethods.findUnique.mockResolvedValue(null);
      mockUserMethods.create.mockResolvedValue({
        id: 'new-user-id',
        email: 'test@example.com',
        name: 'Test User',
        passwordHash: 'hashed-password',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'TEST@EXAMPLE.COM',
          password: 'Password123!',
          name: 'Test User',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.user.email).toBe('test@example.com');
    });

    test('should return 409 if email already exists', async () => {
      mockUserMethods.findUnique.mockResolvedValue({
        id: 'existing-user-id',
        email: 'test@example.com',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: validRegisterPayload,
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('RESOURCE_ALREADY_EXISTS');
    });

    test('should return 400 for invalid email format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'invalid-email',
          password: 'Password123!',
          name: 'Test User',
        },
      });

      // Fastify schema validation catches invalid email format and returns 400
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should return 400 for short password', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'test@example.com',
          password: '123',
          name: 'Test User',
        },
      });

      // Fastify schema validation catches short password and returns 400
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should return 400 for password without special characters', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'test@example.com',
          password: 'Password123',
          name: 'Test User',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    test('should return 400 for missing name field', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'test@example.com',
          password: 'Password123!',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should return 400 for empty name', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'test@example.com',
          password: 'Password123!',
          name: '',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    test('should handle database error during registration', async () => {
      mockUserMethods.findUnique.mockResolvedValue(null);
      mockUserMethods.create.mockRejectedValue(new Error('Database connection failed'));

      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: validRegisterPayload,
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INTERNAL_SERVER_ERROR');
    });
  });

  describe('POST /auth/login', () => {
    test('should login successfully with valid credentials', async () => {
      mockUserMethods.findUnique.mockResolvedValue({
        id: 'user-id',
        email: 'test@example.com',
        passwordHash: 'hashed-password',
        name: 'Test User',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const bcrypt = require('bcrypt');
      bcrypt.compare.mockResolvedValue(true);

      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'test@example.com',
          password: 'password123',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.user).toBeDefined();
      expect(body.tokens).toBeDefined();
      expect(body.tokens.accessToken).toBe('mock-access-token');
    });

    test('should handle case-insensitive email login', async () => {
      mockUserMethods.findUnique.mockResolvedValue({
        id: 'user-id',
        email: 'test@example.com',
        passwordHash: 'hashed-password',
        name: 'Test User',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const bcrypt = require('bcrypt');
      bcrypt.compare.mockResolvedValue(true);

      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'TEST@EXAMPLE.COM',
          password: 'password123',
        },
      });

      expect(response.statusCode).toBe(200);
    });

    test('should return 401 for non-existent user', async () => {
      mockUserMethods.findUnique.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'nonexistent@example.com',
          password: 'password123',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INVALID_CREDENTIALS');
    });

    test('should return 401 for invalid password', async () => {
      mockUserMethods.findUnique.mockResolvedValue({
        id: 'user-id',
        email: 'test@example.com',
        passwordHash: 'hashed-password',
        name: 'Test User',
      });

      const bcrypt = require('bcrypt');
      bcrypt.compare.mockResolvedValue(false);

      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'test@example.com',
          password: 'wrongpassword',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INVALID_CREDENTIALS');
    });

    test('should return 400 for missing password', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'test@example.com',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    test('should handle database error during login', async () => {
      mockUserMethods.findUnique.mockRejectedValue(new Error('Database connection failed'));

      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'test@example.com',
          password: 'password123',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INTERNAL_SERVER_ERROR');
    });
  });

  describe('POST /auth/refresh', () => {
    test('should refresh access token with valid refresh token', async () => {
      const { verifyRefreshToken } = require('../../../../src/api/plugins/auth');
      verifyRefreshToken.mockResolvedValue({
        userId: 'user-id',
        email: 'test@example.com',
        name: 'Test User',
      });

      mockUserMethods.findUnique.mockResolvedValue({
        id: 'user-id',
        email: 'test@example.com',
        name: 'Test User',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: {
          refreshToken: 'valid-refresh-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.tokens).toBeDefined();
      expect(body.tokens.accessToken).toBe('mock-access-token');
    });

    test('should return 401 for invalid refresh token', async () => {
      const { verifyRefreshToken } = require('../../../../src/api/plugins/auth');
      verifyRefreshToken.mockRejectedValue(new Error('Invalid token'));

      const response = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: {
          refreshToken: 'invalid-token',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INVALID_TOKEN');
    });

    test('should return 401 for expired refresh token', async () => {
      const { verifyRefreshToken } = require('../../../../src/api/plugins/auth');
      const error = new Error('REFRESH_TOKEN_EXPIRED');
      verifyRefreshToken.mockRejectedValue(error);

      const response = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: {
          refreshToken: 'expired-refresh-token',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('TOKEN_EXPIRED');
    });

    test('should return 401 if user not found during refresh', async () => {
      const { verifyRefreshToken } = require('../../../../src/api/plugins/auth');
      verifyRefreshToken.mockResolvedValue({
        userId: 'deleted-user-id',
        email: 'deleted@example.com',
        name: 'Deleted User',
      });

      mockUserMethods.findUnique.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: {
          refreshToken: 'valid-refresh-token',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    test('should return 400 for missing refresh token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    test('should handle database error during refresh', async () => {
      const { verifyRefreshToken } = require('../../../../src/api/plugins/auth');
      verifyRefreshToken.mockResolvedValue({
        userId: 'user-id',
        email: 'test@example.com',
        name: 'Test User',
      });

      mockUserMethods.findUnique.mockRejectedValue(new Error('Database error'));

      const response = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: {
          refreshToken: 'valid-refresh-token',
        },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('POST /auth/logout', () => {
    test('should logout successfully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/logout',
        headers: {
          authorization: 'Bearer mock-token',
        },
        payload: {
          refreshToken: 'valid-refresh-token',
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
        payload: {
          refreshToken: 'valid-refresh-token',
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /auth/me', () => {
    test('should return current user profile', async () => {
      mockUserMethods.findUnique.mockResolvedValue({
        id: 'test-user-id',
        email: 'test@example.com',
        name: 'Test User',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: {
          authorization: 'Bearer mock-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.user).toBeDefined();
      expect(body.user.email).toBe('test@example.com');
    });

    test('should return 401 without authorization header', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/auth/me',
      });

      expect(response.statusCode).toBe(401);
    });

    test('should return 500 if user not found', async () => {
      mockUserMethods.findUnique.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: {
          authorization: 'Bearer mock-token',
        },
      });

      expect(response.statusCode).toBe(500);
    });
  });
});
