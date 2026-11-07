/* Temporary diagnostics: why text in the implementation is narrower than in the reference. */
import { test } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REF = pathToFileURL(path.join(__dirname, 'fixtures', 'morning-feed.reference.html')).href;
const IMPL = (process.env.IMPL_BASE ?? '') + '/morning-cards?fixture=1';

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

for (const [name, url] of [
  ['REF', `${REF}?onboard=0&noanim=1`],
  ['IMPL', `${IMPL}&onboard=0&noanim=1`],
] as const) {
  test(`fonts: ${name}`, async ({ page }) => {
    await page.goto(url);
    await page.evaluate(() => (document as any).fonts?.ready);
    await page.waitForTimeout(1500);
    const info = await page.evaluate(() => {
      const el = document.querySelector('[data-testid=mf-title]') as HTMLElement;
      const cs = getComputedStyle(el);
      const range = document.createRange();
      range.selectNodeContents(el);
      const r = el.getBoundingClientRect();
      const faces = Array.from((document as any).fonts as Iterable<any>).map(
        (f: any) => `${f.family}/${f.weight}/${f.status}`
      );
      const loaded = faces.filter((f) => f.endsWith('loaded')).length;
      return {
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        letterSpacing: cs.letterSpacing,
        wordSpacing: cs.wordSpacing,
        fontKerning: cs.fontKerning,
        textRendering: cs.textRendering,
        fontFeatureSettings: cs.fontFeatureSettings,
        fontVariantLigatures: cs.fontVariantLigatures,
        lang: document.documentElement.lang,
        width: r.width,
        faces: faces.length,
        loaded,
        notLoaded: faces.filter((f) => !f.endsWith('loaded')).slice(0, 6),
      };
    });
    const client = await page.context().newCDPSession(page);
    await client.send('DOM.enable');
    await client.send('CSS.enable');
    const doc = await client.send('DOM.getDocument', { depth: -1 });
    const node = await client.send('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector: '[data-testid=mf-title]',
    });
    const fonts = await client.send('CSS.getPlatformFontsForNode', { nodeId: node.nodeId });
    // eslint-disable-next-line no-console
    console.log('DIAG ' + name + ' ' + JSON.stringify(info) + ' PLATFORM ' + JSON.stringify(fonts.fonts));
  });
}
