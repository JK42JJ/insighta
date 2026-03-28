/**
 * Caption Extractor — Unit Tests
 *
 * Tests for parseJson3 (JSON3 subtitle format parser) and singleton pattern.
 */

import {
  parseJson3,
  getCaptionExtractor,
  CaptionExtractor,
} from '../../../src/modules/caption/extractor';

// ============================================================================
// parseJson3 — Pure function tests
// ============================================================================

describe('parseJson3', () => {
  it('parses valid JSON3 with events and segments', () => {
    const input = JSON.stringify({
      events: [
        { tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: 'Hello' }] },
        { tStartMs: 3000, dDurationMs: 1500, segs: [{ utf8: 'World' }] },
      ],
    });

    const result = parseJson3(input);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ text: 'Hello', start: 1, duration: 2 });
    expect(result[1]).toEqual({ text: 'World', start: 3, duration: 1.5 });
  });

  it('concatenates multiple segs within a single event', () => {
    const input = JSON.stringify({
      events: [
        {
          tStartMs: 500,
          dDurationMs: 1000,
          segs: [{ utf8: 'Part ' }, { utf8: 'one' }],
        },
      ],
    });

    const result = parseJson3(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe('Part one');
  });

  it('skips events without segs property', () => {
    const input = JSON.stringify({
      events: [
        { tStartMs: 0, dDurationMs: 1000 },
        { tStartMs: 1000, dDurationMs: 500, segs: [{ utf8: 'Valid' }] },
      ],
    });

    const result = parseJson3(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe('Valid');
  });

  it('skips events with empty text after trimming', () => {
    const input = JSON.stringify({
      events: [
        { tStartMs: 0, dDurationMs: 500, segs: [{ utf8: '   ' }] },
        { tStartMs: 500, dDurationMs: 500, segs: [{ utf8: '' }] },
        { tStartMs: 1000, dDurationMs: 500, segs: [{ utf8: 'Real text' }] },
      ],
    });

    const result = parseJson3(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe('Real text');
  });

  it('returns empty array when no events property', () => {
    const input = JSON.stringify({});
    expect(parseJson3(input)).toEqual([]);
  });

  it('returns empty array for empty events array', () => {
    const input = JSON.stringify({ events: [] });
    expect(parseJson3(input)).toEqual([]);
  });

  it('handles missing tStartMs and dDurationMs (defaults to 0)', () => {
    const input = JSON.stringify({
      events: [{ segs: [{ utf8: 'No timing' }] }],
    });

    const result = parseJson3(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ text: 'No timing', start: 0, duration: 0 });
  });

  it('handles missing utf8 in seg (defaults to empty string)', () => {
    const input = JSON.stringify({
      events: [{ tStartMs: 0, dDurationMs: 500, segs: [{ utf8: 'A' }, {}, { utf8: 'B' }] }],
    });

    const result = parseJson3(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe('AB');
  });

  it('converts milliseconds to seconds correctly', () => {
    const input = JSON.stringify({
      events: [{ tStartMs: 61500, dDurationMs: 3750, segs: [{ utf8: 'text' }] }],
    });

    const result = parseJson3(input);
    expect(result[0]!.start).toBe(61.5);
    expect(result[0]!.duration).toBe(3.75);
  });

  it('throws on invalid JSON input', () => {
    expect(() => parseJson3('not valid json')).toThrow();
  });

  it('handles large event arrays efficiently', () => {
    const events = Array.from({ length: 1000 }, (_, i) => ({
      tStartMs: i * 1000,
      dDurationMs: 1000,
      segs: [{ utf8: `Segment ${i}` }],
    }));
    const input = JSON.stringify({ events });

    const result = parseJson3(input);
    expect(result).toHaveLength(1000);
    expect(result[999]!.start).toBe(999);
  });

  it('trims whitespace from concatenated segments', () => {
    const input = JSON.stringify({
      events: [{ tStartMs: 0, dDurationMs: 500, segs: [{ utf8: '  Hello  ' }] }],
    });

    const result = parseJson3(input);
    expect(result[0]!.text).toBe('Hello');
  });
});

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
