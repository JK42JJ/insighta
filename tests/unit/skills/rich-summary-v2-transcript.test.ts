/**
 * Rich Summary v2 — transcript injection (CP437).
 *
 * Locks the prompt builder's behavior when a transcript is supplied.
 * Generator-level integration (DB + LLM) is covered by smoke tests; here
 * we just ensure the prompt template path is wired correctly.
 */

import { buildV2Prompt, TRANSCRIPT_MAX_CHARS } from '@/modules/skills/rich-summary-v2-prompt';

describe('buildV2Prompt — transcript injection', () => {
  const base = {
    title: '시간관리 강의',
    description: '핵심 요약',
    channel: 'TestChannel',
    language: 'ko' as const,
  };

  test('omitting transcript results in (no transcript) placeholder', () => {
    const out = buildV2Prompt(base);
    expect(out).toContain('Transcript');
    expect(out).toContain('(no transcript)');
  });

  test('supplied transcript appears verbatim under TRANSCRIPT_MAX_CHARS', () => {
    const transcript = '이 영상은 시간관리의 3단계를 다룬다. 계획 / 실행 / 회고.';
    const out = buildV2Prompt({ ...base, transcript });
    expect(out).toContain(transcript);
    expect(out).not.toContain('(no transcript)');
  });

  test('long transcript is truncated to TRANSCRIPT_MAX_CHARS', () => {
    const transcript = '가'.repeat(TRANSCRIPT_MAX_CHARS + 500);
    const out = buildV2Prompt({ ...base, transcript });
    // Verify the full overflow segment is NOT present.
    expect(out.includes('가'.repeat(TRANSCRIPT_MAX_CHARS))).toBe(true);
    expect(out.includes('가'.repeat(TRANSCRIPT_MAX_CHARS + 1))).toBe(false);
  });

  test('empty-string transcript falls back to (no transcript)', () => {
    const out = buildV2Prompt({ ...base, transcript: '' });
    expect(out).toContain('(no transcript)');
  });
});
