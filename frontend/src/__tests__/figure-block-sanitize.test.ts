/**
 * sanitizeSvg — adaptive-figure (theme='auto') sentinel swap + existing scrubs.
 * Regression for [CV-NOTE-WIRE] dual-mode figures: the #808080 ink sentinel must
 * become currentColor so the figure inherits the note's text color per mode.
 */
import { describe, it, expect } from 'vitest';
import { sanitizeSvg } from '@/pages/learning/lib/figure-block';

describe('sanitizeSvg — adaptive ink sentinel → currentColor', () => {
  it('swaps #808080 in fill=, stroke=, stop-color and style attrs (case-insensitive)', () => {
    const raw =
      '<svg viewBox="0 0 10 10">' +
      '<text fill="#808080">노드</text>' +
      '<line stroke="#808080" x1="0" y1="0" x2="10" y2="10"/>' +
      '<stop stop-color="#808080"/>' +
      '<rect style="fill:#808080;stroke:#808080"/>' +
      '<path stroke="#808080"/>' +
      '</svg>';
    const out = sanitizeSvg(raw);
    expect(out).not.toMatch(/#808080/i);
    expect(out).toContain('currentColor');
  });

  it('keeps category accent-color borders untouched (non-sentinel hues)', () => {
    const raw = '<svg viewBox="0 0 4 4"><rect stroke="#c2a878" fill="#808080"/></svg>';
    const out = sanitizeSvg(raw);
    expect(out).toContain('#c2a878'); // accent border preserved
    expect(out).not.toMatch(/#808080/i); // ink swapped
  });

  it('still strips width/height, <script> and on* handlers', () => {
    const raw =
      '<svg width="500" height="300" viewBox="0 0 10 10" onload="x()">' +
      '<script>alert(1)</script><text fill="#808080" onclick="y()">t</text></svg>';
    const out = sanitizeSvg(raw);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/onload=/i);
    expect(out).not.toMatch(/onclick=/i);
    expect(out).not.toMatch(/width="500"/);
    expect(out).not.toMatch(/height="300"/);
    expect(out).toContain('preserveAspectRatio');
  });

  it('returns empty string on parse failure', () => {
    expect(sanitizeSvg('not-svg <<<')).toBe('');
  });
});
