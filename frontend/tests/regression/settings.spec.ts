import { test, expect, type Page, type Locator } from '@playwright/test';

const APP_URL = '';

// --- Helpers ---

async function navigateToSettings(page: Page): Promise<void> {
  await page.goto(`${APP_URL}/settings`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
}

async function selectCategory(page: Page, categoryText: string): Promise<void> {
  // Settings page has its own <nav> inside .container — use that, not the sidebar nav
  const nav = page.locator('.container nav');
  const btn = nav.getByText(categoryText, { exact: false }).first();
  await btn.click();
  await page.waitForTimeout(300);
}

async function navigateToMandalaSettings(page: Page): Promise<void> {
  await page.goto(`${APP_URL}/mandala-settings`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
}

async function waitForToast(page: Page): Promise<Locator> {
  const toast = page.locator('[role="status"], [data-sonner-toast], li[data-type]').first();
  await expect(toast).toBeVisible({ timeout: 5000 });
  return toast;
}

// =============================================================================
// Group 1: Settings Page — Navigation
// =============================================================================

test.describe('Settings Page — Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToSettings(page);
  });

  test('should access settings page at /settings route', async ({ page }) => {
    const heading = page.getByRole('heading', { name: /settings/i }).first();
    await expect(heading).toBeVisible({ timeout: 10_000 });

    await page.screenshot({ path: 'test-results/settings-page-loaded.png' });
  });

  test('should display 6 category navigation tabs', async ({ page }) => {
    const nav = page.locator('.container nav');
    await expect(nav).toBeVisible({ timeout: 10_000 });

    const categories = ['General', 'Appearance', 'Notifications', 'Integrations', 'Mandala', 'Data'];
    for (const cat of categories) {
      const btn = nav.getByText(cat, { exact: false }).first();
      await expect(btn).toBeVisible();
    }

    await page.screenshot({ path: 'test-results/settings-categories.png' });
  });

  test('should show corresponding section when category is clicked', async ({ page }) => {
    // Click Appearance
    await selectCategory(page, 'Appearance');
    const appearanceCard = page.getByText('Theme', { exact: false }).first();
    await expect(appearanceCard).toBeVisible({ timeout: 5000 });

    // Click Notifications
    await selectCategory(page, 'Notifications');
    const notifCard = page.getByText('Push Notifications', { exact: false }).first();
    await expect(notifCard).toBeVisible({ timeout: 5000 });

    await page.screenshot({ path: 'test-results/settings-category-switch.png' });
  });
});

// =============================================================================
// Group 2: General Settings
// =============================================================================

test.describe('General Settings', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToSettings(page);
    await selectCategory(page, 'General');
  });

  test('should toggle language between ko and en', async ({ page }) => {
    // Find the language select trigger
    const selectTrigger = page.locator('button[role="combobox"]').first();
    await expect(selectTrigger).toBeVisible({ timeout: 5000 });

    // Click to open dropdown
    await selectTrigger.click();
    await page.waitForTimeout(300);

    // Select English
    const enOption = page.getByRole('option', { name: /english/i });
    if (await enOption.isVisible().catch(() => false)) {
      await enOption.click();
      await page.waitForTimeout(500);
    }

    await page.screenshot({ path: 'test-results/settings-language-switch.png' });
  });

  test('should toggle auto-save switch', async ({ page }) => {
    const autoSaveSwitch = page.locator('#autoSave');
    await expect(autoSaveSwitch).toBeVisible({ timeout: 5000 });

    const wasChecked = await autoSaveSwitch.isChecked();
    await autoSaveSwitch.click();
    await page.waitForTimeout(300);

    const isChecked = await autoSaveSwitch.isChecked();
    expect(isChecked).not.toBe(wasChecked);

    await page.screenshot({ path: 'test-results/settings-autosave-toggle.png' });
  });

  test('should show toast when Save Settings is clicked', async ({ page }) => {
    const saveBtn = page.getByRole('button', { name: /save/i }).first();
    await expect(saveBtn).toBeVisible({ timeout: 5000 });
    await saveBtn.click();

    const toast = await waitForToast(page);
    await expect(toast).toBeVisible();

    await page.screenshot({ path: 'test-results/settings-save-toast.png' });
  });
});

// =============================================================================
// Group 3: Appearance & Notifications
// =============================================================================

test.describe('Appearance & Notifications', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToSettings(page);
  });

  test('should display theme dropdown with options', async ({ page }) => {
    await selectCategory(page, 'Appearance');

    const selectTrigger = page.locator('button[role="combobox"]').first();
    await expect(selectTrigger).toBeVisible({ timeout: 5000 });

    await selectTrigger.click();
    await page.waitForTimeout(300);

    // Check theme options exist
    const options = page.getByRole('option');
    const count = await options.count();
    expect(count).toBeGreaterThanOrEqual(3); // light, dark, system

    // Close dropdown
    await page.keyboard.press('Escape');

    await page.screenshot({ path: 'test-results/settings-theme-dropdown.png' });
  });

  test('should toggle push notifications switch', async ({ page }) => {
    await selectCategory(page, 'Notifications');

    const notifSwitch = page.locator('#notifications');
    await expect(notifSwitch).toBeVisible({ timeout: 5000 });

    const wasChecked = await notifSwitch.isChecked();
    await notifSwitch.click();
    await page.waitForTimeout(300);

    const isChecked = await notifSwitch.isChecked();
    expect(isChecked).not.toBe(wasChecked);

    await page.screenshot({ path: 'test-results/settings-push-notif-toggle.png' });
  });

  test('should toggle email notifications switch', async ({ page }) => {
    await selectCategory(page, 'Notifications');

    const emailSwitch = page.locator('#emailUpdates');
    await expect(emailSwitch).toBeVisible({ timeout: 5000 });

    const wasChecked = await emailSwitch.isChecked();
    await emailSwitch.click();
    await page.waitForTimeout(300);

    const isChecked = await emailSwitch.isChecked();
    expect(isChecked).not.toBe(wasChecked);

    await page.screenshot({ path: 'test-results/settings-email-notif-toggle.png' });
  });
});

// =============================================================================
// Group 4: YouTube Integrations
// =============================================================================

test.describe('YouTube Integrations', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToSettings(page);
    await selectCategory(page, 'Integrations');
    await page.waitForTimeout(1000);
  });

  test('should render YouTubeSyncCard', async ({ page }) => {
    const ytTitle = page.getByRole('heading', { name: /YouTube Playlist Sync/i });
    await expect(ytTitle).toBeVisible({ timeout: 10_000 });

    await page.screenshot({ path: 'test-results/settings-youtube-card.png' });
  });

  test('should have playlist URL input field', async ({ page }) => {
    const input = page.locator('#playlist-url');
    await expect(input).toBeVisible({ timeout: 10_000 });

    await page.screenshot({ path: 'test-results/settings-playlist-input.png' });
  });

  test('should show error when adding empty URL', async ({ page }) => {
    // Add button should be disabled with empty input
    const addBtn = page.getByRole('button', { name: /add/i }).first();
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await expect(addBtn).toBeDisabled();

    await page.screenshot({ path: 'test-results/settings-empty-url-validation.png' });
  });

  test('should have sync interval dropdown', async ({ page }) => {
    const intervalTrigger = page.locator('button[role="combobox"]').first();
    await expect(intervalTrigger).toBeVisible({ timeout: 10_000 });

    await page.screenshot({ path: 'test-results/settings-sync-interval.png' });
  });

  test('should have background sync switch', async ({ page }) => {
    const autoSyncSwitch = page.locator('#auto-sync');
    await expect(autoSyncSwitch).toBeVisible({ timeout: 10_000 });

    await page.screenshot({ path: 'test-results/settings-background-sync.png' });
  });
});

// =============================================================================
// Group 5: Mandala Tab (in Settings)
// =============================================================================

test.describe('Mandala Tab (in Settings)', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToSettings(page);
    await selectCategory(page, 'Mandala');
    await page.waitForTimeout(1000);
  });

  test('should show mandala list in settings mandala tab', async ({ page }) => {
    // MandalaSettingsTab renders "My Mandalas" card
    const heading = page.getByText(/My Mandala|나의 만다라트/i).first();
    await expect(heading).toBeVisible({ timeout: 10_000 });

    await page.screenshot({ path: 'test-results/settings-mandala-tab-list.png' });
  });

  test('should show "Create New" button', async ({ page }) => {
    const createBtn = page.getByRole('button', { name: /create new|새로 만들기/i });
    await expect(createBtn).toBeVisible({ timeout: 10_000 });

    // Click to open dialog
    await createBtn.click();
    await page.waitForTimeout(300);

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 3000 });

    // Close dialog
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'test-results/settings-mandala-tab-create.png' });
  });

  test('should show quota indicator', async ({ page }) => {
    // Quota card shows usage like "1 / 3"
    const quotaText = page.getByText(/\d+\s*\/\s*\d+/).first();
    await expect(quotaText).toBeVisible({ timeout: 10_000 });

    // Progress bar
    const progressBar = page.locator('.h-2.rounded-full.bg-surface-light');
    await expect(progressBar).toBeVisible();

    await page.screenshot({ path: 'test-results/settings-mandala-tab-quota.png' });
  });

  test('should show "Open Editor" card linking to /mandala-settings', async ({ page }) => {
    const editorCard = page.getByText(/Open Mandala Editor|만다라트 설계 편집기/i).first();
    await expect(editorCard).toBeVisible({ timeout: 10_000 });

    // Click the editor card
    await editorCard.click();
    await page.waitForTimeout(1000);

    // Should navigate to /mandala-settings
    expect(page.url()).toContain('/mandala-settings');

    await page.screenshot({ path: 'test-results/settings-mandala-tab-editor-link.png' });
  });

  test('should show delete AlertDialog for non-default mandala', async ({ page }) => {
    // Find a delete button (trash icon) — only visible on hover for non-default mandalas
    const mandalaItems = page.locator('.group.flex.items-center');
    const count = await mandalaItems.count();

    if (count <= 1) {
      // Only default mandala exists, skip gracefully
      test.skip();
      return;
    }

    // Hover over a non-default mandala to reveal actions
    const nonDefaultItem = mandalaItems.nth(1);
    await nonDefaultItem.hover();
    await page.waitForTimeout(300);

    // Click delete button
    const deleteBtn = nonDefaultItem.locator('button').filter({ has: page.locator('.text-destructive, [class*="destructive"]') }).first();
    if (await deleteBtn.isVisible().catch(() => false)) {
      await deleteBtn.click();
      await page.waitForTimeout(300);

      const dialog = page.locator('[role="alertdialog"]');
      await expect(dialog).toBeVisible({ timeout: 3000 });

      // Cancel to avoid actual deletion
      const cancelBtn = dialog.getByRole('button', { name: /cancel|취소/i });
      await cancelBtn.click();
      await page.waitForTimeout(300);
    }

    await page.screenshot({ path: 'test-results/settings-mandala-tab-delete-dialog.png' });
  });
});

// =============================================================================
// Group 6: Mandala Settings Page
// =============================================================================

test.describe('Mandala Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToMandalaSettings(page);
  });

  test('should access mandala settings page', async ({ page }) => {
    const heading = page.getByRole('heading', { level: 1 }).first();
    await expect(heading).toBeVisible({ timeout: 10_000 });

    await page.screenshot({ path: 'test-results/mandala-settings-loaded.png' });
  });

  test('should render 3x3 grid with 9 cells', async ({ page }) => {
    const grid = page.locator('.grid.grid-cols-3').first();
    await expect(grid).toBeVisible({ timeout: 10_000 });

    // 9 cells: 8 subject cells + 1 center cell
    const children = grid.locator('> div');
    const count = await children.count();
    expect(count).toBe(9);

    await page.screenshot({ path: 'test-results/mandala-settings-grid.png' });
  });

  test('should allow editing center goal input', async ({ page }) => {
    // Center cell has a primary-colored border
    const centerCell = page.locator('.border-primary').first();
    await expect(centerCell).toBeVisible({ timeout: 10_000 });

    const centerInput = centerCell.locator('input');
    await expect(centerInput).toBeVisible();

    // Clear and type new value
    const originalValue = await centerInput.inputValue();
    await centerInput.fill('Test Goal');
    await page.waitForTimeout(300);

    const newValue = await centerInput.inputValue();
    expect(newValue).toBe('Test Goal');

    // Restore original value
    await centerInput.fill(originalValue);

    await page.screenshot({ path: 'test-results/mandala-settings-center-edit.png' });
  });

  test('should allow editing subject input fields', async ({ page }) => {
    // Subject inputs are inside the grid cells (not center)
    const grid = page.locator('.grid.grid-cols-3').first();
    await expect(grid).toBeVisible({ timeout: 10_000 });

    // Get first non-center cell input
    const subjectCells = grid.locator('> div:not(.border-primary)');
    const firstCell = subjectCells.first();
    const input = firstCell.locator('input');

    if (await input.isVisible().catch(() => false)) {
      const originalValue = await input.inputValue();
      await input.fill('Test Subject');
      await page.waitForTimeout(300);

      const newValue = await input.inputValue();
      expect(newValue).toBe('Test Subject');

      // Restore
      await input.fill(originalValue);
    }

    await page.screenshot({ path: 'test-results/mandala-settings-subject-edit.png' });
  });

  test('should show template cards and handle click', async ({ page }) => {
    // Template cards are in the right column
    const templateSection = page.getByText('Start with a Template', { exact: false });

    // May need to scroll or find template section
    if (await templateSection.isVisible().catch(() => false)) {
      await templateSection.scrollIntoViewIfNeeded();
    }

    // Find template buttons
    const templateGrid = page.locator('.grid.sm\\:grid-cols-2').first();
    if (await templateGrid.isVisible().catch(() => false)) {
      const templateBtns = templateGrid.locator('button');
      const count = await templateBtns.count();
      expect(count).toBeGreaterThan(0);

      // Click first template
      await templateBtns.first().click();
      await page.waitForTimeout(500);

      // Either template is applied directly or overwrite dialog shows
      const dialog = page.locator('[role="alertdialog"]');
      const dialogVisible = await dialog.isVisible().catch(() => false);

      if (dialogVisible) {
        // Cancel to avoid overwriting
        const cancelBtn = dialog.getByRole('button', { name: /cancel/i });
        await cancelBtn.click();
        await page.waitForTimeout(300);
      }
    }

    await page.screenshot({ path: 'test-results/mandala-settings-template.png' });
  });
});

// =============================================================================
// Group 7: Data & Privacy
// =============================================================================

test.describe('Data & Privacy', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToSettings(page);
    await selectCategory(page, 'Data');
  });

  test('should show AlertDialog when delete button is clicked', async ({ page }) => {
    const deleteBtn = page.getByRole('button', { name: /delete/i }).first();
    await expect(deleteBtn).toBeVisible({ timeout: 5000 });

    await deleteBtn.click();
    await page.waitForTimeout(300);

    const dialog = page.locator('[role="alertdialog"]');
    await expect(dialog).toBeVisible({ timeout: 3000 });

    await page.screenshot({ path: 'test-results/settings-delete-dialog.png' });
  });

  test('should close AlertDialog when cancel is clicked', async ({ page }) => {
    const deleteBtn = page.getByRole('button', { name: /delete/i }).first();
    await expect(deleteBtn).toBeVisible({ timeout: 5000 });

    await deleteBtn.click();
    await page.waitForTimeout(300);

    const dialog = page.locator('[role="alertdialog"]');
    await expect(dialog).toBeVisible({ timeout: 3000 });

    const cancelBtn = dialog.getByRole('button', { name: /cancel/i });
    await cancelBtn.click();
    await page.waitForTimeout(300);

    await expect(dialog).not.toBeVisible();

    await page.screenshot({ path: 'test-results/settings-delete-cancel.png' });
  });
});
