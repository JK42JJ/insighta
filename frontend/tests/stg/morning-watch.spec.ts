import { test, expect, type Page } from '@playwright/test';

// Watch screen (/morning-cards?view=watch) on the deployed staging site, user-test structure
// (decision 2026-11-14): every signed-in account reads the shared briefs; the experiment UI
// (today's videos, viewing order, judgments) belongs to the main account only. The staging test
// account is a participant: home -> brief -> a source opens its sheet over the article -> closed
// at the same place -> the sheet's full view opens the video screen -> back at the same place; the brief reaction is saved; the screen never asks a route of the experiment (a new
// account, not on the test list, is refused by those routes on the server).

const EMAIL = process.env.STG_TEST_EMAIL ?? '';
const PASSWORD = process.env.STG_TEST_PASSWORD ?? '';
const API = '/api/v1/morning-feed';
/** watch-design.ts WATCH_ONB_SEEN_KEY */
const ONB_SEEN_KEY = 'mf_watch_onb_seen';
const LOAD_TIMEOUT_MS = 25_000;
const TOP = '[data-testid="mf-stack-layer"][data-top]';

async function signIn(page: Page): Promise<void> {
  await page.goto('/login/classic'); // /login now shows the intro landing to signed-out visitors (2026-11-24)
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
  const briefReads: Array<{ url: string; status: number }> = [];
  page.on('response', (r) => {
    if (r.url().includes(`${API}/pages?`) && r.request().method() === 'GET')
      briefReads.push({ url: r.url(), status: r.status() });
  });
  await signIn(page);
  briefReads.length = 0;
  await page.goto('/morning-cards?view=watch');

  // the brief home: Insighta and the account, then the date (a button to the past briefs); the
  // chosen domain's name above the headline; always 브리프 읽기
  const homeEl = page.locator(`${TOP} [data-testid="mf-home"]`);
  await expect(homeEl).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  await expect(page.getByTestId('mf-home-goal')).toHaveCount(0);
  await expect(page.locator('.mf-home-top').getByLabel('Insighta').first()).toBeVisible();
  await expect(page.getByTestId('mf-home-seen')).toHaveText(/^\d+월 \d+일 [일월화수목금토]요일$/);
  await expect(page.getByTestId('mf-home-enter')).toContainText('브리프 읽기');
  const dateButton = page.getByTestId('mf-home-past');
  await expect(dateButton).toHaveText(/^\d+월 \d+일 [일월화수목금토]요일$/);
  expect((await dateButton.boundingBox())?.height).toBe(44);
  await expect(page.getByTestId('mf-home-domain')).toHaveText(
    (await page.locator('[data-testid="mf-home-chip"][data-on]').textContent()) ?? ''
  );
  await expect(homeEl).not.toContainText('지난 브리프');
  // the date opens the past briefs; the browser's back returns to the same home
  await dateButton.click();
  await expect(page.locator(`${TOP} [data-testid="mf-past"]`)).toBeVisible();
  await page.goBack();
  await expect(homeEl).toBeVisible();
  // textContent: the text may still be hidden while its fonts load (innerText would be empty)
  const headline = ((await page.getByTestId('mf-home-headline').textContent()) ?? '').trim();
  expect(headline).not.toBe('');

  // the shown brief was read ahead when the home was entered (a good answer), so opening it reads
  // nothing again
  const chipCount = await page.getByTestId('mf-home-chip').count();
  await expect
    .poll(() => briefReads.length, { timeout: LOAD_TIMEOUT_MS })
    .toBeGreaterThanOrEqual(chipCount);
  expect(briefReads.map((r) => r.status).filter((x) => x !== 200)).toEqual([]);
  const readsBefore = briefReads.length;
  await page.getByTestId('mf-home-enter').click();
  const brief = page.locator(`${TOP} [data-testid="mf-page"]`);
  await expect(brief).toBeVisible();
  await expect(brief.getByTestId('mf-page-headline')).toHaveText(headline);
  await expect(brief.getByTestId('mf-page-core')).toBeVisible();
  await expect(page.getByTestId('mf-page-skeleton')).toHaveCount(0);
  expect(briefReads.length).toBe(readsBefore);
  await expect(brief.getByTestId('mf-page-home')).toHaveText('홈');
  await expect(brief.getByTestId('mf-page-videos')).toContainText('근거가 된 영상');
  // no experiment UI for a participant
  await expect(brief.getByTestId('mf-page-today')).toHaveCount(0);
  await expect(brief.getByTestId('mf-page-order')).toHaveCount(0);

  // a source opens its sheet (with the player) over the article; closing it keeps the place
  const scroll = brief.getByTestId('mf-page-scroll');
  const place = () => scroll.evaluate((el) => el.scrollTop);
  const cite = brief.getByTestId('mf-page-core').getByTestId('mf-page-cite').last();
  await cite.scrollIntoViewIfNeeded();
  await scroll.evaluate((el) => el.scrollBy(0, 60));
  const before = await place();
  expect(before).toBeGreaterThan(0);
  const sheet = page.getByTestId('mf-src-sheet');
  await cite.click();
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('iframe')).toHaveCount(1, { timeout: LOAD_TIMEOUT_MS });
  const frame = await sheet.locator('iframe').boundingBox();
  expect(frame?.width).toBeGreaterThanOrEqual(200);
  expect(frame?.height).toBeGreaterThanOrEqual(200);
  await expect(page.getByTestId('mf-watch-counter')).toHaveCount(0);
  await expect(brief.getByTestId('mf-page-lit')).toHaveCount(1);
  await info.attach('source-sheet', { body: await page.screenshot(), contentType: 'image/png' });
  expect(await place()).toBe(before);
  await page.getByTestId('mf-src-close').click();
  await expect(sheet).toHaveCount(0);
  await expect(brief.getByTestId('mf-page-lit')).toHaveCount(0);
  expect(await place()).toBe(before);
  // the browser's back closes the sheet, not the article
  await cite.click();
  await expect(sheet).toBeVisible();
  await page.goBack();
  await expect(sheet).toHaveCount(0);
  await expect(brief.getByTestId('mf-page-headline')).toBeVisible();
  expect(await place()).toBe(before);

  // the sheet's full view opens the video screen; back returns to the same place in the brief
  await cite.click();
  await page.getByTestId('mf-src-full').click();
  await expect(page.getByTestId('mf-watch-counter')).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  await expect(sheet).toHaveCount(0);
  await info.attach('evidence-video', { body: await page.screenshot(), contentType: 'image/png' });
  await page.getByTestId('mf-watch-back').click();
  await expect(page.getByTestId('mf-page-watch')).toHaveCount(0, { timeout: 5000 });
  await expect(brief.getByTestId('mf-page-headline')).toBeVisible();
  expect(await place()).toBe(before);

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
