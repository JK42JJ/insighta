import { test, expect } from '@playwright/test';

// Debug test — no auth required, checks basic page rendering
test('debug: page loads and renders content', async ({ page }) => {
  // Capture console logs
  const consoleLogs: string[] = [];
  page.on('console', (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => consoleLogs.push(`[PAGE_ERROR] ${err.message}`));

  // Navigate
  await page.goto('http://localhost:8082/v2/', { waitUntil: 'domcontentloaded' });

  // Wait a bit for React to render
  await page.waitForTimeout(3000);

  // Check what's on the page
  const html = await page.content();
  const bodyText = await page.locator('body').innerText().catch(() => '(empty)');

  console.log('=== Page URL:', page.url());
  console.log('=== Body text length:', bodyText.length);
  console.log('=== Body text preview:', bodyText.substring(0, 500));
  console.log('=== HTML length:', html.length);
  console.log('=== Console logs:', JSON.stringify(consoleLogs, null, 2));

  await page.screenshot({ path: 'test-results/debug-render.png', fullPage: true });

  // Should have some content
  expect(html.length).toBeGreaterThan(100);
});
