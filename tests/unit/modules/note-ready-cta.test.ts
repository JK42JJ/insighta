/**
 * Note-ready email CTA — route-shape regression guard.
 *
 * Bug (2026-07-14, sample-email click): the note-ready CTA linked to
 * `/learning/:mandalaId` but the FE router only defines
 * `/learning/:mandalaId/:videoId` — the emailed link client-rendered the 404
 * page. These tests pin the CTA to real routes: a two-segment learning link
 * when the book has a video, the mandala dashboard when it does not.
 */

import { firstBookVideoId, noteReadyCtaUrl } from '../../../src/modules/email/note-ready-cta';

describe('firstBookVideoId', () => {
  it('returns the first atom vid across chapters/sections', () => {
    const book = {
      chapters: [
        { sections: [{ atoms: [] }, { atoms: [{ vid: 'abc123DEF45' }, { vid: 'zzz' }] }] },
        { sections: [{ atoms: [{ vid: 'later' }] }] },
      ],
    };
    expect(firstBookVideoId(book)).toBe('abc123DEF45');
  });

  it('returns null for empty or malformed book_json', () => {
    expect(firstBookVideoId(null)).toBeNull();
    expect(firstBookVideoId(undefined)).toBeNull();
    expect(firstBookVideoId({})).toBeNull();
    expect(firstBookVideoId({ chapters: [{ sections: [{ atoms: [{ vid: 42 }] }] }] })).toBeNull();
    expect(firstBookVideoId({ chapters: 'not-an-array' })).toBeNull();
  });
});

describe('noteReadyCtaUrl', () => {
  it('emits the two-segment learning route when a video exists', () => {
    const url = noteReadyCtaUrl('m-1', 'v-1');
    expect(url).toBe('https://insighta.one/learning/m-1/v-1');
    // FE route contract: /learning/:mandalaId/:videoId — exactly two segments.
    const path = new URL(url).pathname;
    expect(path.split('/').filter(Boolean)).toHaveLength(3);
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
