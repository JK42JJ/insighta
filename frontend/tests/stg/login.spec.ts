import { test, expect, type Page } from '@playwright/test';

// Signs in through the real login form with the staging test account, then
// checks the three things a deploy can break without a server error:
//   - the form still signs in (bundle + Supabase wiring),
//   - the session belongs to the staging project, not prod,
//   - the API accepts that session and still refuses an anonymous caller.
//
// Google sign-in is not exercised here; the staging project has it disabled.

const EMAIL = process.env.STG_TEST_EMAIL ?? '';
const PASSWORD = process.env.STG_TEST_PASSWORD ?? '';
const PROJECT_REF = process.env.STG_PROJECT_REF ?? '';

const AUTH_KEY = /^sb-.+-auth-token$/;

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.locator('input#email').fill(email);
  await page.locator('input#password').fill(password);
  await page.locator('form button[type="submit"]').click();
}

async function sessionKeys(page: Page): Promise<string[]> {
  return page.evaluate(
    (pattern) => Object.keys(localStorage).filter((k) => new RegExp(pattern).test(k)),
    AUTH_KEY.source
  );
}

test.describe('staging integrity: sign-in through the real UI', () => {
  // A missing credential must fail the run. Skipping would report green for a
  // suite that checked nothing.
  test.beforeAll(() => {
    expect(EMAIL, 'STG_TEST_EMAIL is not set').not.toBe('');
    expect(PASSWORD, 'STG_TEST_PASSWORD is not set').not.toBe('');
    expect(PROJECT_REF, 'STG_PROJECT_REF is not set').not.toBe('');
  });

  test('email sign-in leaves the login page with a staging session', async ({ page }) => {
    await signIn(page, EMAIL, PASSWORD);
    await expect(page).not.toHaveURL(/\/login/);

    const keys = await sessionKeys(page);
    expect(keys, 'exactly one Supabase session is stored').toHaveLength(1);
    expect(keys[0], 'the session belongs to the staging project').toContain(PROJECT_REF);
  });

  test('the API accepts the session and returns the signed-in user', async ({ page }) => {
    await signIn(page, EMAIL, PASSWORD);
    await expect(page).not.toHaveURL(/\/login/);

    const me = await page.evaluate(async (pattern) => {
      const key = Object.keys(localStorage).find((k) => new RegExp(pattern).test(k));
      const raw = key ? localStorage.getItem(key) : null;
      const token = raw ? (JSON.parse(raw) as { access_token?: string }).access_token : undefined;
      const res = await fetch('/api/v1/auth/me', { headers: { Authorization: `Bearer ${token}` } });
      return { status: res.status, body: (await res.json()) as { user?: { email?: string } } };
    }, AUTH_KEY.source);

    expect(me.status).toBe(200);
    expect(me.body.user?.email).toBe(EMAIL);
  });

  test('the API refuses an anonymous caller', async ({ request }) => {
    const res = await request.get('/api/v1/mandalas');
    expect(res.status()).toBe(401);
  });

  test('a wrong password is rejected and stays on the login page', async ({ page }) => {
    await signIn(page, EMAIL, `${PASSWORD}-wrong`);
    await expect(page.getByText(/invalid login credentials/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    expect(await sessionKeys(page)).toHaveLength(0);
  });
});
