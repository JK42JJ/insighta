/**
 * Note-ready email CTA — route-shape regression guard.
 *
 * Bug lineage (2026-07-14): ① CTA linked `/learning/:mandalaId` but the FE
 * router only defines `/learning/:mandalaId/:videoId` → emailed link 404s.
 * ② A book-atom video pick landed on a mandala whose learning list (placed
 * cards) was empty → hollow page. The CTA now uses the page's own source and
 * opens note mode directly (`?view=note`); with no placed video it links the
 * dashboard instead.
 */

import { noteReadyCtaUrl } from '../../../src/modules/email/note-ready-cta';

describe('noteReadyCtaUrl', () => {
  it('emits the two-segment learning route in note mode when a video exists', () => {
    const url = noteReadyCtaUrl('m-1', 'v-1');
    const parsed = new URL(url);
    expect(parsed.origin).toBe('https://insighta.one');
    // FE route contract: /learning/:mandalaId/:videoId — exactly two segments.
    expect(parsed.pathname).toBe('/learning/m-1/v-1');
    expect(parsed.pathname.split('/').filter(Boolean)).toHaveLength(3);
    // The CTA promises the note — must land in note mode.
    expect(parsed.searchParams.get('view')).toBe('note');
  });

  it('falls back to the mandala dashboard (a real route) without a video', () => {
    expect(noteReadyCtaUrl('m-1', null)).toBe('https://insighta.one/mandalas/m-1');
  });

  it('never emits the broken one-segment learning URL', () => {
    for (const vid of [null, 'v-1']) {
      const path = new URL(noteReadyCtaUrl('m-1', vid)).pathname;
      expect(path).not.toMatch(/^\/learning\/[^/]+$/);
    }
  });
});
