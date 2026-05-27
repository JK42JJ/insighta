/**
 * Unit tests for the annotated transcript formatter (CP488+ Phase 1.5).
 *
 * The formatter is the load-bearing change of Phase 1.5 — switching from
 * the legacy `fullText = segments.map(s => s.text).join(' ')` (which
 * strips timestamps) to a `[mm:ss] text\n…` form that gives the LLM
 * actual timeline ground-truth. Regressions here mean Sonnet 4.6 goes
 * back to hallucinating coverage.
 */

import { formatAnnotatedTranscript } from '@/modules/caption/format-transcript';

describe('formatAnnotatedTranscript', () => {
  it('returns empty string for empty input', () => {
    expect(formatAnnotatedTranscript([])).toBe('');
    expect(formatAnnotatedTranscript(null)).toBe('');
    expect(formatAnnotatedTranscript(undefined)).toBe('');
  });

  it('prefixes each segment with [mm:ss]', () => {
    const out = formatAnnotatedTranscript([
      { start: 0, duration: 5, text: '안녕하세요' },
      { start: 12, duration: 3, text: '오늘 주제는' },
      { start: 65, duration: 4, text: '시간 관리입니다' },
    ]);
    expect(out).toBe('[00:00] 안녕하세요\n[00:12] 오늘 주제는\n[01:05] 시간 관리입니다');
  });

  it('switches to [hh:mm:ss] past one hour', () => {
    const out = formatAnnotatedTranscript([
      { start: 3599, duration: 2, text: 'last minute' },
      { start: 3600, duration: 2, text: 'first hour' },
      { start: 5430, duration: 2, text: 'mid 90 min' },
    ]);
    const lines = out.split('\n');
    expect(lines[0]).toBe('[59:59] last minute');
    expect(lines[1]).toBe('[01:00:00] first hour');
    expect(lines[2]).toBe('[01:30:30] mid 90 min');
  });

  it('collapses internal newlines and trims segment text', () => {
    const out = formatAnnotatedTranscript([
      { start: 5, duration: 3, text: '  line one\n  line two  ' },
    ]);
    expect(out).toBe('[00:05] line one line two');
  });

  it('skips empty / whitespace-only segments', () => {
    const out = formatAnnotatedTranscript([
      { start: 0, duration: 1, text: '' },
      { start: 1, duration: 1, text: '   ' },
      { start: 2, duration: 1, text: 'kept' },
    ]);
    expect(out).toBe('[00:02] kept');
  });

  it('handles missing start by defaulting to 0', () => {
    const out = formatAnnotatedTranscript([
      { start: undefined as unknown as number, duration: 0, text: 'fallback' },
    ]);
    expect(out).toBe('[00:00] fallback');
  });
});
