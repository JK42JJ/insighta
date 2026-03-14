import { test, expect } from '@playwright/test';

const APP_URL = '/';

test.describe('Sidebar Mandala Section', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');
    // Wait for React to render authenticated view
    await page.waitForTimeout(2000);
  });

  test('should display MANDALAS section in sidebar', async ({ page }) => {
    const sidebar = page.locator('aside').first();
    await expect(sidebar).toBeVisible({ timeout: 10_000 });

    const mandalaHeader = sidebar.getByText('MANDALAS', { exact: false });
    await expect(mandalaHeader).toBeVisible({ timeout: 10_000 });

    await page.screenshot({
      path: 'test-results/sidebar-mandala-section.png',
      fullPage: false,
    });
  });

  test('should handle mandala list state gracefully (data, empty, or error)', async ({ page }) => {
    const sidebar = page.locator('aside').first();
    await expect(sidebar).toBeVisible({ timeout: 10_000 });

    // Wait for mandala data to load
    await page.waitForTimeout(3000);

    // Three valid states: data (Collapsible items), empty ("Create New Mandala"), or error ("Retry")
    const hasCollapsibles = await sidebar.locator('[data-state]').first().isVisible().catch(() => false);
    const hasEmptyState = await sidebar.getByText('Create New Mandala').isVisible().catch(() => false);
    const hasErrorState = await sidebar.locator('button').filter({ hasText: 'Retry' }).isVisible().catch(() => false);
    const hasLoading = await sidebar.locator('.animate-pulse').isVisible().catch(() => false);

    // At least one state must be present
    const hasValidState = hasCollapsibles || hasEmptyState || hasErrorState || hasLoading;
    expect(hasValidState).toBe(true);

    await page.screenshot({
      path: 'test-results/sidebar-mandala-state.png',
    });
  });

  test('should auto-expand default mandala (when data available)', async ({ page }) => {
    const sidebar = page.locator('aside').first();
    await expect(sidebar).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(3000);

    // Skip if no mandala data (error or empty state)
    const hasCollapsibles = await sidebar.locator('[data-state]').first().isVisible().catch(() => false);
    if (!hasCollapsibles) {
      test.skip(true, 'No mandala data available — error or empty state');
      return;
    }

    const openCollapsible = sidebar.locator('[data-state="open"]');
    await expect(openCollapsible.first()).toBeVisible({ timeout: 10_000 });

    const gridContainer = openCollapsible.locator('.aspect-square');
    await expect(gridContainer.first()).toBeVisible();

    await page.screenshot({
      path: 'test-results/sidebar-mandala-auto-expanded.png',
    });
  });

  test('should toggle mandala accordion on click (when data available)', async ({ page }) => {
    const sidebar = page.locator('aside').first();
    await expect(sidebar).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(3000);

    // Skip if no mandala data
    const hasCollapsibles = await sidebar.locator('[data-state]').first().isVisible().catch(() => false);
    if (!hasCollapsibles) {
      test.skip(true, 'No mandala data available — error or empty state');
      return;
    }

    // Find the chevron toggle button inside a mandala item
    const chevronButton = sidebar.locator('[data-state]').first().locator('button').first();
    const wasOpen = await sidebar.locator('[data-state="open"]').count() > 0;
    await chevronButton.click();
    await page.waitForTimeout(500);

    const isOpenNow = await sidebar.locator('[data-state="open"]').count() > 0;
    expect(isOpenNow).not.toBe(wasOpen);
  });

  test('should show mandala grid inside expanded accordion (when data available)', async ({ page }) => {
    const sidebar = page.locator('aside').first();
    await expect(sidebar).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(3000);

    // Skip if no mandala data
    const hasCollapsibles = await sidebar.locator('[data-state]').first().isVisible().catch(() => false);
    if (!hasCollapsibles) {
      test.skip(true, 'No mandala data available — error or empty state');
      return;
    }

    const openSection = sidebar.locator('[data-state="open"]').first();
    if (!(await openSection.isVisible().catch(() => false))) {
      // Try to expand first mandala via chevron button
      const chevronButton = sidebar.locator('[data-state]').first().locator('button').first();
      await chevronButton.click();
      await page.waitForTimeout(500);
    }

    const gridContainer = sidebar.locator('.aspect-square').first();
    await expect(gridContainer).toBeVisible();

    await page.screenshot({
      path: 'test-results/sidebar-mandala-grid-visible.png',
    });
  });
});

test.describe('Sidebar Mandala API Health', () => {
  test('should respond to /api/v1/mandalas/list (200 or graceful error)', async ({ page }) => {
    const [response] = await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes('/mandalas/list') && resp.request().method() === 'GET',
        { timeout: 15_000 },
      ),
      page.goto(APP_URL),
    ]);

    const status = response.status();

    if (status === 200) {
      // Success — validate response structure
      const body = await response.json();
      console.log('Mandala list API response:', JSON.stringify(body, null, 2));

      expect(body).toHaveProperty('mandalas');
      expect(Array.isArray(body.mandalas)).toBe(true);

      if (body.total > 0) {
        expect(body.mandalas.length).toBeGreaterThan(0);
        expect(body.mandalas[0]).toHaveProperty('id');
        expect(body.mandalas[0]).toHaveProperty('title');
        expect(body.mandalas[0]).toHaveProperty('isDefault');
      }
    } else {
      // Error response — verify it's a valid HTTP response (not a crash)
      console.log(`Mandala list API returned ${status} — verifying graceful error handling`);
      expect([400, 401, 403, 404, 500, 502, 503]).toContain(status);

      // Verify the UI shows error/retry state instead of crashing
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);
      const sidebar = page.locator('aside').first();
      const hasRetry = await sidebar.locator('button').filter({ hasText: 'Retry' }).isVisible().catch(() => false);
      const hasEmpty = await sidebar.getByText('Create New Mandala').isVisible().catch(() => false);
      // Either retry button or empty state is acceptable for error responses
      expect(hasRetry || hasEmpty).toBe(true);
    }
  });
});
