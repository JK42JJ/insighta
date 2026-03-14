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

  // Skip if auth file already exists and is recent (less than 24h old)
  if (fs.existsSync(authFile)) {
    const stat = fs.statSync(authFile);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs < 24 * 60 * 60 * 1000) {
      console.log('Auth session still valid, skipping login.');
      return;
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
  await page.goto('http://localhost:8081/');
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
    if (url.includes('localhost:8081') && url.includes('#')) {
      console.log('OAuth redirect detected:', url);
      // Auth tokens should be in localStorage now, navigate back
      await page.goto('http://localhost:8081/');
      await page.waitForLoadState('networkidle');
    }

    // Check for authenticated state (sidebar)
    const hasAside = await page.locator('aside').isVisible().catch(() => false);
    if (hasAside) {
      console.log('Authenticated state detected.');
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
