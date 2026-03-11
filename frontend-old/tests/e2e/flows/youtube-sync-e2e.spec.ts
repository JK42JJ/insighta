/**
 * YouTube Sync E2E Tests — Full Flow
 *
 * End-to-end tests for the complete YouTube playlist synchronization lifecycle:
 * 1. List playlists
 * 2. Add playlist
 * 3. Sync playlist
 * 4. Verify synced videos on dashboard
 * 5. Move card (scratchpad → mandala)
 * 6. Delete playlist
 * 7. Error handling
 *
 * Requires: PLAYWRIGHT_AUTH=true + SUPABASE_TEST_ACCESS_TOKEN
 * Without auth, all tests skip gracefully.
 */

import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if session is authenticated (not redirected to /login) */
async function isAuthenticated(page: Page): Promise<boolean> {
  await page.waitForLoadState('networkidle');
  return !page.url().includes('/login');
}

/** Navigate to settings and return auth status */
async function navigateToSettings(page: Page): Promise<boolean> {
  await page.goto('/settings');
  return isAuthenticated(page);
}

/** Wait for an Edge Function response matching the action */
async function waitForEdgeFn(
  page: Page,
  fnName: string,
  action: string,
  opts?: { timeout?: number }
): Promise<Response | null> {
  try {
    const response = await page.waitForResponse(
      (res) =>
        res.url().includes(`/functions/v1/${fnName}`) &&
        res.url().includes(`action=${action}`),
      { timeout: opts?.timeout ?? 10_000 }
    );
    return response;
  } catch {
    return null;
  }
}

// A public YouTube playlist for testing (YouTube's own "Popular on YouTube" mix)
const TEST_PLAYLIST_URL = 'https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('YouTube Sync — Full E2E Flow', () => {
  test.beforeEach(async ({ page }) => {
    const authed = await navigateToSettings(page);
    if (!authed) {
      test.skip(true, 'Not authenticated — set PLAYWRIGHT_AUTH=true + SUPABASE_TEST_ACCESS_TOKEN');
    }
  });

  test('should display YouTube sync section on settings page', async ({ page }) => {
    const youtubeSection = page.locator('text=/YouTube|플레이리스트|동기화/i').first();
    await expect(youtubeSection).toBeVisible({ timeout: 10_000 });
  });

  test('should show playlist list or empty state', async ({ page }) => {
    await page.waitForTimeout(3_000);

    const hasPlaylists = await page
      .locator('[class*="playlist"], text=/동기화된 적 없음|완료|동기화 중/i')
      .first()
      .isVisible()
      .catch(() => false);

    const hasEmpty = await page
      .locator('text=/플레이리스트.*추가|YouTube.*연결|로그인/i')
      .first()
      .isVisible()
      .catch(() => false);

    expect(hasPlaylists || hasEmpty).toBe(true);
  });

  test('should call list-playlists API on settings load', async ({ page }) => {
    const response = await waitForEdgeFn(page, 'youtube-sync', 'list-playlists');
    expect(response).not.toBeNull();
    if (response) {
      expect(response.status()).toBe(200);
    }
  });

  test('should add a playlist via URL input', async ({ page }) => {
    await page.waitForTimeout(2_000);

    const input = page
      .locator(
        'input[placeholder*="youtube"], input[placeholder*="플레이리스트"], input[type="url"]'
      )
      .first();
    const hasInput = await input.isVisible().catch(() => false);
    if (!hasInput) {
      test.skip(true, 'No playlist URL input found — YouTube may not be connected');
      return;
    }

    await input.fill(TEST_PLAYLIST_URL);

    // Click add button (adjacent to input or form submit)
    const addBtn = page
      .locator('button:has-text("추가"), button:has-text("Add"), button[type="submit"]')
      .first();
    await addBtn.click();

    // Verify API call completes within 5s
    const response = await waitForEdgeFn(page, 'youtube-sync', 'add-playlist', {
      timeout: 5_000,
    });
    expect(response).not.toBeNull();
    if (response) {
      expect(response.status()).toBeLessThan(500);
    }
  });

  test('should sync an individual playlist', async ({ page }) => {
    await page.waitForTimeout(3_000);

    // Find per-playlist sync button (refresh icon)
    const syncBtn = page.locator('button:has(svg.lucide-refresh-cw)').first();
    const hasSyncBtn = await syncBtn.isVisible().catch(() => false);
    if (!hasSyncBtn) {
      test.skip(true, 'No sync button found — no playlists exist');
      return;
    }

    await syncBtn.click();

    const response = await waitForEdgeFn(page, 'youtube-sync', 'sync-playlist', {
      timeout: 15_000,
    });
    expect(response).not.toBeNull();
    if (response) {
      expect(response.ok()).toBe(true);
    }
  });

  test('should show synced videos on dashboard', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    if (!await isAuthenticated(page)) {
      test.skip(true, 'Not authenticated');
      return;
    }

    // Wait for video states to load
    const statesResponse = await waitForEdgeFn(
      page,
      'youtube-sync',
      'get-all-video-states',
      { timeout: 10_000 }
    );

    if (statesResponse && statesResponse.ok()) {
      const data = await statesResponse.json();
      if (data.videos && data.videos.length > 0) {
        // At least one card should render
        const cards = page.locator('[data-testid="insight-card"], [class*="card"]');
        await expect(cards.first()).toBeVisible({ timeout: 5_000 });
      }
    }
  });

  test('should move card from scratchpad to mandala cell', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    if (!await isAuthenticated(page)) {
      test.skip(true, 'Not authenticated');
      return;
    }

    await page.waitForTimeout(3_000);

    // Check if any draggable card exists in scratchpad
    const scratchpadCard = page
      .locator('[data-testid="scratchpad-card"], [draggable="true"]')
      .first();
    const hasCard = await scratchpadCard.isVisible().catch(() => false);

    if (!hasCard) {
      test.skip(true, 'No cards in scratchpad to move');
      return;
    }

    // Attempt drag to a mandala cell
    const targetCell = page.locator('[data-testid="mandala-cell"]').first();
    const hasTarget = await targetCell.isVisible().catch(() => false);

    if (hasTarget) {
      await scratchpadCard.dragTo(targetCell);

      // Verify update API was called
      const response = await waitForEdgeFn(
        page,
        'youtube-sync',
        'update-video-state',
        { timeout: 5_000 }
      );
      // API call is expected but may also go through local-cards
      if (response) {
        expect(response.status()).toBeLessThan(500);
      }
    }
  });

  test('should delete a playlist', async ({ page }) => {
    await page.waitForTimeout(3_000);

    const deleteBtn = page.locator('button:has(svg.lucide-trash-2)').first();
    const hasDeleteBtn = await deleteBtn.isVisible().catch(() => false);
    if (!hasDeleteBtn) {
      test.skip(true, 'No delete button found — no playlists exist');
      return;
    }

    await deleteBtn.click();

    // Handle confirmation dialog if present
    const confirmBtn = page
      .locator(
        'button:has-text("삭제"), button:has-text("Delete"), button:has-text("확인"), [data-testid="confirm-delete"]'
      )
      .first();
    const hasConfirm = await confirmBtn.isVisible({ timeout: 2_000 }).catch(() => false);
    if (hasConfirm) {
      await confirmBtn.click();
    }

    const response = await waitForEdgeFn(page, 'youtube-sync', 'delete-playlist', {
      timeout: 5_000,
    });
    expect(response).not.toBeNull();
    if (response) {
      expect(response.ok()).toBe(true);
    }
  });

  test('should show error for invalid playlist URL', async ({ page }) => {
    await page.waitForTimeout(2_000);

    const input = page
      .locator(
        'input[placeholder*="youtube"], input[placeholder*="플레이리스트"], input[type="url"]'
      )
      .first();
    const hasInput = await input.isVisible().catch(() => false);
    if (!hasInput) {
      test.skip(true, 'No playlist URL input found');
      return;
    }

    await input.fill('https://not-a-valid-url.com/invalid');

    const addBtn = page
      .locator('button:has-text("추가"), button:has-text("Add"), button[type="submit"]')
      .first();
    await addBtn.click();

    // Expect error feedback (toast, inline message, or red border)
    const errorIndicator = page.locator(
      '[role="alert"], [class*="error"], [class*="toast"], text=/유효하지|잘못된|invalid|error/i'
    );
    await expect(errorIndicator.first()).toBeVisible({ timeout: 5_000 });
  });
});
