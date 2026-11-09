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

test('morning feed: swipe right saves one judgment, undo cancels it (phone 390x844)', async ({ page }, info) => {
  expect(EMAIL, 'STG_TEST_EMAIL is not set').not.toBe('');
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.goto('/morning-cards?onboard=0');
  await expect(page.getByTestId('mf-card')).toBeVisible({ timeout: 25_000 });
  // the live card carries a YouTube video, not the fixture text
  await expect(page.getByTestId('mf-title')).not.toHaveText('');

  // diagnostics for the report: what the video area really shows after the player had time to start
  await page.waitForTimeout(6000);
  const frames = page.frames().map((f) => f.url()).filter((u) => u.includes('youtube'));
  await info.attach('live-feed-screen', { body: await page.screenshot(), contentType: 'image/png' });
  await info.attach('player-state', {
    body: JSON.stringify({
      iframeCount: await page.locator('iframe').count(),
      youtubeFrames: frames,
      title: await page.getByTestId('mf-title').innerText(),
      playerBox: await page.getByTestId('mf-player').boundingBox(),
    }),
    contentType: 'application/json',
  });

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

// Left = dislike (saved as 'skip'), up = the card is replaced (saved as 'pass'); undo cancels each.
for (const [name, dx, dy, verdict] of [
  ['left', -160, 0, 'skip'],
  ['up', 0, -160, 'pass'],
] as const) {
  test(`morning feed: swipe ${name} saves '${verdict}' and undo cancels it`, async ({ page }) => {
    expect(EMAIL, 'STG_TEST_EMAIL is not set').not.toBe('');
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    await page.goto('/morning-cards?onboard=0');
    await expect(page.getByTestId('mf-card')).toBeVisible({ timeout: 25_000 });
    const saved = page.waitForRequest(
      (r) => r.url().includes('/api/v1/morning-feed/judgments') && r.method() === 'POST'
    );
    const b = (await page.getByTestId('mf-title').boundingBox())!;
    const x = b.x + b.width / 2 + (dx < 0 ? 60 : 0);
    const y = b.y + b.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 10 });
    await page.mouse.up();
    const req = await saved;
    expect((req.postDataJSON() as { verdict: string }).verdict).toBe(verdict);
    const undone = page.waitForResponse(
      (r) => r.url().includes('/api/v1/morning-feed/judgments/last') && r.request().method() === 'DELETE'
    );
    await page.getByTestId('mf-undo').click();
    expect((await undone).status()).toBe(200);
  });
}

// YouTube developer policy (III.I.6): nothing may be drawn over the player. When playback cannot start, the
// notice with the YouTube link sits BELOW the video area. The failure is forced by blocking the player script.
test('morning feed: playback failure notice is below the player, nothing over it', async ({ page }, info) => {
  expect(EMAIL, 'STG_TEST_EMAIL is not set').not.toBe('');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('https://www.youtube.com/iframe_api', (route) => route.abort());
  await signIn(page);
  await page.goto('/morning-cards?onboard=0');
  await expect(page.getByTestId('mf-card')).toBeVisible({ timeout: 25_000 });
  const notice = page.getByTestId('mf-player-failed');
  await expect(notice).toBeVisible({ timeout: 15_000 });
  const link = page.getByTestId('mf-open-yt');
  await expect(link).toHaveAttribute('href', /youtube\.com\/watch\?v=/);
  const player = (await page.getByTestId('mf-player').boundingBox())!;
  const box = (await link.boundingBox())!;
  // the link starts at or below the bottom edge of the player area
  expect(box.y).toBeGreaterThanOrEqual(player.y + player.height - 0.5);
  // and no link element exists inside the player area
  expect(await page.getByTestId('mf-player').locator('a').count()).toBe(0);
  await info.attach('playback-failed-screen', { body: await page.screenshot(), contentType: 'image/png' });
});
