import { describe, expect, it } from 'vitest';
import { BRIEF_STORY_CHIP_MAX, buildBriefSuggestions } from './suggestions';

const story = (title: string, navLabel?: string) => ({
  kicker: 'k',
  title,
  navLabel,
  blocks: [{ type: 'p' as const, html: 'a' }],
});

describe('buildBriefSuggestions', () => {
  it('opens with the summary, one chip per story, and closes with the sources', () => {
    const chips = buildBriefSuggestions({
      stories: [story('환불 요청이 타임아웃되면 재시도합니다', '환불 타임아웃과 이중 환불')],
    });
    expect(chips.map((c) => c.title)).toEqual([
      '이번 호를 세 문장으로',
      "'환불 타임아웃과 이중 환불' 근거는?",
      '출처 목록',
    ]);
    // The message names the story by its full title, which is how the
    // server-side text names it.
    expect(chips[1].message).toContain('환불 요청이 타임아웃되면 재시도합니다');
  });

  it('falls back to the lead clause when a story has no label', () => {
    const chips = buildBriefSuggestions({ stories: [story('설정 파일 이야기: 열기만 해도 실행')] });
    expect(chips[1].title).toBe("'설정 파일 이야기' 근거는?");
  });

  it('caps the story chips', () => {
    const many = Array.from({ length: BRIEF_STORY_CHIP_MAX + 3 }, (_, i) =>
      story(`s${i}`, `라벨${i}`)
    );
    const chips = buildBriefSuggestions({ stories: many });
    expect(chips).toHaveLength(BRIEF_STORY_CHIP_MAX + 2);
  });
});
