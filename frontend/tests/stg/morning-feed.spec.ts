import { test, expect, type Page } from '@playwright/test';

// 오늘의 픽 live feed on the deployed staging site: a swipe saves exactly one judgment through the
// feed API, and undo marks it cancelled (the row stays). The rows belong to the staging test account.

const EMAIL = process.env.STG_TEST_EMAIL ?? '';
const PASSWORD = process.env.STG_TEST_PASSWORD ?? '';

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('input#email').fill(EMAIL);
  await page.locator('input#password').fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login/);
}

test('morning feed: swipe right saves one judgment, undo cancels it (phone 390x844)', async ({ page }) => {
  expect(EMAIL, 'STG_TEST_EMAIL is not set').not.toBe('');
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.goto('/morning-cards?onboard=0');
  await expect(page.getByTestId('mf-card')).toBeVisible({ timeout: 25_000 });
  // the live card carries a YouTube video, not the fixture text
  await expect(page.getByTestId('mf-title')).not.toHaveText('');

  const saved = page.waitForResponse(
    (r) => r.url().includes('/api/v1/morning-feed/judgments') && r.request().method() === 'POST'
  );
  const b = (await page.getByTestId('mf-title').boundingBox())!;
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 160, y, { steps: 8 });
  await page.mouse.up();
  expect((await saved).status()).toBe(201);

  const undone = page.waitForResponse(
    (r) => r.url().includes('/api/v1/morning-feed/judgments/last') && r.request().method() === 'DELETE'
  );
  await page.getByTestId('mf-undo').click();
  const res = await undone;
  expect(res.status()).toBe(200);
  expect(((await res.json()) as { data?: { canceled?: number } }).data?.canceled).toBe(1);
});
