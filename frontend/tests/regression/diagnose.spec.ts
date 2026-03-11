import { test, expect } from '@playwright/test';

const APP_URL = 'http://localhost:8082/v2/';

test('diagnose: check auth state and API from page context', async ({ page }) => {
  const apiCalls: { url: string; status: number; body?: string }[] = [];

  page.on('response', async (resp) => {
    if (resp.url().includes('/api/') || resp.url().includes('supabase')) {
      const body = await resp.text().catch(() => '(read error)');
      apiCalls.push({ url: resp.url(), status: resp.status(), body: body.substring(0, 500) });
    }
  });

  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // Check localStorage for auth token
  const authData = await page.evaluate(() => {
    const keys = Object.keys(localStorage);
    const authKey = keys.find((k) => k.includes('auth-token'));
    return {
      allKeys: keys,
      authKey,
      authValue: authKey ? localStorage.getItem(authKey)?.substring(0, 200) : null,
    };
  });
  console.log('\n=== localStorage keys:', authData.allKeys);
  console.log('=== Auth key:', authData.authKey);
  console.log('=== Auth value preview:', authData.authValue);

  // Try to manually call the API from page context
  const apiResult = await page.evaluate(async () => {
    const authKey = Object.keys(localStorage).find((k) => k.includes('auth-token'));
    if (!authKey) return { error: 'No auth token in localStorage' };

    try {
      const tokenData = JSON.parse(localStorage.getItem(authKey) || '{}');
      const accessToken = tokenData.access_token;

      if (!accessToken) return { error: 'No access_token in auth data' };

      // Call the mandalas/list API directly
      const resp = await fetch('http://localhost:8081/api/v1/mandalas/list', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const body = await resp.json();
      return { status: resp.status, body };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  console.log('\n=== Direct API call result:', JSON.stringify(apiResult, null, 2));

  // Check sidebar
  const sidebar = page.locator('aside').first();
  const sidebarText = await sidebar.innerText().catch(() => '(not found)');
  console.log('\n=== Sidebar text:', sidebarText);

  console.log('\n=== All network calls:');
  for (const call of apiCalls) {
    console.log(`  ${call.status} ${call.url.substring(0, 100)}`);
  }

  await page.screenshot({ path: 'test-results/diagnose-full.png', fullPage: true });
  expect(true).toBe(true);
});
