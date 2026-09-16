/**
 * The note surface's half of the video-citation rule.
 *
 * The server template carries the same function and the same fixtures
 * (tests/unit/modules/newsletter/video-citations.test.ts). A reader sees this
 * one: the brief page renders through the note converter, not through the
 * server template. If the two drift, one of these two files fails.
 *
 * The strings are taken from the published first issue.
 */
import { describe, it, expect } from 'vitest';
import { linkVideoCitations } from './issue-to-note';

const WITH_TAG = '명령이 실행됐습니다 (1IbrFrdll4U) [영상]. 1차 자료도 있습니다.';
const BARE = '(psNfWOOtBGM)과 함께 보시길 권합니다.';

describe('linkVideoCitations (note surface)', () => {
  it('moves the link onto the grade tag and drops the id', () => {
    const out = linkVideoCitations(WITH_TAG);
    expect(out).not.toContain('(1IbrFrdll4U');
    expect(out).toContain('href="https://www.youtube.com/watch?v=1IbrFrdll4U"');
    expect(out).toContain('>[영상]</a>');
  });

  it('gives a bare citation a tag of its own so the sentence still reads', () => {
    const out = linkVideoCitations(BARE);
    expect(out).not.toContain('(psNfWOOtBGM)');
    expect(out).toMatch(/>\[영상\]<\/a>과 함께 보시길 권합니다\./);
  });

  it('keeps a 확인 tag as 확인', () => {
    const out = linkVideoCitations('사실입니다 (Dsx4_kCBkbQ) [확인].');
    expect(out).toContain('>[확인]</a>');
    expect(out).not.toContain('[영상]');
  });

  it('leaves an ordinary eleven-letter word alone', () => {
    const plain = '(helicopters) 라고 적혀 있습니다.';
    expect(linkVideoCitations(plain)).toBe(plain);
  });

  it('produces an anchor the converter turns into a link mark', async () => {
    // The whole point of emitting HTML here rather than a node: inlineToNodes
    // already knows what to do with an anchor, and a reader gets a real link.
    const { issueToNoteDoc } = await import('./issue-to-note');
    const doc = issueToNoteDoc({
      category: 'AI 엔지니어링',
      issueLabel: '제1호',
      dateLabel: '2026년 9월 2일',
      headline: ['제목'],
      dek: '덱',
      stories: [
        { kicker: '신뢰 경계', title: '스토리 제목', blocks: [{ type: 'p', html: WITH_TAG }] },
      ],
      insight: { blocks: [], actions: [] },
      picks: [],
      vocabulary: [],
      interest: { intro: '소개', ledger: [], ledgerCaption: '' },
      gradeNote: '등급 설명',
      editNote: '편집 설명',
      refs: [],
    } as never);

    const json = JSON.stringify(doc);
    expect(json).toContain('youtube.com/watch?v=1IbrFrdll4U');
    expect(json).not.toContain('(1IbrFrdll4U');
  });
});
