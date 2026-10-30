import { readFileSync } from 'fs';
import { join } from 'path';

const SURVEY_DIR = join(__dirname, '../../../charts/insighta/files/survey');
const PAGE_URL = 'https://insighta.one/survey';
const IMAGE_URL = 'https://insighta.one/survey/survey-og.jpg';
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const MAX_IMAGE_BYTES = 300 * 1024;
const JPEG_SOI = [0xff, 0xd8];
const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2]);

function html(): string {
  return readFileSync(join(SURVEY_DIR, 'index.html'), 'utf8');
}

/** Width and height from the first JPEG start-of-frame segment. */
function jpegSize(buf: Buffer): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1] ?? 0;
    const length = buf.readUInt16BE(i + 2);
    if (SOF_MARKERS.has(marker)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + length;
  }
  return null;
}

describe('survey preview page', () => {
  it('carries the Open Graph tags in the HTML itself, since the crawler runs no script', () => {
    const page = html();
    expect(page).toContain(`<meta property="og:image" content="${IMAGE_URL}">`);
    expect(page).toContain(`<meta property="og:url" content="${PAGE_URL}">`);
    expect(page).toMatch(/<meta property="og:title" content="[^"]+">/);
    expect(page).toMatch(/<meta property="og:description" content="[^"]+">/);
    expect(page).toContain(`<meta property="og:image:width" content="${OG_WIDTH}">`);
    expect(page).toContain(`<meta property="og:image:height" content="${OG_HEIGHT}">`);
  });

  it('sends the visitor to the form, by meta refresh and by a visible link', () => {
    const page = html();
    const target = /http-equiv="refresh" content="0; url=([^"]+)"/.exec(page)?.[1];
    expect(target).toMatch(/^https:\/\/docs\.google\.com\/forms\/d\/e\/[\w-]+\/viewform$/);
    expect(page).toContain(`<a href="${target}">`);
  });

  it('ships a 1200x630 JPEG small enough to preview', () => {
    const image = readFileSync(join(SURVEY_DIR, 'survey-og.jpg'));
    expect([image[0], image[1]]).toEqual(JPEG_SOI);
    expect(image.length).toBeLessThan(MAX_IMAGE_BYTES);
    expect(jpegSize(image)).toEqual({ width: OG_WIDTH, height: OG_HEIGHT });
  });
});
