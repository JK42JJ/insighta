/**
 * isCompleteV2 — the on-demand enrich handler's cache-hit guard. A complete
 * GLOBAL v2 (transcript-grounded + relevance) must short-circuit so re-enrich
 * (Heart re-click etc.) does NOT re-call Haiku+Sonnet for already-cached content.
 *
 * 2026-09-18 — the guard now also requires time segments, and the first case
 * below carries them where it used to omit them.
 *
 * That is not a test edit to make a build pass. The three conditions here say
 * a row is v2, transcript-grounded and relevance-scored; the book separately
 * required segments to build a section from one. A row that satisfied these
 * three and had no segments was complete to this guard and unusable to the
 * book, so the book asked for it to be regenerated and this guard answered
 * cache hit, indefinitely. The note banner counted those cards as "being
 * generated" the whole time.
 *
 * Measured before changing it: 113 rows across the table flip from complete to
 * incomplete, 97 of them already flagged `low` — failures whose regeneration
 * this guard had been suppressing. Five are `pass` with no segments. After the
 * staleness bound in #1725, nine actually regenerate.
 */
import { isCompleteV2 } from '../../src/modules/queue/handlers/v2-completeness';

/** A row that is genuinely finished: the three fields AND something to build from. */
const complete = {
  template_version: 'v2',
  transcript_used: true,
  mandala_relevance_pct: 70,
  quality_flag: 'pass',
  segments: [{ t0: 0, t1: 10, text: 'a line' }],
};

describe('isCompleteV2 (enrich cache-hit guard)', () => {
  it('complete v2 (transcript + relevance + segments) → cache hit', () => {
    expect(isCompleteV2(complete)).toBe(true);
  });
  it('description-only v2 (no transcript) → NOT complete (regen)', () => {
    expect(isCompleteV2({ ...complete, transcript_used: false })).toBe(false);
  });
  it('v2 without relevance → NOT complete (regen)', () => {
    expect(isCompleteV2({ ...complete, mandala_relevance_pct: null })).toBe(false);
  });
  it('v1 row → NOT complete (regen)', () => {
    expect(isCompleteV2({ ...complete, template_version: 'v1' })).toBe(false);
  });
  it('no row → NOT complete', () => {
    expect(isCompleteV2(null)).toBe(false);
  });

  // The gap this closes: all three legacy conditions met, nothing to build a
  // section from. The book asked; this guard said cache hit; nothing changed.
  it('v2 with transcript and relevance but NO segments → NOT complete', () => {
    expect(isCompleteV2({ ...complete, segments: null })).toBe(false);
  });

  it('a failed row is not a cache hit even if it carries segments', () => {
    expect(isCompleteV2({ ...complete, quality_flag: 'low' })).toBe(false);
  });
});
