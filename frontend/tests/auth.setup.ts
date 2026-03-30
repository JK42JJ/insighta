import { test as setup, chromium } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const authFile = path.join(__dirname, '.auth/user.json');

setup('authenticate', async () => {
  // CI cannot perform manual OAuth login — skip and create empty auth state
  if (process.env.CI) {
    console.log('CI environment detected — skipping manual OAuth setup.');
    const authDir = path.dirname(authFile);
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }
    if (!fs.existsSync(authFile)) {
      fs.writeFileSync(authFile, JSON.stringify({ cookies: [], origins: [] }));
    }
    return;
  }

  // Skip if auth file already exists, is recent (less than 24h old), AND contains auth data
  if (fs.existsSync(authFile)) {
    const stat = fs.statSync(authFile);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs < 24 * 60 * 60 * 1000) {
      // Verify the file actually contains Supabase auth tokens, not just i18n
      try {
        const content = JSON.parse(fs.readFileSync(authFile, 'utf-8'));
        const hasAuth = content.origins?.some((o: { localStorage?: { name: string }[] }) =>
          o.localStorage?.some((ls: { name: string }) =>
            ls.name.includes('supabase') || ls.name.includes('sb-') || ls.name.includes('auth-token')
          )
        );
        if (hasAuth) {
          console.log('Auth session still valid, skipping login.');
          return;
        }
        console.log('Auth file exists but has no Supabase tokens — re-authenticating.');
      } catch {
        console.log('Auth file corrupted — re-authenticating.');
      }
    }
  }

  const authDir = path.dirname(authFile);
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  // Navigate to app landing
  const baseURL = process.env.BASE_URL || 'http://localhost:8081';
  await page.goto(`${baseURL}/`);
  await page.waitForLoadState('networkidle');

  console.log('\n========================================');
  console.log('  Chromium 창에서 로그인하세요.');
  console.log('  (Google OAuth → 로그인 완료 후');
  console.log('   자동으로 페이지로 이동합니다)');
  console.log('  (5분 타임아웃)');
  console.log('========================================\n');

  // Poll: after OAuth redirect, navigate back and check for authenticated state
  const startTime = Date.now();
  const timeout = 300_000; // 5 minutes

  while (Date.now() - startTime < timeout) {
    const url = page.url();

    // OAuth redirected away — user might have logged in
    if ((url.includes('localhost:8081') || url.includes('insighta.one')) && url.includes('#')) {
      console.log('OAuth redirect detected:', url);
      // Auth tokens should be in localStorage now, navigate back
      await page.goto(`${baseURL}/`);
      await page.waitForLoadState('networkidle');
    }

    // Check for authenticated state — look for elements only visible after login
    // NOTE: AppShell renders <aside> on all routes (even unauthenticated), so
    // we must check for auth-only content like the mandala grid or scratchpad.
    const isAuthenticated = await page
      .locator('[data-testid="mandala-grid"], [data-testid="scratchpad"], .mandala-cell')
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false);
    if (isAuthenticated) {
      console.log('Authenticated state detected (mandala grid visible).');
      await page.waitForTimeout(2000);
      await context.storageState({ path: authFile });
      console.log('Auth session saved to', authFile);
      await browser.close();
      return;
    }

    await page.waitForTimeout(2000);
  }

  await browser.close();
  throw new Error('Login timeout — could not detect authenticated state within 5 minutes');
});
