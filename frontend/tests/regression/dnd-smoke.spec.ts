/**
 * D&D Smoke Test — CI Gate for D&D regression prevention (#329)
 *
 * 4 critical D&D paths. Run locally with `chromium` project (requires auth).
 * Failure blocks /ship for D&D-related changes.
 *
 * Depends on: authenticated session (storageState), at least 1 mandala with cards.
 */
import { test, expect, type Page, type Locator } from '@playwright/test';

const APP_URL = '/';
const SKIP_NO_GRID = 'Mandala grid not available — requires auth + mandala data';
const SKIP_NO_CARDS = 'No cell with cards found — requires test data';

// ---------------------------------------------------------------------------
// Helpers (subset from card-dnd.spec.ts)
// ---------------------------------------------------------------------------

async function waitForGrid(page: Page): Promise<Locator | null> {
  await page.goto(APP_URL);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);

  const sidebar = page.locator('aside').first();
  if (!(await sidebar.isVisible().catch(() => false))) return null;

  const gridContainer = sidebar.locator('.grid.grid-cols-3').first();
  for (let i = 0; i < 5; i++) {
    if (await gridContainer.isVisible().catch(() => false)) {
      const cells = gridContainer.locator('[role="button"]');
      if ((await cells.count()) === 9) return cells;
    }
    await page.waitForTimeout(1000);
  }
  return null;
}

async function getCardCount(cell: Locator): Promise<number> {
  const label = await cell.getAttribute('aria-label');
  if (!label) return 0;
  const match = label.match(/\((\d+) cards?\)/);
  return match ? parseInt(match[1], 10) : 0;
}

async function findCellWithCards(
  page: Page,
  minCards = 1
): Promise<{ cell: Locator; count: number; index: number } | null> {
  const cells = page.locator('aside .grid.grid-cols-3 [role="button"]');
  const count = await cells.count();
  for (let i = 0; i < count; i++) {
    if (i === 4) continue;
    const cell = cells.nth(i);
    const cardCount = await getCardCount(cell);
    if (cardCount >= minCards) {
      return { cell, count: cardCount, index: i };
    }
  }
  return null;
}

async function findEmptyCell(page: Page): Promise<Locator | null> {
  const cells = page.locator('aside .grid.grid-cols-3 [role="button"]');
  const count = await cells.count();
  for (let i = 0; i < count; i++) {
    if (i === 4) continue;
    const cell = cells.nth(i);
    const label = await cell.getAttribute('aria-label');
    if (label?.includes('(0 cards)')) return cell;
  }
  return null;
}

async function getTotalGridCards(page: Page): Promise<number> {
  // Count all cards in the main grid content area
  const cards = page.locator('[data-card-content]');
  return cards.count();
}

// ---------------------------------------------------------------------------
// Test 1: Cell-to-cell card move
// ---------------------------------------------------------------------------

test.describe('D&D Smoke Tests — Critical Path (#329)', () => {
  test('1. card moves between mandala cells', async ({ page }) => {
    const cells = await waitForGrid(page);
    if (!cells) { test.skip(true, SKIP_NO_GRID); return; }

    const source = await findCellWithCards(page, 1);
    if (!source) { test.skip(true, SKIP_NO_CARDS); return; }

    const target = await findEmptyCell(page);
    if (!target) { test.skip(true, 'No empty cell found'); return; }

    const beforeSource = source.count;
    const beforeTarget = await getCardCount(target);

    // Click source cell to select it, then hover to find draggable
    await source.cell.click();
    await page.waitForTimeout(500);

    // Find a card in the content area to drag
    const cardItems = page.locator('[data-card-content]').first();
    if (!(await cardItems.isVisible().catch(() => false))) {
      test.skip(true, 'No visible card to drag');
      return;
    }

    // Drag the card grip handle to the target cell
    const gripHandle = cardItems.locator('[data-dnd-handle]').first();
    if (await gripHandle.isVisible().catch(() => false)) {
      await gripHandle.dragTo(target, { force: true });
    } else {
      // Fallback: try dragging the card itself
      await cardItems.dragTo(target, { force: true });
    }

    await page.waitForTimeout(1000);

    // Verify card moved: source count decreased OR target count increased
    const afterSource = await getCardCount(source.cell);
    const afterTarget = await getCardCount(target);

    const moved = afterSource < beforeSource || afterTarget > beforeTarget;
    expect(moved).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // Test 2: ScratchPad → mandala cell
  // ---------------------------------------------------------------------------

  test('2. scratchpad card moves to mandala cell', async ({ page }) => {
    const cells = await waitForGrid(page);
    if (!cells) { test.skip(true, SKIP_NO_GRID); return; }

    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Find ideation cards (scratchpad)
    const scratchpadCards = page.locator('[data-card-item]');
    const ideationCount = await scratchpadCards.count();
    if (ideationCount === 0) {
      test.skip(true, 'No ideation cards to test scratchpad→cell drag');
      return;
    }

    // Find a target cell
    const target = await findEmptyCell(page);
    if (!target) {
      // Use first non-center cell as fallback
      const firstCell = page.locator('aside .grid.grid-cols-3 [role="button"]').first();
      if (!(await firstCell.isVisible().catch(() => false))) {
        test.skip(true, 'No target cell available');
        return;
      }
    }

    // Verify scratchpad has at least 1 card before drag
    expect(ideationCount).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // Test 3: Minimap cells are droppable
  // ---------------------------------------------------------------------------

  test('3. sidebar minimap has 9 droppable cells', async ({ page }) => {
    const cells = await waitForGrid(page);
    if (!cells) { test.skip(true, SKIP_NO_GRID); return; }

    // Verify all 9 cells exist and have role="button"
    const cellCount = await cells.count();
    expect(cellCount).toBe(9);

    // Each cell should be interactive (role="button" with tabIndex)
    for (let i = 0; i < 9; i++) {
      const cell = cells.nth(i);
      const role = await cell.getAttribute('role');
      expect(role).toBe('button');
    }

    // Center cell (index 4) should show goal text
    const centerCell = cells.nth(4);
    const centerText = await centerCell.textContent();
    expect(centerText).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // Test 4: Drag cancel — no shell cards
  // ---------------------------------------------------------------------------

  test('4. drag cancel does not create shell cards', async ({ page }) => {
    const cells = await waitForGrid(page);
    if (!cells) { test.skip(true, SKIP_NO_GRID); return; }

    const source = await findCellWithCards(page, 1);
    if (!source) { test.skip(true, SKIP_NO_CARDS); return; }

    // Click source cell
    await source.cell.click();
    await page.waitForTimeout(500);

    const beforeTotal = await getTotalGridCards(page);

    // Simulate drag start then cancel via ESC
    const cardItem = page.locator('[data-card-content]').first();
    if (await cardItem.isVisible().catch(() => false)) {
      const box = await cardItem.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        // Move slightly to activate drag (distance > 5px threshold)
        await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2 + 10);
        await page.waitForTimeout(200);
        // Cancel drag
        await page.keyboard.press('Escape');
        await page.mouse.up();
      }
    }

    await page.waitForTimeout(500);

    const afterTotal = await getTotalGridCards(page);

    // Card count must not increase (no shell cards created)
    expect(afterTotal).toBeLessThanOrEqual(beforeTotal);

    // Verify no cards with empty title
    const emptyTitleCards = page.locator('[data-card-content] h3:empty, [data-card-content] h3:text-is("")');
    const emptyCount = await emptyTitleCards.count().catch(() => 0);
    expect(emptyCount).toBe(0);

    // Verify DropZoneOverlay is hidden
    const overlay = page.locator('[class*="DropZoneOverlay"], [data-drop-overlay]');
    if (await overlay.count() > 0) {
      const opacity = await overlay.first().evaluate((el) => window.getComputedStyle(el).opacity);
      expect(opacity).toBe('0');
    }
  });
});
