/**
 * Which cards the note banner counts as "still being added".
 *
 * The banner reads `v2_pending`, and every card in that count keeps it
 * spinning. On 2026-09-18 a mandala had been spinning for two days with four
 * cards in the count, none of which could ever leave it. These tests pin the
 * classification that decides membership, using the row shapes measured there.
 */

jest.mock('@/utils/logger', () => ({
  logger: { child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) },
}));

import { v2State } from '@/modules/queue/handlers/v2-completeness';

/** What fill-book does with one gate-passed card that has no usable summary. */
function bucket(
  row: Parameters<typeof v2State>[0],
  hasPendingAttempt = false
): 'counted' | 'retried-quietly' | 'ignored' {
  const state = v2State(row, hasPendingAttempt);
  if (state === 'generating') return 'counted';
  if (state === 'retryable') return 'retried-quietly';
  return 'ignored';
}

describe('what the banner counts', () => {
  it('counts a card that is genuinely being generated', () => {
    expect(bucket({ quality_flag: 'pending' }, true)).toBe('counted');
  });

  // Ten of these on the measured mandala. The book could not use them and the
  // enrich handler called them complete, so re-queueing changed nothing.
  it('ignores a pass row with no segments instead of counting it forever', () => {
    expect(bucket({ quality_flag: 'pass', segments: null })).toBe('ignored');
  });

  // Two of these. `enrichment_low` is a failure flag, and the old branch
  // compared against the string 'low' alone, so it fell through to counted.
  it('retries enrichment_low quietly rather than counting it', () => {
    expect(bucket({ quality_flag: 'enrichment_low', segments: null })).toBe('retried-quietly');
  });

  it('retries low quietly, as it always did', () => {
    expect(bucket({ quality_flag: 'low', segments: null })).toBe('retried-quietly');
  });

  // One of these, and the one that could never end: with no row the retry
  // counter's UPDATE matched nothing, so the card could not reach the cap that
  // would have retired it.
  it('ignores a rowless card with nothing in flight', () => {
    expect(bucket(null, false)).toBe('ignored');
  });

  it('counts a rowless card while an attempt is actually in flight', () => {
    expect(bucket(null, true)).toBe('counted');
  });

  it('ignores a failure that has used up its retries', () => {
    expect(
      bucket({ quality_flag: 'low', segments: null, translations: { _book_v2_retry: 1 } })
    ).toBe('ignored');
  });

  it('ignores a skipped card — no transcript is terminal', () => {
    expect(bucket({ quality_flag: 'skipped' })).toBe('ignored');
  });

  // The whole measured mandala, in one assertion: of the four cards holding the
  // banner up, none should have been.
  it('the four cards that held the banner up are all out of the count', () => {
    const measured = [
      { quality_flag: 'pass', segments: null },
      { quality_flag: 'pass', segments: null },
      { quality_flag: 'enrichment_low', segments: null },
      null,
    ];
    expect(measured.map((r) => bucket(r))).toEqual([
      'ignored',
      'ignored',
      'retried-quietly',
      'ignored',
    ]);
  });
});
