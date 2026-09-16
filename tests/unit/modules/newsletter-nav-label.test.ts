/**
 * Sidebar contents label on a story.
 *
 * The label is editor-written because titles are declarative sentences with
 * no separator to cut at. The schema keeps it optional so drafts save; the
 * publish gate requires it so a published issue never shows an ellipsis in
 * the contents.
 */

import { NAV_LABEL_MAX, StorySchema } from '../../../src/modules/newsletter/issue-schema';
import { missingNavLabel } from '../../../src/modules/newsletter/publish-gate';

const story = (over: Record<string, unknown> = {}) => ({
  kicker: '신뢰 경계',
  title: 'Claude Code는 저장소 설정 파일에 든 명령을 사용자 확인 없이 실행했습니다',
  blocks: [{ type: 'p', html: 'a' }],
  ...over,
});

describe('StorySchema.navLabel', () => {
  it('is optional, so a draft without one still parses', () => {
    expect(StorySchema.safeParse(story()).success).toBe(true);
  });

  it('accepts a label up to the sidebar width and rejects a longer one', () => {
    expect(StorySchema.safeParse(story({ navLabel: '가'.repeat(NAV_LABEL_MAX) })).success).toBe(
      true
    );
    expect(StorySchema.safeParse(story({ navLabel: '가'.repeat(NAV_LABEL_MAX + 1) })).success).toBe(
      false
    );
    expect(StorySchema.safeParse(story({ navLabel: '가' })).success).toBe(false);
  });
});

describe('missingNavLabel', () => {
  it('passes when every story carries a label', () => {
    expect(
      missingNavLabel({
        stories: [
          story({ navLabel: '저장소 설정 파일의 숨은 명령' }),
          story({ navLabel: '환불 타임아웃' }),
        ],
      } as never)
    ).toBeNull();
  });

  it('names the first story without one', () => {
    const blocker = missingNavLabel({
      stories: [story({ navLabel: '저장소 설정 파일의 숨은 명령' }), story({ kicker: '운영' })],
    } as never);
    expect(blocker).toContain('story 2');
    expect(blocker).toContain('운영');
  });
});
