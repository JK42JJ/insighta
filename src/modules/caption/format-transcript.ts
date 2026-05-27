/**
 * Annotated transcript formatter (CP488+ Phase 1.5, 2026-05-27).
 *
 * Converts `CaptionSegment[]` (which carries `start` seconds per row) into
 * a line-delimited string with `[mm:ss]` (or `[hh:mm:ss]` past one hour)
 * timestamps preserved per segment. This is what `generateRichSummaryV2`
 * sends to Sonnet 4.6 in place of the legacy `fullText` join — without
 * timestamps in the input, the LLM has to guess timeline coverage and
 * produces the hallucination pattern Phase 3 dogfooded:
 *   sections.last.to_sec ≈ 50% of duration
 *   atoms bunched in the first quarter
 *
 * Format: one segment per line, `[mm:ss] text` prefix (or `[hh:mm:ss]`
 * if the start time exceeds 3600 s). Empty input ⇒ empty string (caller
 * falls back to `(no transcript)`).
 *
 * Cost: ~10-20% longer than `fullText` due to the timestamp prefix per
 * line — well within `RICH_SUMMARY_V2_TRANSCRIPT_MAX_CHARS` (default
 * 100,000 covers a 90-min Korean lecture even with annotation overhead).
 */

import type { CaptionSegment } from './types';

function formatStamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (hh > 0) {
    return `[${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}]`;
  }
  return `[${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}]`;
}

export function formatAnnotatedTranscript(
  segments: ReadonlyArray<CaptionSegment> | undefined | null
): string {
  if (!segments || segments.length === 0) return '';
  const lines: string[] = [];
  for (const seg of segments) {
    if (!seg || typeof seg.text !== 'string') continue;
    const text = seg.text.replace(/\s*\n+\s*/g, ' ').trim();
    if (text.length === 0) continue;
    lines.push(`${formatStamp(seg.start ?? 0)} ${text}`);
  }
  return lines.join('\n');
}
