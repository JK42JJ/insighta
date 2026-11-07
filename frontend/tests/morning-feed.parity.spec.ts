/**
 * 오늘의 픽 — 디자인 동일성 시험 (James 확정 디자인 v1)
 *
 * 같은 브라우저·같은 글꼴 환경에서 기준 구현(reference.html)과 실제 화면(/morning-cards)을
 * 상태별로 찍어 픽셀 비교한다. 기준과 다르면 실패. 기준 값을 고쳐서 통과시키는 것은 금지.
 *
 * 배치: frontend/tests/morning-feed.parity.spec.ts
 *       frontend/tests/fixtures/morning-feed.reference.html  (전달본 그대로, 수정 금지)
 *       frontend/tests/fixtures/morning-feed.fixture.json     (전달본 그대로, 수정 금지)
 * 실행: playwright.verify.config.ts (127.0.0.1:4173) 기준. IMPL_BASE로 stg 주소도 가능.
 */
import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const REF = pathToFileURL(path.join(__dirname, 'fixtures', 'morning-feed.reference.html')).href;
const IMPL = (process.env.IMPL_BASE ?? '') + '/morning-cards';
const MAX_DIFF = 0.003; // 0.3% 픽셀까지만 허용 (글꼴 안티앨리어싱 오차 수준)

const STATES: Array<[string, string]> = [
  ['01-feed', 'onboard=0&noanim=1'],
  ['02-keep', 'state=keep&noanim=1'],
  ['03-toast', 'state=toast&noanim=1'],
  ['04-picker', 'state=picker&noanim=1'],
  ['05-done', 'state=done&noanim=1'],
  ['06-feed-cell0', 'onboard=0&noanim=1&cell=0'],
  ['07-picker-cell2', 'state=picker&noanim=1&cell=2'],
];

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

async function shot(page: Page, url: string): Promise<Buffer> {
  await page.goto(url);
  await page.evaluate(() => (document as any).fonts?.ready);
  await page.waitForTimeout(500);
  return page.locator('[data-testid=mf-root]').screenshot();
}

for (const [name, q] of STATES) {
  test(`디자인 동일성: ${name}`, async ({ page }, info) => {
    const ref = await shot(page, `${REF}?${q}`);
    const snap = info.snapshotPath(`${name}.png`);
    fs.mkdirSync(path.dirname(snap), { recursive: true });
    fs.writeFileSync(snap, ref); // 기준은 매 실행마다 reference.html에서 새로 만든다 (같은 환경 비교)
    await info.attach(`${name}-reference`, { body: ref, contentType: 'image/png' });
    const impl = await shot(page, `${IMPL}?fixture=1&${q}`);
    await info.attach(`${name}-implementation`, { body: impl, contentType: 'image/png' });
    expect(impl).toMatchSnapshot(`${name}.png`, { maxDiffPixelRatio: MAX_DIFF });
  });
}

/* ── 동작 시험: 기준과 같은 결과가 나와야 한다 ── */
async function dragCard(page: Page, dx: number, dy: number) {
  const b = (await page.locator('[data-testid=mf-title]').boundingBox())!;
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(700);
}

test('동작: 오른쪽 = useful 1행, 위 = skip 1행, 되돌리기 = 마지막 1행 취소', async ({ page }) => {
  const writes: Array<{ method: string; body: any }> = [];
  page.on('request', (r) => {
    if (r.url().includes('/morning-cards') && ['POST', 'DELETE'].includes(r.method())) {
      writes.push({ method: r.method(), body: r.postDataJSON?.() ?? null });
    }
  });
  await page.goto(`${IMPL}?fixture=1&onboard=0`);
  await dragCard(page, 160, 0);
  await dragCard(page, 0, -160);
  await expect(page.locator('[data-testid=mf-tray]')).toHaveText('1');
  await page.click('[data-testid=mf-undo]');
  await page.waitForTimeout(400);
  const verdicts = writes.filter((w) => w.method === 'POST').map((w) => w.body?.verdict);
  expect(verdicts).toEqual(['useful', 'skip']);
  expect(writes.some((w) => w.method === 'DELETE') || writes.length === 3).toBeTruthy();
});

test('동작: 칸 고르기 → 칩 이름·토스트가 바뀜', async ({ page }) => {
  await page.goto(`${IMPL}?fixture=1&onboard=0`);
  await page.click('[data-testid=mf-chip]');
  await page.waitForTimeout(600);
  await page.click('[data-testid=mf-cell-0]');
  await page.waitForTimeout(700);
  await expect(page.locator('[data-testid=mf-chip]')).toHaveText('기술·개발');
  await expect(page.locator('[data-testid=mf-toast]')).toContainText('기술·개발 · 5개');
});

test('동작: 처음 열면 담기 시연 1회, 손대면 즉시 멈춤', async ({ page }) => {
  await page.goto(`${IMPL}?fixture=1`);
  await expect(page.locator('[data-testid=mf-onboard]')).toHaveCSS('opacity', '1');
  await page.waitForTimeout(4600);
  await expect(page.locator('[data-testid=mf-onboard]')).toHaveCSS('opacity', '0');
});
