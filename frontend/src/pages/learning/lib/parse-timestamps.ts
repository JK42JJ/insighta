/**
 * parse-timestamps — CP477+10.
 *
 * Splits a chatbot message body into alternating plain-text and timestamp
 * segments so the "메모에 추가" path can preserve the click-to-seek
 * affordance inside the TipTap note editor.
 *
 * Recognised forms (mirrors ChatAssistant `TIMESTAMP_RE`):
 *   - M:SS          (e.g. `5:10`)
 *   - H:MM:SS       (e.g. `1:05:30`)
 *   - N초           (e.g. `380초`)        — Korean raw-seconds form
 *   - N~M초         (e.g. `380~682초`)    — Korean raw-seconds range
 *
 * The parser is intentionally permissive about whitespace and brackets:
 *   "이 부분은 (5:10-6:20) 에서 확인" → text + 5:10 + text + 6:20 + text
 *
 * Pure function — no React, no DOM. Safe to call from any layer.
 */

const TIMESTAMP_RE = /(\d{1,2}:\d{2}(?::\d{2})?|\d+\s*~\s*\d+\s*초|\d+\s*초)/g;

export interface PlainSegment {
  type: 'text';
  value: string;
}

export interface TimestampSegment {
  type: 'timestamp';
  /** Display label as it appeared in the source text (e.g. "5:10"). */
  label: string;
  /** Seconds offset for the player seek (range form returns the start). */
  seconds: number;
}

export type Segment = PlainSegment | TimestampSegment;

/**
 * Convert a label like "5:10" or "380초" or "380~682초" into a second offset.
 * Range forms return the START value to match the existing seek UX in
 * `ChatAssistant.parseTimestamp`.
 */
export function timestampToSeconds(label: string): number {
  if (/초/.test(label)) {
    const m = /^(\d+)/.exec(label);
    return m ? Number(m[1]) : 0;
  }
  const parts = label.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

/**
 * Split `text` into `Segment[]`. Plain runs are returned as `PlainSegment`,
 * timestamps as `TimestampSegment`. Empty plain runs are dropped so the
 * caller can map directly into Tiptap content nodes without empty `text`
 * nodes (which Tiptap rejects).
 */
export function parseTimestamps(text: string): Segment[] {
  const segments: Segment[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  TIMESTAMP_RE.lastIndex = 0;
  while ((match = TIMESTAMP_RE.exec(text)) !== null) {
    if (match.index > lastIdx) {
      segments.push({ type: 'text', value: text.slice(lastIdx, match.index) });
    }
    const label = match[1];
    segments.push({
      type: 'timestamp',
      label,
      seconds: timestampToSeconds(label),
    });
    lastIdx = TIMESTAMP_RE.lastIndex;
  }
  if (lastIdx < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIdx) });
  }
  // Drop empty plain segments (Tiptap rejects `{type:'text', text:''}`).
  return segments.filter((s) => s.type === 'timestamp' || s.value.length > 0);
}
