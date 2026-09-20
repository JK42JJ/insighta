/**
 * One classifier, read by the book and by the enrich handler.
 *
 * Every case here is a row shape observed on production on 2026-09-18, on a
 * mandala whose note banner had been spinning for two days.
 */

jest.mock('@/utils/logger', () => ({
  logger: { child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) },
}));

import { v2State, isCompleteV2 } from '@/modules/queue/handlers/v2-completeness';

const CAPPED = { _book_v2_retry: 1 };
const complete = { template_version: 'v2', transcript_used: true, mandala_relevance_pct: 60 };

describe('v2State', () => {
  it('pass with segments is usable', () => {
    expect(v2State({ quality_flag: 'pass', segments: [{ t: 0 }] })).toBe('usable');
  });

  // Ten rows like this on one mandala. The book could not use them; enrich
  // called them complete and returned a cache hit, so they never changed.
  it('pass WITHOUT segments is terminal, not generating', () => {
    expect(v2State({ quality_flag: 'pass', segments: null })).toBe('terminal');
  });

  it('skipped is terminal whatever else it carries', () => {
    expect(v2State({ quality_flag: 'skipped', segments: [{ t: 0 }] })).toBe('terminal');
  });

  it('pending with an attempt in flight is generating', () => {
    expect(v2State({ quality_flag: 'pending' }, true)).toBe('generating');
  });

  it.each(['low', 'enrichment_low', 'failed'])(
    '%s below the cap is retryable — background retry, no spinner',
    (flag) => {
      expect(v2State({ quality_flag: flag, segments: null })).toBe('retryable');
    }
  );

  it.each(['low', 'enrichment_low', 'failed'])('%s at the cap is terminal', (flag) => {
    expect(v2State({ quality_flag: flag, segments: null, translations: CAPPED })).toBe('terminal');
  });

  // The closed loop: no row means the retry counter's UPDATE matches nothing,
  // so the counter never rises and the card never reaches the cap. Classifying
  // it by whether anything is actually working on it breaks the circle.
  it('no row with an attempt in flight is generating', () => {
    expect(v2State(null, true)).toBe('generating');
  });

  it('no row and nothing in flight is terminal, not generating forever', () => {
    expect(v2State(null, false)).toBe('terminal');
    expect(v2State(undefined)).toBe('terminal');
  });

  it('an unknown flag does not silently become generating', () => {
    expect(v2State({ quality_flag: 'something_new' as never, segments: null })).toBe('retryable');
  });
});

describe('isCompleteV2', () => {
  it('is true only when the row is also usable', () => {
    expect(isCompleteV2({ ...complete, quality_flag: 'pass', segments: [{ t: 0 }] })).toBe(true);
  });

  // The disagreement, stated as a test: this row used to be complete to enrich
  // and unusable to the book, and that gap is what kept the spinner up.
  it('is false for a pass row with no segments', () => {
    expect(isCompleteV2({ ...complete, quality_flag: 'pass', segments: null })).toBe(false);
  });

  it('still requires v2, a transcript and a relevance score', () => {
    const usable = { quality_flag: 'pass', segments: [{ t: 0 }] };
    expect(isCompleteV2({ ...complete, ...usable, template_version: 'v1' })).toBe(false);
    expect(isCompleteV2({ ...complete, ...usable, transcript_used: false })).toBe(false);
    expect(isCompleteV2({ ...complete, ...usable, mandala_relevance_pct: null })).toBe(false);
  });

  it('is false for null', () => {
    expect(isCompleteV2(null)).toBe(false);
  });
});
