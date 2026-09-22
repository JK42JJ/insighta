/**
 * A caption source that cannot reach the proxies has to say so, not claim the
 * video had no captions.
 *
 * Both look the same to the stage — null — so the distinction lives in what is
 * logged and in what the caller does next. What must never happen is a proxy
 * outage being recorded as "these videos have no transcripts", which would let
 * an issue grade claims off metadata while reporting full coverage.
 *
 * The previous version of this suite passed against a fetch stub while the
 * module called `GET /captions/:videoId` with an `x-internal-token` header —
 * neither of which the transcript service has. The stub answered whatever the
 * test wanted, so the contract was never the thing under test. It is now: the
 * source delegates to CaptionExtractor, which is the only code that holds the
 * real contract, and these tests describe the handover rather than a URL.
 */

const warn = jest.fn();
jest.mock('@/utils/logger', () => ({
  logger: { child: () => ({ info: jest.fn(), warn, error: jest.fn() }) },
}));

import { proxyCaptions, noCaptions } from '@/modules/newsletter/pipeline/caption-source';
import type { CaptionExtractor } from '@/modules/caption/extractor';

/** Just the one method this module uses. */
const extractorThat = (impl: CaptionExtractor['extractCaptions']): CaptionExtractor =>
  ({ extractCaptions: impl }) as unknown as CaptionExtractor;

const caption = (fullText: string) => ({
  success: true as const,
  videoId: 'abc',
  language: 'ko',
  caption: { videoId: 'abc', language: 'ko', fullText, segments: [] },
});

beforeEach(() => warn.mockClear());

describe('proxyCaptions', () => {
  it('returns the caption text', async () => {
    const extractor = extractorThat(async () => caption('caption text'));
    expect(await proxyCaptions(extractor).get('abc')).toBe('caption text');
    expect(warn).not.toHaveBeenCalled();
  });

  it('asks the extractor for the id it was given', async () => {
    const seen: string[] = [];
    const extractor = extractorThat(async (id) => {
      seen.push(id);
      return caption('t');
    });
    await proxyCaptions(extractor).get('dQw4w9WgXcQ');
    expect(seen).toEqual(['dQw4w9WgXcQ']);
  });

  it('records why there is no caption, so an outage is not read as an absence', async () => {
    // The extractor already separates the two and puts the answer in `error`.
    // Losing it here is what turns a dead Mac Mini into "no video this week
    // had captions", which is a sentence an issue would then be graded on.
    const extractor = extractorThat(async () => ({
      success: false as const,
      videoId: 'a',
      language: 'ko',
      error: 'transcript proxies unreachable',
    }));
    expect(await proxyCaptions(extractor).get('a')).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      'no captions',
      expect.objectContaining({ reason: 'transcript proxies unreachable' })
    );
  });

  it('treats an empty caption as no caption', async () => {
    const extractor = extractorThat(async () => caption('   '));
    expect(await proxyCaptions(extractor).get('a')).toBeNull();
  });

  it('does not throw when the extractor does', async () => {
    // One video must not end the stage: a brief with eleven sources instead of
    // twelve is a smaller brief, not a broken one.
    const extractor = extractorThat(async () => {
      throw new Error('boom');
    });
    expect(await proxyCaptions(extractor).get('a')).toBeNull();
    expect(warn).toHaveBeenCalledWith('caption fetch threw', expect.objectContaining({}));
  });
});

describe('noCaptions', () => {
  it('returns null for everything', async () => {
    expect(await noCaptions.get('anything')).toBeNull();
  });
});
