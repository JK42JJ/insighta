/**
 * CP477+2 — Timestamp regex + parser tests for the chatbot linkifier.
 *
 * The LoRA mixes two output styles:
 *   - canonical M:SS or HH:MM:SS (e.g., `0:56`, `1:23:45`, `(0:56-1:12)`)
 *   - raw-seconds variants the SFT didn't fully drill out (`380초`,
 *     `380~682초`)
 *
 * Both must be detected so `linkifyTimestamps` can wrap them in a
 * clickable button, and `parseTimestamp` must return the same seek
 * second for the range-start of either form.
 *
 * The middleware now appends an explicit `[타임스탬프 형식]` directive
 * (CP477+2 server side) but the model still drifts on long answers,
 * so this regex is the FE backstop that catches everything the model
 * still emits.
 */
import { describe, expect, it } from 'vitest';
import { TIMESTAMP_RE, parseTimestamp } from '@/pages/learning/ui/ChatAssistant';

function findAll(re: RegExp, text: string): string[] {
  const out: string[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

describe('TIMESTAMP_RE — matches both canonical and raw-seconds forms', () => {
  it('catches M:SS in chatbot prose', () => {
    expect(findAll(TIMESTAMP_RE, 'see 0:56 for context')).toEqual(['0:56']);
  });

  it('catches M:SS-M:SS range as two separate matches', () => {
    expect(findAll(TIMESTAMP_RE, 'covered in (0:56-1:12)')).toEqual(['0:56', '1:12']);
  });

  it('catches HH:MM:SS', () => {
    expect(findAll(TIMESTAMP_RE, 'goes 1:23:45 deep')).toEqual(['1:23:45']);
  });

  it('catches raw `N초` form', () => {
    // CP477+2 primary regression case — bug-report 2026-05-20 showed
    // `380초:` rendered as plain text, no seek button.
    expect(findAll(TIMESTAMP_RE, '380초: 한 문제당 30분')).toEqual(['380초']);
  });

  it('catches `N~M초` range form', () => {
    expect(findAll(TIMESTAMP_RE, '380~682초: 수2 고난도')).toEqual(['380~682초']);
  });

  it('catches `N ~ M 초` with spaces', () => {
    expect(findAll(TIMESTAMP_RE, '380 ~ 682 초 까지')).toEqual(['380 ~ 682 초']);
  });

  it('mixed forms in one passage all match', () => {
    // The bug report screenshot shows answers that mix forms within one
    // response. Every form must surface as a clickable button.
    const text = '핵심은 (0:56-1:12). 380~682초: 추가 분석. 마지막으로 6:20.';
    expect(findAll(TIMESTAMP_RE, text)).toEqual(['0:56', '1:12', '380~682초', '6:20']);
  });
});

describe('parseTimestamp — converts every form to a seek-second integer', () => {
  it('M:SS → minutes×60 + seconds', () => {
    expect(parseTimestamp('0:56')).toBe(56);
    expect(parseTimestamp('1:12')).toBe(72);
  });

  it('HH:MM:SS → hours×3600 + minutes×60 + seconds', () => {
    expect(parseTimestamp('1:23:45')).toBe(3600 + 23 * 60 + 45);
  });

  it('`N초` returns N directly', () => {
    expect(parseTimestamp('380초')).toBe(380);
  });

  it('`N~M초` returns range START (matches M:SS-M:SS UX where button seeks first value)', () => {
    expect(parseTimestamp('380~682초')).toBe(380);
  });

  it('`N ~ M 초` with whitespace also returns START', () => {
    expect(parseTimestamp('380 ~ 682 초')).toBe(380);
  });
});
