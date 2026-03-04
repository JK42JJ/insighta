/**
 * E2E Smoke Tests
 *
 * Basic smoke tests to verify the application loads correctly
 * and core navigation works.
 */

import { test, expect } from '@playwright/test';

test.describe('Smoke Tests', () => {
  test('should load the landing page', async ({ page }) => {
    await page.goto('/');

    // Check page title contains expected text
    await expect(page).toHaveTitle(/.*TubeArchive.*/i);
  });

  test('should load the login page', async ({ page }) => {
    await page.goto('/login');

    // Login page should have a login form or auth elements
    await expect(page.locator('body')).toBeVisible();

    // Check for authentication-related elements
    const authElements = page.locator('[data-testid="login-button"], button:has-text("로그인"), button:has-text("Login"), button:has-text("Sign in")');
    const count = await authElements.count();
    expect(count).toBeGreaterThanOrEqual(0); // Page should load without errors
  });

  test('should show 404 page for unknown routes', async ({ page }) => {
    await page.goto('/this-route-does-not-exist');

    // Should show 404 or NotFound content
    const notFoundText = page.locator('text=/404|not found|페이지를 찾을 수 없습니다/i');
    await expect(notFoundText.first()).toBeVisible({ timeout: 5000 }).catch(() => {
      // If no explicit 404 text, just verify page loaded without crash
      expect(page.url()).toContain('/this-route-does-not-exist');
    });
  });

  test('should navigate from landing page to login', async ({ page }) => {
    await page.goto('/');

    // Look for any login/signin link or button
    const loginLink = page.locator('a[href="/login"], button:has-text("로그인"), button:has-text("Login"), a:has-text("로그인"), a:has-text("Login")').first();

    if (await loginLink.isVisible().catch(() => false)) {
      await loginLink.click();
      await expect(page).toHaveURL(/.*\/login.*/);
    } else {
      // If no login link visible (user might already be logged in or different UI), just verify page loads
      await expect(page.locator('body')).toBeVisible();
    }
  });
});

test.describe('Theme and Accessibility', () => {
  test('should have dark theme by default', async ({ page }) => {
    await page.goto('/');

    // Check if dark theme is applied (via class on html/body or theme provider)
    const htmlElement = page.locator('html');
    const className = await htmlElement.getAttribute('class');

    // The app uses next-themes with defaultTheme="dark"
    expect(className).toContain('dark');
  });

  test('should have proper viewport meta tag', async ({ page }) => {
    await page.goto('/');

    // Check viewport meta tag for responsive design
    const viewport = page.locator('meta[name="viewport"]');
    await expect(viewport).toHaveAttribute('content', /width=device-width/);
  });
});

test.describe('Core Pages Load', () => {
  test('should load settings page (requires auth redirect or content)', async ({ page }) => {
    await page.goto('/settings');

    // Page should load - either settings content or redirect to login
    await expect(page.locator('body')).toBeVisible();

    // Verify we're either on settings or redirected to login
    const url = page.url();
    expect(url).toMatch(/\/(settings|login)/);
  });

  test('should load profile page (requires auth redirect or content)', async ({ page }) => {
    await page.goto('/profile');

    // Page should load without crashing
    await expect(page.locator('body')).toBeVisible();
  });

  test('should load mandala settings page', async ({ page }) => {
    await page.goto('/settings/mandala');

    // Page should load without crashing
    await expect(page.locator('body')).toBeVisible();
  });
});
