/**
 * Local Cards E2E Tests
 *
 * End-to-end tests for locally added scratchpad cards:
 * 1. Add local card via URL
 * 2. Move card (scratchpad → mandala)
 * 3. Delete local card
 *
 * Requires: PLAYWRIGHT_AUTH=true + SUPABASE_TEST_ACCESS_TOKEN
 * Without auth, all tests skip gracefully.
 */

import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function isAuthenticated(page: Page): Promise<boolean> {
  await page.waitForLoadState('networkidle');
  return !page.url().includes('/login');
}

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

// A real URL for testing local card addition
const TEST_URL = 'https://developer.mozilla.org/en-US/docs/Web/JavaScript';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Local Cards — E2E Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const authed = await isAuthenticated(page);
    if (!authed) {
      test.skip(true, 'Not authenticated — set PLAYWRIGHT_AUTH=true + SUPABASE_TEST_ACCESS_TOKEN');
    }
  });

  test('should load local cards on dashboard', async ({ page }) => {
    // local-cards list is fetched on dashboard load
    const response = await waitForEdgeFn(page, 'local-cards', 'list', {
      timeout: 10_000,
    });
    expect(response).not.toBeNull();
    if (response) {
      expect(response.ok()).toBe(true);
    }
  });

  test('should add a local card via URL paste', async ({ page }) => {
    await page.waitForTimeout(2_000);

    // Find the URL input in scratchpad area
    const urlInput = page
      .locator(
        'input[placeholder*="URL"], input[placeholder*="url"], input[placeholder*="링크"], input[placeholder*="붙여넣기"]'
      )
      .first();
    const hasInput = await urlInput.isVisible().catch(() => false);
    if (!hasInput) {
      test.skip(true, 'No URL input found in scratchpad');
      return;
    }

    await urlInput.fill(TEST_URL);

    // Submit via Enter key or add button
    const addBtn = page
      .locator(
        'button:has-text("추가"), button:has-text("Add"), button[aria-label*="add"]'
      )
      .first();
    const hasAddBtn = await addBtn.isVisible().catch(() => false);

    if (hasAddBtn) {
      await addBtn.click();
    } else {
      await urlInput.press('Enter');
    }

    // Verify API call for adding
    const response = await waitForEdgeFn(page, 'local-cards', 'add', {
      timeout: 5_000,
    });
    expect(response).not.toBeNull();
    if (response) {
      expect(response.status()).toBeLessThan(500);
    }

    // Optimistic UI: card should appear immediately (before API resolves)
    // Check for any new card element
    const cards = page.locator('[data-testid="insight-card"], [class*="card"]');
    const cardCount = await cards.count();
    expect(cardCount).toBeGreaterThan(0);
  });

  test('should move local card from scratchpad to mandala', async ({ page }) => {
    await page.waitForTimeout(3_000);

    const scratchpadCard = page
      .locator('[data-testid="scratchpad-card"], [draggable="true"]')
      .first();
    const hasCard = await scratchpadCard.isVisible().catch(() => false);
    if (!hasCard) {
      test.skip(true, 'No cards in scratchpad to move');
      return;
    }

    const targetCell = page.locator('[data-testid="mandala-cell"]').first();
    const hasTarget = await targetCell.isVisible().catch(() => false);
    if (!hasTarget) {
      test.skip(true, 'No mandala cell target visible');
      return;
    }

    await scratchpadCard.dragTo(targetCell);

    // Could be local-cards update or batch-move
    const response = await waitForEdgeFn(page, 'local-cards', 'update', {
      timeout: 5_000,
    });
    // Also check batch-move as fallback
    if (!response) {
      const batchResponse = await waitForEdgeFn(page, 'local-cards', 'batch-move', {
        timeout: 3_000,
      });
      if (batchResponse) {
        expect(batchResponse.status()).toBeLessThan(500);
      }
    } else {
      expect(response.status()).toBeLessThan(500);
    }
  });

  test('should delete a local card with optimistic UI', async ({ page }) => {
    await page.waitForTimeout(3_000);

    // Count current cards
    const cards = page.locator('[data-testid="insight-card"], [class*="card"]');
    const initialCount = await cards.count();

    if (initialCount === 0) {
      test.skip(true, 'No local cards to delete');
      return;
    }

    // Find a delete button on a card
    const deleteBtn = page
      .locator(
        '[data-testid="delete-card"], button[aria-label*="delete"], button[aria-label*="삭제"], button:has(svg.lucide-trash-2), button:has(svg.lucide-x)'
      )
      .first();
    const hasDeleteBtn = await deleteBtn.isVisible().catch(() => false);
    if (!hasDeleteBtn) {
      test.skip(true, 'No card delete button found');
      return;
    }

    await deleteBtn.click();

    // Handle confirmation if present
    const confirmBtn = page
      .locator(
        'button:has-text("삭제"), button:has-text("Delete"), button:has-text("확인")'
      )
      .first();
    const hasConfirm = await confirmBtn.isVisible({ timeout: 1_500 }).catch(() => false);
    if (hasConfirm) {
      await confirmBtn.click();
    }

    // Verify API call
    const response = await waitForEdgeFn(page, 'local-cards', 'delete', {
      timeout: 5_000,
    });
    expect(response).not.toBeNull();
    if (response) {
      expect(response.ok()).toBe(true);
    }
  });
});
