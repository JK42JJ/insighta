import { test, expect, type Page, type Request } from '@playwright/test';

// 시청 flow (/morning-cards?view=watch, design 수정 3) on the deployed staging site: on 입력 press a
// goal chip that is neither done nor disabled (the server issues today's batch and the feed opens
// straight away), answer the first video with 좋아 and swipe on: exactly one judgment is saved with
// surface 'watch' and the batch index as shown_position (a liked card swiped up stays 좋아, no
// 넘김 is sent), and the counter moves on. The chips come from GET /watch/today only, so
// judgments made in the swipe deck do not change what this test sees. The screen has no undo; the
// test cancels its own row afterwards through the API. The staging test account keeps one batch
// per goal per day (accepted).

const EMAIL = process.env.STG_TEST_EMAIL ?? '';
const PASSWORD = process.env.STG_TEST_PASSWORD ?? '';
const JUDGMENTS_PATH = '/api/v1/morning-feed/judgments';
const INSIGHT_PATH = '/api/v1/morning-feed/watch/insight';
const BATCH_PATH = '/api/v1/morning-feed/watch/batch';
/** watch-design.ts WATCH_ONB_SEEN_KEY */
const ONB_SEEN_KEY = 'mf_watch_onb_seen';
const LOAD_TIMEOUT_MS = 25_000;
/** Longer than the 460ms card change, so a second POST would have been sent by then. */
const SETTLE_MS = 1500;
const CURRENT = '[data-testid="mf-w3-card"][data-current]';

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('input#email').fill(EMAIL);
  await page.locator('input#password').fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login/);
}

const isJudgmentPost = (r: Request) => r.url().includes(JUDGMENTS_PATH) && r.method() === 'POST';

test('morning watch: a goal chip opens the feed, 좋아 then swipe saves one useful judgment and the counter advances (phone 390x844)', async ({
  page,
}, info) => {
  expect(EMAIL, 'STG_TEST_EMAIL is not set').not.toBe('');
  await page.setViewportSize({ width: 390, height: 844 });
  // the 01 온보딩 has been seen on this device: the flow starts on 02 입력
  await page.addInitScript((key) => {
    try {
      window.localStorage.setItem(key, '1');
    } catch {
      /* storage blocked: the onboarding would show */
    }
  }, ONB_SEEN_KEY);
  await signIn(page);
  await page.goto('/morning-cards?view=watch');
  await expect(page.getByTestId('mf-w-input')).toBeVisible({ timeout: LOAD_TIMEOUT_MS });
  await expect(page.getByTestId('mf-w-onb')).toHaveCount(0);
  // the deck is not on this screen
  await expect(page.getByTestId('mf-card')).toHaveCount(0);

  // the 8 goals are the "요즘 많이 고르는 것" chips
  const chips = page.getByTestId('mf-w-chip');
  expect(await chips.count()).toBe(8);
  // a chip in the '오늘은 끝' state (data-state="done") opens its insight, not videos
  const chip = page
    .locator('[data-testid="mf-w-chip"]:not([disabled]):not([data-state="done"])')
    .first();
  await expect(chip, 'no goal has cards today on the staging account').toBeVisible();
  const total = Number(await chip.getAttribute('data-count'));
  expect(total).toBeGreaterThan(0);
  const batchRes = page.waitForResponse(
    (r) => r.url().includes(BATCH_PATH) && r.request().method() === 'POST'
  );
  // no level, branch or CTA step any more: the chip starts the feed
  await chip.click();
  const batch = await batchRes;
  expect(batch.status()).toBe(200);
  const batchData = (await batch.json()).data as {
    cell: string;
    items: Array<{ video_id: string }>;
    judged: Record<string, string>;
  };
  // the first unanswered batch video comes first; its batch index is the shown_position
  const firstOpen = batchData.items.findIndex((v) => !(v.video_id in batchData.judged));
  expect(firstOpen).toBeGreaterThanOrEqual(0);

  await expect(page.getByTestId('mf-w3-watch')).toBeVisible();
  await expect(page.getByTestId('mf-watch-counter')).toHaveText(`1 / ${total}`);
  // design 수정 4: the per-card progress segments are gone, the counter is the only position cue
  await expect(page.getByTestId('mf-watch-seg')).toHaveCount(0);
  const card = page.locator(CURRENT);
  await expect(card.getByTestId('mf-watch-title')).not.toHaveText('');

  // three round buttons with labels and no text (별로 = thumbs down, 좋아 = heart, 공유)
  for (const [id, label] of [
    ['mf-watch-skip', '별로'],
    ['mf-watch-like', '좋아'],
    ['mf-watch-share', '공유'],
  ] as const) {
    const btn = card.getByTestId(id);
    await expect(btn).toBeVisible();
    await expect(btn).toHaveAttribute('aria-label', label);
    expect((await btn.innerText()).trim()).toBe('');
  }

  // no undo control on this screen
  await expect(page.getByTestId('mf-undo')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /되돌리기|실행 취소/ })).toHaveCount(0);

  // the info blocks show only with data (the reason band is empty during the context experiment)
  await expect(page.getByTestId('mf-detail-open')).toHaveCount(0);
  const present: string[] = [];
  for (const id of ['mf-oneliner', 'mf-reason', 'mf-chapters']) {
    const block = card.getByTestId(id);
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
  // a one-video batch ends on the insight: it must be read for this goal only
  const insightRequest =
    total === 1 ? page.waitForRequest((r) => r.url().includes(INSIGHT_PATH)) : null;
  await card.getByTestId('mf-watch-like').click();
  const res = await saved;
  expect(res.status()).toBe(201);
  const body = res.request().postDataJSON() as {
    video_id: string;
    cell: string;
    verdict: string;
    shown_position: number;
    surface: string;
  };
  expect(body.verdict).toBe('useful');
  expect(body.surface).toBe('watch');
  expect(body.cell).toBe(batchData.cell);
  // a batch nobody answered yet (or whose answers were cancelled) starts at index 0
  expect(body.shown_position).toBe(firstOpen);
  expect(body.video_id).toBe(batchData.items[firstOpen]!.video_id);
  expect(Object.keys(body).sort()).toEqual([
    'cell',
    'shown_position',
    'surface',
    'verdict',
    'video_id',
  ]);

  // 좋아 stays on the card with its confirmation; swiping on (↓) keeps the verdict 좋아
  await expect(card.getByTestId('mf-watch-like')).toHaveAttribute('data-on', '');
  await expect(page.getByTestId('mf-watch-counter')).toHaveText(`1 / ${total}`);
  await page.keyboard.press('ArrowDown');
  if (total > 1) {
    await expect(page.getByTestId('mf-watch-counter')).toHaveText(`2 / ${total}`);
  } else {
    await expect(page.getByTestId('mf-w-insight')).toBeVisible();
  }
  if (insightRequest) {
    const insightUrl = new URL((await insightRequest).url());
    expect(insightUrl.searchParams.get('cell')).toBe(body.cell);
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
