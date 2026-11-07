/**
 * SPEC section 9 M2: the screen must work at 320..430 wide and at short heights.
 * Not a pixel comparison with the reference (it only exists at 390x844): it checks that nothing
 * is cut off or scrolls, and saves a capture per size for a look.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

const IMPL = (process.env.IMPL_BASE ?? '') + '/morning-cards';
const OUT = path.join(__dirname, '..', '..', 'test-results', 'parity-captures', 'sizes');

const SIZES: Array<[string, number, number]> = [
  ['320x568-iphone-se1', 320, 568],
  ['360x640-android-small', 360, 640],
  ['360x800-android', 360, 800],
  ['375x629-iphone-13-mini-safari', 375, 629],
  ['375x667-iphone-se2', 375, 667],
  ['393x852-iphone-15', 393, 852],
  ['430x932-iphone-pro-max', 430, 932],
  ['768x1024-tablet', 768, 1024],
];

const STATES: Array<[string, string]> = [
  ['feed', 'onboard=0&noanim=1'],
  ['picker', 'state=picker&noanim=1'],
];

for (const [label, w, h] of SIZES) {
  for (const [state, q] of STATES) {
    test(`sizes: ${label} ${state}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`${IMPL}?fixture=1&${q}`);
      await page.evaluate(() => (document as any).fonts?.ready);
      const root = page.locator('[data-testid=mf-root]');
      await expect(root).toBeVisible();
      await page.waitForTimeout(500);

      const box = (await root.boundingBox())!;
      // the screen is as wide as the phone up to 430 and as tall as the visible area
      expect(Math.round(box.width)).toBe(Math.min(w, 430));
      expect(Math.round(box.height)).toBe(h);
      // the page itself must not scroll sideways or up and down
      const overflow = await page.evaluate(() => ({
        x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        y: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      }));
      expect(overflow.x).toBeLessThanOrEqual(0);
      expect(overflow.y).toBeLessThanOrEqual(0);

      if (state === 'feed') {
        // header, video area and the dots at the bottom are all inside the screen
        for (const id of ['mf-chip', 'mf-tray', 'mf-player', 'mf-dots']) {
          const b = (await page.getByTestId(id).boundingBox())!;
          expect(b.x, `${id} left edge`).toBeGreaterThanOrEqual(-0.5);
          expect(b.x + b.width, `${id} right edge`).toBeLessThanOrEqual(box.x + box.width + 0.5);
          expect(b.y + b.height, `${id} bottom edge`).toBeLessThanOrEqual(h + 0.5);
        }
        // the video area keeps 16:9
        const p = (await page.getByTestId('mf-player').boundingBox())!;
        expect(Math.abs(p.height - Math.floor((Math.min(w, 430) * 9) / 16))).toBeLessThanOrEqual(1);
      }

      fs.mkdirSync(OUT, { recursive: true });
      fs.writeFileSync(path.join(OUT, `${label}-${state}.png`), await page.screenshot());
    });
  }
}
