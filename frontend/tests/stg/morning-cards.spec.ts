import { test, expect, type Page } from '@playwright/test';

// Morning-cards judging on the deployed staging site: a button click must save
// exactly one judgment row and then show the next card. Runs on a phone-sized
// and a desktop-sized viewport. The row belongs to the staging test account.

const EMAIL = process.env.STG_TEST_EMAIL ?? '';
const PASSWORD = process.env.STG_TEST_PASSWORD ?? '';
const AUTH_KEY = /^sb-.+-auth-token$/;

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('input#email').fill(EMAIL);
  await page.locator('input#password').fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function token(page: Page): Promise<string> {
  return page.evaluate((pattern) => {
    const key = Object.keys(localStorage).find((k) => new RegExp(pattern).test(k));
    const raw = key ? localStorage.getItem(key) : null;
    return raw ? ((JSON.parse(raw) as { access_token?: string }).access_token ?? '') : '';
  }, AUTH_KEY.source);
}

for (const vp of [
  { name: 'phone 390x844', width: 390, height: 844 },
  { name: 'desktop 1280x800', width: 1280, height: 800 },
]) {
  test(`morning cards: one button click saves one judgment (${vp.name})`, async ({ page }) => {
    expect(EMAIL, 'STG_TEST_EMAIL is not set').not.toBe('');
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await signIn(page);
    await page.goto('/morning-cards/classic');
    await expect(page.getByTestId('morning-card')).toBeVisible();
    const title = await page.getByTestId('morning-card').locator('h2').innerText();
    await expect(page.getByTestId('morning-card')).not.toContainText(/관련도|r1_min/);

    const saved = page.waitForResponse(
      (r) => r.url().includes('/api/v1/morning-cards/judgments') && r.request().method() === 'POST'
    );
    await page.getByTestId('verdict-useful').click();
    expect((await saved).status()).toBe(201);
    await expect(page.getByTestId('morning-card').locator('h2')).not.toHaveText(title);

    // The saved verdict is readable back for this user: exactly the clicked card, 'useful'.
    const review = await page.evaluate(async (t) => {
      const res = await fetch('/api/v1/morning-cards/review?domain=work_practice', {
        headers: { Authorization: `Bearer ${t}` },
      });
      return (await res.json()) as { data?: { items?: Array<{ title: string; verdict: string | null }> } };
    }, await token(page));
    const hit = review.data?.items?.find((i) => i.title === title);
    expect(hit?.verdict).toBe('useful');
  });
}
