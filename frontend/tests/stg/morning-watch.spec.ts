import { test, expect, type Page } from '@playwright/test';

// Watch screen (/morning-cards?view=watch) on the deployed staging site, user-test structure
// (decision 2026-11-14): every signed-in account reads the shared briefs; the experiment UI
// (today's videos, viewing order, judgments) belongs to the main account only. The staging test
// account is a participant: home -> brief -> a source opens the video screen -> back to the
// brief; the brief reaction is saved; the screen never asks a route of the experiment (a new
// account, not on the test list, is refused by those routes on the server).

const EMAIL = process.env.STG_TEST_EMAIL ?? '';
const PASSWORD = process.env.STG_TEST_PASSWORD ?? '';
const API = '/api/v1/morning-feed';
/** watch-design.ts WATCH_ONB_SEEN_KEY */
const ONB_SEEN_KEY = 'mf_watch_onb_seen';
const LOAD_TIMEOUT_MS = 25_000;
const TOP = '[data-testid="mf-stack-layer"][data-top]';

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('input#email').fill(EMAIL);
  await page.locator('input#password').fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login/);
}

test('morning watch: a participant reads a brief, opens its evidence and comes back; the reaction is saved (phone 390x844)', async ({
  page,
}, info) => {
  expect(EMAIL, 'STG_TEST_EMAIL is not set').not.toBe('');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((key) => {
    try {
      window.localStorage.setItem(key, '1');
    } catch {
      /* storage blocked: the onboarding would show */
    }
  }, ONB_SEEN_KEY);
  const experimentCalls: string[] = [];
  page.on('request', (r) => {
    if (/\/morning-feed\/(watch\/|judgments|history)/.test(r.url())) experimentCalls.push(r.url());
  });
  await signIn(page);
  await page.goto('/morning-cards?view=watch');

  // the brief home: Insighta alone at the top, the date only, always 브리프 읽기
  const homeEl = page.locator(`${TOP} [data-testid="mf-home"]`);
  await expect(homeEl).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  await expect(page.getByTestId('mf-home-goal')).toHaveCount(0);
  await expect(page.locator('.mf-home-top')).toContainText('Insighta');
  await expect(page.getByTestId('mf-home-seen')).toHaveText(/^(오늘 · )?\d+월 \d+일$/);
  await expect(page.getByTestId('mf-home-enter')).toContainText('브리프 읽기');
  await expect(page.getByTestId('mf-home-past')).toHaveText('지난 브리프');
  // textContent: the text may still be hidden while its fonts load (innerText would be empty)
  const headline = ((await page.getByTestId('mf-home-headline').textContent()) ?? '').trim();
  expect(headline).not.toBe('');

  const briefRead = page.waitForResponse(
    (r) => r.url().includes(`${API}/pages?`) && r.request().method() === 'GET'
  );
  await page.getByTestId('mf-home-enter').click();
  const read = await briefRead;
  expect(read.status()).toBe(200);
  const brief = page.locator(`${TOP} [data-testid="mf-page"]`);
  await expect(brief).toBeVisible();
  await expect(brief.getByTestId('mf-page-headline')).toHaveText(headline);
  await expect(brief.getByTestId('mf-page-home')).toHaveText('홈');
  await expect(brief.getByTestId('mf-page-videos')).toContainText('근거가 된 영상');
  // no experiment UI for a participant
  await expect(brief.getByTestId('mf-page-today')).toHaveCount(0);
  await expect(brief.getByTestId('mf-page-order')).toHaveCount(0);

  // a source opens the video screen; back returns to the brief
  await brief.getByTestId('mf-page-core').getByTestId('mf-page-cite').first().click();
  await expect(page.getByTestId('mf-watch-counter')).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  await info.attach('evidence-video', { body: await page.screenshot(), contentType: 'image/png' });
  await page.getByTestId('mf-watch-back').click();
  await expect(page.getByTestId('mf-page-watch')).toHaveCount(0, { timeout: 5000 });
  await expect(brief.getByTestId('mf-page-headline')).toBeVisible();

  // the reaction: shown at once, saved with the viewer, domain and date. The account may have
  // answered this brief in an earlier run, so the other answer is pressed (a change is saved).
  const yes = brief.getByTestId('mf-page-feedback-yes');
  const wasYes = (await yes.getAttribute('data-on')) !== null;
  const press = wasYes ? brief.getByTestId('mf-page-feedback-no') : yes;
  const saved = page.waitForResponse(
    (r) => r.url().includes(`${API}/pages/feedback`) && r.request().method() === 'POST'
  );
  await press.click();
  const res = await saved;
  expect(res.status()).toBe(200);
  const sent = res.request().postDataJSON() as { cell: string; date: string; value: string };
  expect(sent.value).toBe(wasYes ? 'not_useful' : 'useful');
  expect(sent.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await expect(press).toHaveAttribute('data-on', '');

  // a participant never asked a route of the experiment
  expect(experimentCalls).toEqual([]);
});
