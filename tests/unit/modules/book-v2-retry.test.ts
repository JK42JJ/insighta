/**
 * §1④ retry-cap counter — translations._book_v2_retry. Dedicated jsonb counter
 * (generator/cron never write translations) so v2-pending spinner can't stick on
 * quality_flag='low' cards, while still giving transient failures CAP attempts
 * (#968 blanket-exclude was held: it dropped transient cards permanently).
 */
import {
  readBookV2Retry,
  bookV2RetryCapped,
  BOOK_V2_RETRY_CAP,
} from '../../../src/modules/mandala-book/book-v2-retry';

describe('book-v2-retry counter', () => {
  it('reads the counter', () => expect(readBookV2Retry({ _book_v2_retry: 2 })).toBe(2));
  it('missing key → 0', () => expect(readBookV2Retry({ ko: {} })).toBe(0));
  it('null / non-object → 0', () => {
    expect(readBookV2Retry(null)).toBe(0);
    expect(readBookV2Retry('x')).toBe(0);
  });
  it('non-finite → 0', () => expect(readBookV2Retry({ _book_v2_retry: NaN })).toBe(0));
  it('capped at CAP', () => {
    expect(bookV2RetryCapped({ _book_v2_retry: BOOK_V2_RETRY_CAP })).toBe(true);
    expect(bookV2RetryCapped({ _book_v2_retry: BOOK_V2_RETRY_CAP - 1 })).toBe(false);
    expect(bookV2RetryCapped(null)).toBe(false);
  });
});
