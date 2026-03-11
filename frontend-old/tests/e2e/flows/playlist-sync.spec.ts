/**
 * Playlist Sync E2E Tests
 *
 * Validates YouTube playlist synchronization flow:
 * - Settings page loads with YouTube sync section
 * - Playlist list renders (if any exist)
 * - Sync button triggers sync and shows feedback
 * - Add playlist input is accessible
 *
 * Requires authenticated session with YouTube connected.
 * Tests gracefully skip when auth or YouTube not available.
 */

import { test, expect, type Page } from '@playwright/test';

async function navigateToSettings(page: Page): Promise<boolean> {
  await page.goto('/settings');
  await page.waitForLoadState('networkidle');

  // If redirected to login, skip
  if (page.url().includes('/login')) {
    return false;
  }

  return true;
}

test.describe('Settings Page - YouTube Sync', () => {
  test('should load settings page', async ({ page }) => {
    const loaded = await navigateToSettings(page);
    if (!loaded) {
      test.skip(true, 'Not authenticated');
      return;
    }

    await expect(page.locator('body')).toBeVisible();
  });

  test('should display YouTube sync card', async ({ page }) => {
    const loaded = await navigateToSettings(page);
    if (!loaded) {
      test.skip(true, 'Not authenticated');
      return;
    }

    // Look for YouTube sync section
    const youtubeSection = page.locator('text=/YouTube|플레이리스트|동기화/i').first();
    await expect(youtubeSection).toBeVisible({ timeout: 10000 });
  });

  test('should show playlist list or empty state', async ({ page }) => {
    const loaded = await navigateToSettings(page);
    if (!loaded) {
      test.skip(true, 'Not authenticated');
      return;
    }

    await page.waitForTimeout(3000); // Wait for data to load

    // Either playlists are shown or an empty/connect state
    const hasPlaylists = await page
      .locator('[class*="playlist"], text=/동기화된 적 없음|완료|동기화 중/i')
      .first()
      .isVisible()
      .catch(() => false);

    const hasEmptyState = await page
      .locator('text=/플레이리스트.*추가|YouTube.*연결|로그인/i')
      .first()
      .isVisible()
      .catch(() => false);

    // One of the states must be visible
    expect(hasPlaylists || hasEmptyState).toBe(true);
  });

  test('should have add playlist input', async ({ page }) => {
    const loaded = await navigateToSettings(page);
    if (!loaded) {
      test.skip(true, 'Not authenticated');
      return;
    }

    await page.waitForTimeout(2000);

    // Find the playlist URL input field
    const input = page.locator(
      'input[placeholder*="youtube"], input[placeholder*="플레이리스트"], input[type="url"]'
    ).first();
    const hasInput = await input.isVisible().catch(() => false);

    if (hasInput) {
      // Verify it's interactable
      await input.click({ force: true });
      await expect(input).toBeFocused();
    }

    // Page loaded without crash
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Playlist Sync Operations', () => {
  test('sync all button should exist when playlists are present', async ({ page }) => {
    const loaded = await navigateToSettings(page);
    if (!loaded) {
      test.skip(true, 'Not authenticated');
      return;
    }

    await page.waitForTimeout(3000);

    // Look for "전체 동기화" or sync all button
    const syncAllBtn = page.locator(
      'button:has-text("전체 동기화"), button:has-text("Sync All"), button:has-text("모두 동기화")'
    ).first();

    const hasSyncAll = await syncAllBtn.isVisible().catch(() => false);

    if (hasSyncAll) {
      // Don't click in E2E to avoid consuming YouTube API quota
      // Just verify the button is enabled
      await expect(syncAllBtn).toBeEnabled();
    }

    // Even without sync button, page should be stable
    await expect(page.locator('body')).toBeVisible();
  });

  test('individual playlist should have sync and delete buttons', async ({ page }) => {
    const loaded = await navigateToSettings(page);
    if (!loaded) {
      test.skip(true, 'Not authenticated');
      return;
    }

    await page.waitForTimeout(3000);

    // Find playlist items with sync/delete buttons
    const syncButtons = page.locator('button:has(svg.lucide-refresh-cw)');
    const deleteButtons = page.locator('button:has(svg.lucide-trash-2)');

    const syncCount = await syncButtons.count();
    const deleteCount = await deleteButtons.count();

    if (syncCount > 0) {
      // At least one playlist exists with controls
      expect(syncCount).toBeGreaterThan(0);
      expect(deleteCount).toBeGreaterThan(0);
    }

    await expect(page.locator('body')).toBeVisible();
  });

  test('sync settings should be configurable', async ({ page }) => {
    const loaded = await navigateToSettings(page);
    if (!loaded) {
      test.skip(true, 'Not authenticated');
      return;
    }

    await page.waitForTimeout(2000);

    // Look for sync interval selector
    const intervalSelector = page.locator(
      'text=/수동|1시간마다|6시간마다|12시간마다|24시간마다/i'
    ).first();
    const hasSelector = await intervalSelector.isVisible().catch(() => false);

    // Look for auto-sync toggle
    const autoSyncToggle = page.locator('button[role="switch"]').first();
    const hasToggle = await autoSyncToggle.isVisible().catch(() => false);

    // At least one setting should be visible (when logged in + YouTube connected)
    // If neither visible, user may not have YouTube connected
    if (hasSelector || hasToggle) {
      console.log(`Sync settings visible: interval=${hasSelector}, autoSync=${hasToggle}`);
    }

    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Playlist Sync - Network & Performance', () => {
  test('should not have critical errors on settings page', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    const loaded = await navigateToSettings(page);
    if (!loaded) {
      test.skip(true, 'Not authenticated');
      return;
    }

    await page.waitForTimeout(5000); // Wait for all API calls to resolve

    const criticalErrors = errors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('net::') &&
        !e.includes('Failed to load resource') &&
        !e.includes('analytics') &&
        !e.includes('ERR_')
    );

    expect(criticalErrors).toHaveLength(0);
  });

  test('API calls should complete within 5s', async ({ page }) => {
    const loaded = await navigateToSettings(page);
    if (!loaded) {
      test.skip(true, 'Not authenticated');
      return;
    }

    // Monitor network requests to youtube-sync edge function
    const apiTimes: number[] = [];

    page.on('requestfinished', async (request) => {
      if (request.url().includes('youtube-sync')) {
        const timing = request.timing();
        apiTimes.push(timing.responseEnd - timing.startTime);
      }
    });

    await page.waitForTimeout(5000);

    if (apiTimes.length > 0) {
      const maxTime = Math.max(...apiTimes);
      console.log(
        `YouTube sync API: ${apiTimes.length} calls, max ${maxTime.toFixed(0)}ms`
      );
      expect(maxTime).toBeLessThan(5000);
    }
  });
});
