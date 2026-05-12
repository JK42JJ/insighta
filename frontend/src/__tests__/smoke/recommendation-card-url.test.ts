/**
 * Unit tests for buildVideoUrl in recommendationToInsightCard.
 *
 * PR3 (hybrid-retrieval spec 2026-05-12) — chunk anchor deep-link.
 * Verifies URL takes the YouTube `&t=<sec>s` form when startSec is present
 * and a positive integer, and falls back to the plain watch URL otherwise.
 */

import { describe, expect, it } from 'vitest';
import { buildVideoUrl } from '../../features/recommendation-feed/lib/recommendationToInsightCard';

describe('buildVideoUrl — chunk anchor deep-link', () => {
  const BASE = 'https://www.youtube.com/watch?v=';

  describe('no anchor → plain URL', () => {
    it('null startSec', () => {
      expect(buildVideoUrl('abc123', null)).toBe(`${BASE}abc123`);
    });

    it('undefined startSec', () => {
      expect(buildVideoUrl('abc123', undefined)).toBe(`${BASE}abc123`);
    });

    it('zero startSec (video starts at beginning, no need for anchor)', () => {
      expect(buildVideoUrl('abc123', 0)).toBe(`${BASE}abc123`);
    });

    it('negative startSec (defensive — should not happen but treated as no anchor)', () => {
      expect(buildVideoUrl('abc123', -5)).toBe(`${BASE}abc123`);
    });

    it('NaN startSec', () => {
      expect(buildVideoUrl('abc123', NaN)).toBe(`${BASE}abc123`);
    });

    it('Infinity startSec', () => {
      expect(buildVideoUrl('abc123', Infinity)).toBe(`${BASE}abc123`);
    });
  });

  describe('positive anchor → URL with &t=', () => {
    it('integer seconds', () => {
      expect(buildVideoUrl('abc123', 45)).toBe(`${BASE}abc123&t=45s`);
    });

    it('fractional seconds → floor to integer (YouTube only accepts integer seconds)', () => {
      expect(buildVideoUrl('abc123', 45.7)).toBe(`${BASE}abc123&t=45s`);
    });

    it('1 second', () => {
      expect(buildVideoUrl('abc123', 1)).toBe(`${BASE}abc123&t=1s`);
    });

    it('large value (over 1 hour)', () => {
      expect(buildVideoUrl('abc123', 3725)).toBe(`${BASE}abc123&t=3725s`);
    });
  });
});
