/**
 * The bare video ids in a brief's prose.
 *
 * Issue 1's writing brief told the author to put the id in the sentence and
 * promised "링크는 저희가 만듭니다". The step that makes the link was never built,
 * so the published issue carries 23 raw ids a reader cannot use. The strings
 * below are taken from that issue rather than composed.
 *
 * The same rule exists in the note surface's converter; its test uses these
 * same fixtures, so the two renderers cannot drift apart silently.
 */

import { linkVideoCitations, render } from '@/modules/newsletter/templates/web-v1';
import type { IssueDocument } from '@/modules/newsletter/issue-schema';

/** 22 of the 23 citations in issue 1 look like this. */
const WITH_TAG = '명령이 실행됐습니다 (1IbrFrdll4U) [영상]. 1차 자료도 있습니다.';
/** The 23rd stands alone inside a sentence. */
const BARE = '(psNfWOOtBGM)과 함께 보시길 권합니다.';

describe('linkVideoCitations', () => {
  it('moves the link onto the grade tag and drops the id', () => {
    const out = linkVideoCitations(WITH_TAG);
    expect(out).not.toContain('1IbrFrdll4U)');
    expect(out).not.toContain('(1IbrFrdll4U');
    expect(out).toContain('href="https://www.youtube.com/watch?v=1IbrFrdll4U"');
    expect(out).toContain('>[영상]</a>');
    expect(out).toContain('명령이 실행됐습니다');
    expect(out).toContain('1차 자료도 있습니다.');
  });

  it('gives a bare citation a tag of its own so the sentence still reads', () => {
    const out = linkVideoCitations(BARE);
    expect(out).not.toContain('(psNfWOOtBGM)');
    expect(out).toContain('href="https://www.youtube.com/watch?v=psNfWOOtBGM"');
    expect(out).toMatch(/>\[영상\]<\/a>과 함께 보시길 권합니다\./);
  });

  it('links a 확인 tag to the same video rather than relabelling it', () => {
    // The grade is the author's judgement about the source. Turning 확인 into
    // 영상 because it happens to sit beside a video id would overwrite it.
    const out = linkVideoCitations('사실입니다 (Dsx4_kCBkbQ) [확인].');
    expect(out).toContain('>[확인]</a>');
    expect(out).not.toContain('[영상]');
  });

  it('leaves an ordinary eleven-letter word alone', () => {
    // Real ids are effectively random base64url. A lowercase word is not one,
    // and linking it would produce a dead link inside a sentence.
    const out = linkVideoCitations('(helicopters) 라고 적혀 있습니다.');
    expect(out).toBe('(helicopters) 라고 적혀 있습니다.');
    expect(out).not.toContain('<a');
  });

  it('leaves text with no citation untouched', () => {
    const plain = 'CVSS 8.7, 1.0.111에서 수정됐습니다.';
    expect(linkVideoCitations(plain)).toBe(plain);
  });

  it('opens the link away from the brief', () => {
    const out = linkVideoCitations(WITH_TAG);
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('is wired into the rendered page, not merely exported', () => {
    // The tests above call the function directly, which proves it works and
    // proves nothing about whether the renderer uses it. Removing the call
    // from richText left every one of them green.
    const doc = {
      schemaVersion: 1,
      templateVersion: 'web-v1',
      locale: 'ko',
      slug: 's',
      category: 'AI 엔지니어링',
      categoryKey: 'ai-tech',
      issueLabel: '제1호',
      dateLabel: '2026년 9월 2일',
      headline: ['제목'],
      dek: '덱',
      runline: '런라인',
      preview: '프리뷰',
      interest: { intro: '소개', ledger: [], ledgerCaption: '', stages: [] },
      stories: [{ kicker: '신뢰 경계', title: '스토리', blocks: [{ type: 'p', html: WITH_TAG }] }],
      insight: { blocks: [], actions: [] },
      picks: [],
      vocabulary: [],
      next: { intro: '다음 호', checkpoints: [{ when: '9월', title: '항목' }] },
      refs: [],
      gradeNote: '등급',
      editNote: '편집',
    } as unknown as IssueDocument;

    const html = render(doc);
    expect(html).toContain('href="https://www.youtube.com/watch?v=1IbrFrdll4U"');
    expect(html).not.toContain('(1IbrFrdll4U)');
  });
});
