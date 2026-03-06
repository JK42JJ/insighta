import { test, expect } from '@playwright/test';
import { getAuthToken, apiRequest } from './helpers';

let token: string;

test.beforeAll(async () => {
  token = await getAuthToken();
});

test.describe('Authenticated API', () => {
  test('GET /api/v1/auth/me returns user info', async () => {
    const res = await apiRequest('/api/v1/auth/me', token);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.email).toBe(process.env.E2E_TEST_EMAIL);
  });

  test('GET /api/v1/playlists returns array', async () => {
    const res = await apiRequest('/api/v1/playlists', token);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test('GET /api/v1/videos returns array', async () => {
    const res = await apiRequest('/api/v1/videos', token);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test('Unauthenticated request returns 401', async () => {
    const res = await apiRequest('/api/v1/auth/me', 'invalid-token');
    expect(res.status).toBe(401);
  });
});
