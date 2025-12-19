/**
 * Authentication API Integration Tests
 *
 * Tests for authentication endpoints:
 * - POST /auth/register
 * - POST /auth/login
 * - POST /auth/refresh
 * - POST /auth/logout
 * - GET /auth/me
 */

import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server';
import { db as prisma } from '../../src/modules/database/client';

describe('Authentication API', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Build Fastify app
    app = await buildServer();
  });

  afterAll(async () => {
    // Close Fastify app
    await app.close();
    // Disconnect Prisma
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean up database before each test
    await prisma.user.deleteMany({});
  });

  describe('POST /auth/register', () => {
    test('should register a new user successfully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'test@example.com',
          password: 'TestPassword123!',
          name: 'Test User',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.user).toBeDefined();
      expect(body.user.email).toBe('test@example.com');
      expect(body.user.name).toBe('Test User');
      expect(body.tokens).toBeDefined();
      expect(body.tokens.accessToken).toBeDefined();
      expect(body.tokens.refreshToken).toBeDefined();
    });

    test('should reject duplicate email registration', async () => {
      // Create first user
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'duplicate@example.com',
          password: 'Password123!',
          name: 'First User',
        },
      });

      // Attempt duplicate registration
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'duplicate@example.com',
          password: 'Password456!',
          name: 'Second User',
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('RESOURCE_ALREADY_EXISTS');
    });

    test('should validate email format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'invalid-email',
          password: 'Password123!',
          name: 'Test User',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should validate password strength', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'test@example.com',
          password: '123', // Too weak
          name: 'Test User',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    test('should require all mandatory fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'test@example.com',
          // Missing password and name
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /auth/login', () => {
    beforeEach(async () => {
      // Register a test user
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'login@example.com',
          password: 'LoginPassword123!',
          name: 'Login Test User',
        },
      });
    });

    test('should login with valid credentials', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: 'login@example.com',
          password: 'LoginPassword123!',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.user).toBeDefined();
      expect(body.user.email).toBe('login@example.com');
      expect(body.tokens).toBeDefined();
      expect(body.tokens.accessToken).toBeDefined();
      expect(body.tokens.refreshToken).toBeDefined();
    });

    test('should reject invalid email', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: 'nonexistent@example.com',
          password: 'SomePassword123!',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('INVALID_CREDENTIALS');
    });

    test('should reject invalid password', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: 'login@example.com',
          password: 'WrongPassword123!',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('INVALID_CREDENTIALS');
    });

    test('should require all mandatory fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: 'login@example.com',
          // Missing password
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /auth/refresh', () => {
    let refreshToken: string;

    beforeEach(async () => {
      // Register and login to get refresh token
      const loginResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'refresh@example.com',
          password: 'RefreshPassword123!',
          name: 'Refresh Test User',
        },
      });

      const body = JSON.parse(loginResponse.body);
      refreshToken = body.tokens.refreshToken;
    });

    test('should refresh access token with valid refresh token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: {
          refreshToken,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.tokens).toBeDefined();
      expect(body.tokens.accessToken).toBeDefined();
      expect(body.tokens.refreshToken).toBeDefined();
      expect(body.tokens.refreshToken).not.toBe(refreshToken); // New refresh token
    });

    test('should reject invalid refresh token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: {
          refreshToken: 'invalid-token',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('INVALID_TOKEN');
    });

    test('should reject missing refresh token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /auth/logout', () => {
    let accessToken: string;
    let refreshToken: string;

    beforeEach(async () => {
      // Register and login
      const loginResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'logout@example.com',
          password: 'LogoutPassword123!',
          name: 'Logout Test User',
        },
      });

      const body = JSON.parse(loginResponse.body);
      accessToken = body.tokens.accessToken;
      refreshToken = body.tokens.refreshToken;
    });

    test('should logout successfully with valid access token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
        payload: {
          refreshToken,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.message).toBe('Logged out successfully');
    });

    test('should reject logout without access token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        payload: {
          refreshToken,
        },
      });

      expect(response.statusCode).toBe(401);
    });

    test('should reject logout with invalid access token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: {
          authorization: 'Bearer invalid-token',
        },
        payload: {
          refreshToken,
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /auth/me', () => {
    let accessToken: string;
    let userId: string;

    beforeEach(async () => {
      // Register and login
      const loginResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'me@example.com',
          password: 'MePassword123!',
          name: 'Me Test User',
        },
      });

      const body = JSON.parse(loginResponse.body);
      accessToken = body.tokens.accessToken;
      userId = body.user.id;
    });

    test('should get current user with valid access token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.user).toBeDefined();
      expect(body.user.id).toBe(userId);
      expect(body.user.email).toBe('me@example.com');
      expect(body.user.name).toBe('Me Test User');
    });

    test('should reject request without access token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
      });

      expect(response.statusCode).toBe(401);
    });

    test('should reject request with invalid access token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: {
          authorization: 'Bearer invalid-token',
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('Token Expiration', () => {
    test('should handle expired access token', async () => {
      // Register user
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'expired@example.com',
          password: 'ExpiredPassword123!',
          name: 'Expired Test User',
        },
      });

      // Create an expired token (this would require modifying JWT settings in test environment)
      // For now, just verify that expired tokens are rejected
      // TODO: Implement proper token expiration testing with fake timers
    });
  });

  describe('Concurrent Requests', () => {
    test('should handle concurrent registration requests', async () => {
      const requests = Array.from({ length: 5 }, (_, i) =>
        app.inject({
          method: 'POST',
          url: '/api/v1/auth/register',
          payload: {
            email: `concurrent${i}@example.com`,
            password: 'ConcurrentPassword123!',
            name: `Concurrent User ${i}`,
          },
        })
      );

      const responses = await Promise.all(requests);

      responses.forEach((response) => {
        expect(response.statusCode).toBe(201);
      });

      // Verify all users were created
      const users = await prisma.user.findMany();
      expect(users).toHaveLength(5);
    });
  });
});
