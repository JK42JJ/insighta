/**
 * Self-check of the parity run (does not touch the delivered parity spec):
 *  1. saves the reference and the implementation screenshot of every state as separate files,
 *  2. negative control: two different states compared on purpose must NOT match.
 */
import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const REF = pathToFileURL(path.join(__dirname, 'fixtures', 'morning-feed.reference.html')).href;
const IMPL = (process.env.IMPL_BASE ?? '') + '/morning-cards';
const MAX_DIFF = 0.003;
const OUT = path.join(__dirname, '..', '..', 'test-results', 'parity-captures');

const STATES: Array<[string, string]> = [
  ['01-feed', 'onboard=0&noanim=1'],
  ['02-keep', 'state=keep&noanim=1'],
  ['03-toast', 'state=toast&noanim=1'],
  ['04-picker', 'state=picker&noanim=1'],
  ['05-done', 'state=done&noanim=1'],
  ['06-feed-cell0', 'onboard=0&noanim=1&cell=0'],
  ['07-picker-cell1', 'state=picker&noanim=1&cell=1'],
  ['08-empty-cell-param', 'onboard=0&noanim=1&cell=2'],
];

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

async function shot(page: Page, url: string): Promise<Buffer> {
  await page.goto(url);
  await page.evaluate(() => (document as any).fonts?.ready);
  await page.waitForTimeout(500);
  return page.locator('[data-testid=mf-root]').screenshot();
}

test('captures: reference and implementation of every state as separate files', async ({ page }) => {
  fs.mkdirSync(path.join(OUT, 'reference'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'implementation'), { recursive: true });
  for (const [name, q] of STATES) {
    fs.writeFileSync(path.join(OUT, 'reference', `${name}.png`), await shot(page, `${REF}?${q}`));
    fs.writeFileSync(
      path.join(OUT, 'implementation', `${name}.png`),
      await shot(page, `${IMPL}?fixture=1&${q}`)
    );
  }
});

test('negative control: implementation 01-feed vs reference 02-keep must differ', async ({ page }, info) => {
  const refKeep = await shot(page, `${REF}?state=keep&noanim=1`);
  const snap = info.snapshotPath('negative-reference-02-keep.png');
  fs.mkdirSync(path.dirname(snap), { recursive: true });
  fs.writeFileSync(snap, refKeep);
  const implFeed = await shot(page, `${IMPL}?fixture=1&onboard=0&noanim=1`);
  // The same comparison the parity run uses; here a mismatch is the expected outcome.
  expect(implFeed).not.toMatchSnapshot('negative-reference-02-keep.png', { maxDiffPixelRatio: MAX_DIFF });
});
