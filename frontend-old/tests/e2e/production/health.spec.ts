import { test, expect } from '@playwright/test';

test.describe('Production Health', () => {
  test('API /health returns 200', async ({ request }) => {
    const res = await request.get('https://insighta.one/health');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  test('Frontend loads with valid SSL', async ({ page }) => {
    const res = await page.goto('https://insighta.one');
    expect(res?.status()).toBe(200);
    expect(res?.url()).toMatch(/^https:\/\//);

    await expect(page).toHaveTitle(/Insighta/i);
  });
});
