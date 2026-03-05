/**
 * Playwright Auth Setup
 *
 * Injects a Supabase session into browser localStorage so that
 * subsequent E2E tests run in an authenticated context.
 *
 * Activation: PLAYWRIGHT_AUTH=true + SUPABASE_TEST_ACCESS_TOKEN env vars.
 * When not set, this setup is a no-op and auth-dependent tests skip gracefully.
 */

import { test as setup } from '@playwright/test';
import path from 'path';

export const AUTH_STATE_PATH = path.join(__dirname, '../../.auth/user.json');

setup('authenticate via Supabase token injection', async ({ page }) => {
  const authEnabled = process.env.PLAYWRIGHT_AUTH === 'true';
  const accessToken = process.env.SUPABASE_TEST_ACCESS_TOKEN;
  const refreshToken = process.env.SUPABASE_TEST_REFRESH_TOKEN || 'e2e-refresh-token';

  if (!authEnabled || !accessToken) {
    // Save empty storage state so dependent projects don't fail
    await page.context().storageState({ path: AUTH_STATE_PATH });
    return;
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || 'http://localhost:8000';
  // Supabase stores auth in localStorage under this key pattern
  const storageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;

  const sessionPayload = JSON.stringify({
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user: {
      id: 'e2e-test-user',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'e2e@test.local',
      app_metadata: { provider: 'google', providers: ['google'] },
      user_metadata: { full_name: 'E2E Test User' },
      created_at: new Date().toISOString(),
    },
  });

  // Navigate to app origin so localStorage is scoped correctly
  await page.goto('/');
  await page.evaluate(
    ({ key, value }) => {
      localStorage.setItem(key, value);
    },
    { key: storageKey, value: sessionPayload }
  );

  // Persist authenticated state for reuse across test projects
  await page.context().storageState({ path: AUTH_STATE_PATH });
});
