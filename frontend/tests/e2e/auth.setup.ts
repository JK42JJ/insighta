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
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const AUTH_STATE_PATH = path.join(__dirname, '../../.auth/user.json');

const isProduction = process.env.E2E_TARGET === 'production';

setup('authenticate via Supabase token injection', async ({ page }) => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || 'http://localhost:8000';
  const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
  const storageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;

  // Production: real email/password login via Supabase SDK
  if (isProduction) {
    const email = process.env.E2E_TEST_EMAIL;
    const password = process.env.E2E_TEST_PASSWORD;

    if (!email || !password) {
      console.warn('E2E_TEST_EMAIL/PASSWORD not set — skipping production auth');
      await page.context().storageState({ path: AUTH_STATE_PATH });
      return;
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data.session) {
      throw new Error(`Production auth failed: ${error?.message || 'no session'}`);
    }

    const sessionPayload = JSON.stringify({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_in: data.session.expires_in,
      expires_at: data.session.expires_at,
      token_type: 'bearer',
      user: data.session.user,
    });

    await page.goto('/');
    await page.evaluate(
      ({ key, value }) => localStorage.setItem(key, value),
      { key: storageKey, value: sessionPayload }
    );
    await page.context().storageState({ path: AUTH_STATE_PATH });
    return;
  }

  // Local: mock token injection (existing behavior)
  const authEnabled = process.env.PLAYWRIGHT_AUTH === 'true';
  const accessToken = process.env.SUPABASE_TEST_ACCESS_TOKEN;
  const refreshToken = process.env.SUPABASE_TEST_REFRESH_TOKEN || 'e2e-refresh-token';

  if (!authEnabled || !accessToken) {
    await page.context().storageState({ path: AUTH_STATE_PATH });
    return;
  }

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

  await page.goto('/');
  await page.evaluate(
    ({ key, value }) => localStorage.setItem(key, value),
    { key: storageKey, value: sessionPayload }
  );
  await page.context().storageState({ path: AUTH_STATE_PATH });
});
