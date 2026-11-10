import { test, expect, type Page, type Request } from '@playwright/test';

// 시청 screen (/morning-cards?view=watch) on the deployed staging site: pick a goal, answer one video
// with 좋아, exactly one judgment is saved through the feed API and the counter moves on. The screen
// has no undo; the test cancels its own row afterwards through the API so the staging account keeps
// its cards. The rows belong to the staging test account.

const EMAIL = process.env.STG_TEST_EMAIL ?? '';
const PASSWORD = process.env.STG_TEST_PASSWORD ?? '';
const JUDGMENTS_PATH = '/api/v1/morning-feed/judgments';
const LOAD_TIMEOUT_MS = 25_000;
/** Longer than the 480ms exit, so a second POST would have been sent by then. */
const SETTLE_MS = 1500;

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('input#email').fill(EMAIL);
  await page.locator('input#password').fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login/);
}

const isJudgmentPost = (r: Request) => r.url().includes(JUDGMENTS_PATH) && r.method() === 'POST';

test('morning watch: pick a goal, 좋아 saves one useful judgment and the counter advances (phone 390x844)', async ({
  page,
}, info) => {
  expect(EMAIL, 'STG_TEST_EMAIL is not set').not.toBe('');
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.goto('/morning-cards?view=watch');
  await expect(page.getByTestId('mf-watch-goals')).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  // the deck is not on this screen
  await expect(page.getByTestId('mf-card')).toHaveCount(0);

  const goals = page.getByTestId('mf-watch-goal');
  expect(await goals.count()).toBe(8);
  const goal = page.locator('[data-testid="mf-watch-goal"]:not([disabled])').first();
  await expect(goal, 'no goal has cards today on the staging account').toBeVisible();
  const total = Number(await goal.getAttribute('data-count'));
  expect(total).toBeGreaterThan(0);
  await goal.click();

  await expect(page.getByTestId('mf-watch-counter')).toHaveText(`1 / ${total}`);
  await expect(page.getByTestId('mf-watch-seg')).toHaveCount(total);
  await expect(page.getByTestId('mf-watch-title')).not.toHaveText('');

  // three round buttons with labels and no text
  for (const [id, label] of [
    ['mf-watch-skip', '별로'],
    ['mf-watch-pass', '넘기기'],
    ['mf-watch-like', '좋아'],
  ] as const) {
    const btn = page.getByTestId(id);
    await expect(btn).toBeVisible();
    await expect(btn).toHaveAttribute('aria-label', label);
    expect((await btn.innerText()).trim()).toBe('');
  }

  // no undo control on this screen
  await expect(page.getByTestId('mf-undo')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /되돌리기|실행 취소/ })).toHaveCount(0);

  // the info blocks are open from the start: no button to open them, each visible when present
  await expect(page.getByTestId('mf-detail-open')).toHaveCount(0);
  const present: string[] = [];
  for (const id of ['mf-oneliner', 'mf-reason', 'mf-chapters']) {
    const block = page.getByTestId(id);
    if ((await block.count()) > 0) {
      await expect(block).toBeVisible();
      present.push(id);
    }
  }
  await info.attach('watch-screen', { body: await page.screenshot(), contentType: 'image/png' });
  await info.attach('info-blocks', {
    body: JSON.stringify({ present }),
    contentType: 'application/json',
  });

  const posts: Request[] = [];
  page.on('request', (r) => {
    if (isJudgmentPost(r)) posts.push(r);
  });
  const saved = page.waitForResponse((r) => isJudgmentPost(r.request()));
  await page.getByTestId('mf-watch-like').click();
  const res = await saved;
  expect(res.status()).toBe(201);
  const body = res.request().postDataJSON() as {
    video_id: string;
    cell: string;
    verdict: string;
    shown_position: number;
  };
  expect(body.verdict).toBe('useful');
  expect(body.shown_position).toBe(0);
  expect(Object.keys(body).sort()).toEqual(['cell', 'shown_position', 'verdict', 'video_id']);

  if (total > 1) {
    await expect(page.getByTestId('mf-watch-counter')).toHaveText(`2 / ${total}`);
  } else {
    await expect(page.getByTestId('mf-watch-insight')).toBeVisible();
  }
  await page.waitForTimeout(SETTLE_MS);
  expect(posts).toHaveLength(1);

  // cleanup only (not a screen control): cancel the row with the same session the screen used
  const auth = res.request().headers()['authorization'];
  const undone = await page.request.delete(res.url() + '/last', {
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
    data: {},
  });
  expect(undone.status()).toBe(200);
});
