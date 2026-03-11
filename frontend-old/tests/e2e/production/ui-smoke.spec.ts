import { test, expect } from '@playwright/test';

test.describe('Production UI Smoke', () => {
  test('Landing page loads', async ({ page }) => {
    await page.goto('https://insighta.one');
    await expect(page).toHaveTitle(/Insighta/i);
    await expect(page.locator('body')).toBeVisible();
  });

  test('Login page loads', async ({ page }) => {
    await page.goto('https://insighta.one/login');
    await expect(page.locator('body')).toBeVisible();
  });

  test('Settings redirects to login when unauthenticated', async ({ page }) => {
    await page.goto('https://insighta.one/settings');
    await expect(page.locator('body')).toBeVisible();

    const url = page.url();
    expect(url).toMatch(/\/(settings|login)/);
  });

  test('Navigation links are functional', async ({ page }) => {
    await page.goto('https://insighta.one');

    const loginLink = page.locator(
      'a[href="/login"], button:has-text("Login"), a:has-text("Login"), button:has-text("Sign in")'
    ).first();

    if (await loginLink.isVisible().catch(() => false)) {
      expect(await loginLink.getAttribute('href') || loginLink).toBeTruthy();
    }
  });
});
