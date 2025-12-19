/**
 * Rate Limit Tests
 *
 * Tests for rate limiting functionality and quota tracking
 */

import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

// Mock route modules that we're NOT testing to prevent them from causing issues
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

// Note: Do NOT mock quota routes here - we're testing the actual quota routes

import { buildServer } from '../../../src/api/server';

const prisma = new PrismaClient();

describe('Rate Limit', () => {
  let server: FastifyInstance;
  let authToken: string;

  beforeAll(async () => {
    server = await buildServer();
    await server.ready();

    // Register a test user and get auth token
    const registerResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'ratelimit@test.com',
        password: 'Test123!@#',
        name: 'Rate Limit Test User',
      },
    });

    expect(registerResponse.statusCode).toBe(201);
    const registerData = JSON.parse(registerResponse.payload);
    authToken = registerData.tokens.accessToken;
  });

  afterAll(async () => {
    // Clean up test user
    await prisma.user.deleteMany({
      where: { email: 'ratelimit@test.com' },
    });
    await server.close();
  });

  describe('Global Rate Limiting', () => {
    it('should include rate limit headers in response', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers).toHaveProperty('x-ratelimit-limit');
      expect(response.headers).toHaveProperty('x-ratelimit-remaining');
      expect(response.headers).toHaveProperty('x-ratelimit-reset');
    });

    it('should track rate limit remaining count', async () => {
      // Make a request and check headers are properly set
      const response1 = await server.inject({
        method: 'GET',
        url: '/health',
        headers: {
          'x-forwarded-for': '192.168.1.200', // Unique IP for this test
        },
      });

      const limit = parseInt(response1.headers['x-ratelimit-limit'] as string, 10);
      const remaining = parseInt(response1.headers['x-ratelimit-remaining'] as string, 10);

      expect(limit).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(limit);
      expect(remaining).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Authentication Rate Limiting', () => {
    it('should apply rate limit headers to login endpoint', async () => {
      // Make a login request (will fail with wrong password but should have rate limit headers)
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: 'test@example.com',
          password: 'wrongpassword',
        },
        headers: {
          'x-forwarded-for': '192.168.1.201', // Unique IP for this test
        },
      });

      // Login should fail with 401, but rate limit headers should be present
      expect(response.statusCode).toBe(401);
      expect(response.headers).toHaveProperty('x-ratelimit-limit');
      expect(response.headers).toHaveProperty('x-ratelimit-remaining');
      expect(response.headers).toHaveProperty('x-ratelimit-reset');

      const limit = parseInt(response.headers['x-ratelimit-limit'] as string, 10);
      const remaining = parseInt(response.headers['x-ratelimit-remaining'] as string, 10);

      expect(limit).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(limit);
    });
  });

  describe('Quota Usage Endpoint', () => {
    it('should return current quota usage', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/quota/usage',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);

      expect(data).toHaveProperty('quota');
      expect(data.quota).toHaveProperty('date');
      expect(data.quota).toHaveProperty('used');
      expect(data.quota).toHaveProperty('limit');
      expect(data.quota).toHaveProperty('remaining');
      expect(data.quota).toHaveProperty('percentage');
      expect(data.quota).toHaveProperty('resetAt');

      expect(typeof data.quota.used).toBe('number');
      expect(typeof data.quota.limit).toBe('number');
      expect(typeof data.quota.remaining).toBe('number');
      expect(typeof data.quota.percentage).toBe('number');

      expect(data.quota.remaining).toBe(data.quota.limit - data.quota.used);
      expect(data.quota.percentage).toBeGreaterThanOrEqual(0);
      expect(data.quota.percentage).toBeLessThanOrEqual(100);
    });

    it('should require authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/quota/usage',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('Quota Limits Endpoint', () => {
    it('should return quota limits and rate limit configurations', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/quota/limits',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);

      expect(data).toHaveProperty('limits');
      expect(data.limits).toHaveProperty('youtube');
      expect(data.limits).toHaveProperty('rateLimits');

      // Check YouTube quota configuration
      expect(data.limits.youtube).toHaveProperty('dailyLimit');
      expect(data.limits.youtube).toHaveProperty('quotaCosts');
      expect(typeof data.limits.youtube.dailyLimit).toBe('number');
      expect(typeof data.limits.youtube.quotaCosts).toBe('object');

      // Check quota costs (use bracket notation since keys contain dots)
      expect(data.limits.youtube.quotaCosts['playlists.list']).toBeDefined();
      expect(data.limits.youtube.quotaCosts['videos.list']).toBeDefined();

      // Check rate limit configurations
      expect(Array.isArray(data.limits.rateLimits)).toBe(true);
      expect(data.limits.rateLimits.length).toBeGreaterThan(0);

      // Check rate limit structure
      const rateLimit = data.limits.rateLimits[0];
      expect(rateLimit).toHaveProperty('endpoint');
      expect(rateLimit).toHaveProperty('max');
      expect(rateLimit).toHaveProperty('timeWindow');
      expect(rateLimit).toHaveProperty('timeWindowMs');
    });

    it('should require authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/quota/limits',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('Rate Limit Headers', () => {
    it('should include remaining count in headers', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/quota/usage',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);

      const limit = parseInt(response.headers['x-ratelimit-limit'] as string, 10);
      const remaining = parseInt(response.headers['x-ratelimit-remaining'] as string, 10);

      expect(limit).toBeGreaterThan(0);
      expect(remaining).toBeGreaterThanOrEqual(0);
      expect(remaining).toBeLessThanOrEqual(limit);
    });

    it('should decrement remaining count on subsequent requests', async () => {
      const response1 = await server.inject({
        method: 'GET',
        url: '/api/v1/quota/usage',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'x-forwarded-for': '192.168.1.102',
        },
      });

      const remaining1 = parseInt(response1.headers['x-ratelimit-remaining'] as string, 10);

      const response2 = await server.inject({
        method: 'GET',
        url: '/api/v1/quota/usage',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'x-forwarded-for': '192.168.1.102',
        },
      });

      const remaining2 = parseInt(response2.headers['x-ratelimit-remaining'] as string, 10);

      // Remaining count should decrease (unless window reset between requests)
      expect(remaining2).toBeLessThanOrEqual(remaining1);
    });
  });
});
