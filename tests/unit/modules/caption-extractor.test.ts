/**
 * Caption Extractor — Unit Tests
 *
 * Tests for CaptionExtractor singleton pattern.
 * Caption extraction uses youtube-transcript (public caption API) exclusively.
 */

import { getCaptionExtractor, CaptionExtractor } from '../../../src/modules/caption/extractor';

// ============================================================================
// getCaptionExtractor — Singleton pattern
// ============================================================================

describe('getCaptionExtractor', () => {
  it('returns a CaptionExtractor instance', () => {
    const extractor = getCaptionExtractor();
    expect(extractor).toBeInstanceOf(CaptionExtractor);
  });

  it('returns the same instance on subsequent calls (singleton)', () => {
    const a = getCaptionExtractor();
    const b = getCaptionExtractor();
    expect(a).toBe(b);
  });
});
