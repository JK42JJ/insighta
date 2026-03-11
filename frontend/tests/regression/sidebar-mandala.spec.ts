import { test, expect } from '@playwright/test';

const APP_URL = 'http://localhost:8082/v2/';

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

  test('should have at least one mandala item (not empty state)', async ({ page }) => {
    const sidebar = page.locator('aside').first();
    await expect(sidebar).toBeVisible({ timeout: 10_000 });

    // Wait for mandala data to load
    await page.waitForTimeout(3000);

    // Should NOT show "Create New Mandala" empty state text
    const emptyState = sidebar.getByText('Create New Mandala');
    const hasEmptyState = await emptyState.isVisible().catch(() => false);

    if (hasEmptyState) {
      await page.screenshot({
        path: 'test-results/sidebar-mandala-empty-state.png',
      });
      test.fail(true, 'Mandala list is empty — useMandalaList() returned no data');
    }

    // Should have at least one collapsible mandala item
    const mandalaItems = sidebar.locator('[data-state]');
    await expect(mandalaItems.first()).toBeVisible({ timeout: 10_000 });
  });

  test('should auto-expand default mandala', async ({ page }) => {
    const sidebar = page.locator('aside').first();
    await expect(sidebar).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(3000);

    const openCollapsible = sidebar.locator('[data-state="open"]');
    await expect(openCollapsible.first()).toBeVisible({ timeout: 10_000 });

    const gridContainer = openCollapsible.locator('.aspect-square');
    await expect(gridContainer.first()).toBeVisible();

    await page.screenshot({
      path: 'test-results/sidebar-mandala-auto-expanded.png',
    });
  });

  test('should toggle mandala accordion on click', async ({ page }) => {
    const sidebar = page.locator('aside').first();
    await expect(sidebar).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(3000);

    const firstTrigger = sidebar.locator('button').filter({ hasText: /\w+/ }).first();
    const wasOpen = await sidebar.locator('[data-state="open"]').count() > 0;
    await firstTrigger.click();
    await page.waitForTimeout(500);

    const isOpenNow = await sidebar.locator('[data-state="open"]').count() > 0;
    expect(isOpenNow).not.toBe(wasOpen);
  });

  test('should show mandala grid inside expanded accordion', async ({ page }) => {
    const sidebar = page.locator('aside').first();
    await expect(sidebar).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(3000);

    const openSection = sidebar.locator('[data-state="open"]').first();
    if (!(await openSection.isVisible().catch(() => false))) {
      const trigger = sidebar.locator('button').filter({ hasText: /\w+/ }).first();
      await trigger.click();
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
  test('should successfully fetch /api/v1/mandalas/list', async ({ page }) => {
    const [response] = await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes('/mandalas/list') && resp.request().method() === 'GET',
        { timeout: 15_000 },
      ),
      page.goto(APP_URL),
    ]);

    expect(response.status()).toBe(200);

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
  });
});
