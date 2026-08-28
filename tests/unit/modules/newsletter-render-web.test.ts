/**
 * web render -- contract and safety.
 *
 * The page's entire proposition is that its figures are checked, so the tests
 * that matter here are the ones that would let a figure change or vanish
 * between the document and the page.
 */

import {
  IssueDocumentSchema,
  findUngroundedClaims,
} from '../../../src/modules/newsletter/issue-schema';
import {
  renderWeb,
  renderCacheKey,
  DEFAULT_TEMPLATE,
} from '../../../src/modules/newsletter/render-web';

const base = {
  schemaVersion: 1 as const,
  templateVersion: 'web-v1',
  slug: '2026-08-25-ai-tech',
  category: 'AI & Technology',
  categoryKey: 'ai-tech',
  issueLabel: '제1호',
  dateLabel: '2026.08.25',
  publishedAt: '2026-08-25T00:00:00.000Z',
  headline: ['딥시크 API 요금이', '4.5배 올랐습니다'],
  dek: '8월 16일부터 <strong>3.96달러</strong>로 올랐습니다.',
  runline: '읽는 데 11분',
  preview: '이번 주 2,714편에서 고른 다섯 가지.',
  interest: {
    intro: '네 소식은 한 흐름에서 나왔습니다.',
    ledgerCaption: '장부 1',
    ledger: [
      {
        name: '에이전트가 소비한 토큰',
        grade: 'verified' as const,
        ref: 1,
        desc: '자동 실행분만 센 주간 소비량.',
        value: '7.3조',
        emphasis: 'up' as const,
        sub: '2월 0.51조에서 약 14배',
      },
    ],
    funnel: {
      figref: '그림 1',
      perCell: 20,
      buckets: [
        { key: 'form' as const, count: 1672, label: '4분 미만' },
        { key: 'cross' as const, count: 336, label: '세 곳 이상 교차 확인' },
      ],
      caption: '칸 하나가 영상 20편.',
    },
  },
  stories: [
    {
      kicker: '코딩 에이전트',
      title: '딥시크가 내부를 공개했습니다',
      blocks: [{ type: 'lede' as const, html: '8월 13일 공개됐습니다.' }],
    },
  ],
  insight: {
    blocks: [{ type: 'p' as const, html: '돈이 옮겨가고 있습니다.' }],
    actions: [{ when: '이번 주', title: '청구액을 비교' }],
  },
  vocabulary: [
    { word: '하네스', en: 'harness', body: '실행 환경 전체.', use: '하네스 구성 차이입니다.' },
  ],
  picks: [
    { title: 'Why Agents Fail', latin: true, meta: '8/21 · 38분', body: '설계부터 보게 만듭니다.' },
  ],
  next: {
    intro: '다음 호에서 답을 적습니다.',
    checkpoints: [{ when: '8/27', title: '옥스 알파 결과' }],
  },
  refs: [{ label: '에이전트 토큰 14배', sources: [{ name: 'THE DECODER' }] }],
  gradeNote: '<b>등급 표기</b> — 확인은 1차 출처로 검증 가능한 사실.',
  editNote: '<b>편집 원칙.</b> 세 곳 이상에서 확인된 것만 씁니다.',
  sign: '유튜브를 나만의 지식노트로.',
};

const doc = IssueDocumentSchema.parse(base);

describe('IssueDocument', () => {
  it('accepts the launch issue shape', () => {
    expect(doc.slug).toBe('2026-08-25-ai-tech');
    expect(doc.templateVersion).toBe('web-v1');
  });

  it('rejects a slug that is not url-safe', () => {
    expect(() => IssueDocumentSchema.parse({ ...base, slug: 'AI 기술!' })).toThrow();
  });

  it('flags a graded claim with no source', () => {
    const ungrounded = IssueDocumentSchema.parse({
      ...base,
      interest: { ...base.interest, ledger: [{ ...base.interest.ledger[0], ref: undefined }] },
    });
    expect(findUngroundedClaims(ungrounded)).toHaveLength(1);
    expect(findUngroundedClaims(doc)).toHaveLength(0);
  });

  it('flags a claim citing a ref that does not exist', () => {
    const dangling = IssueDocumentSchema.parse({
      ...base,
      interest: { ...base.interest, ledger: [{ ...base.interest.ledger[0], ref: 9 }] },
    });
    expect(findUngroundedClaims(dangling)[0]).toContain('only 1 exist');
  });
});

describe('renderWeb', () => {
  const html = renderWeb(doc);

  it('renders every stage and the document figures', () => {
    for (const stage of ['Interest', 'Brief', 'Insight', 'Vocabulary', 'Picks', 'Next']) {
      expect(html).toContain(stage);
    }
    expect(html).toContain('7.3조');
    expect(html).toContain('2월 0.51조에서 약 14배');
    expect(html).toContain('하네스');
  });

  it('carries grades and their source markers onto the page', () => {
    expect(html).toContain('<span class="g v">확인</span>');
    expect(html).toContain('<sup class="ref">1</sup>');
  });

  /**
   * Regression: the stash placeholder used to be space-delimited, so a bare
   * number between spaces was read back as a placeholder index and dropped.
   * Every date in this publication is written that way.
   */
  it('keeps bare numbers that sit between spaces', () => {
    const withDates = IssueDocumentSchema.parse({
      ...base,
      dek: '8월 16 일과 2월 6 일에 <strong>7.3조</strong>를 넘었습니다.',
    });
    const out = renderWeb(withDates);
    expect(out).toContain('8월 16 일');
    expect(out).toContain('2월 6 일');
    expect(out).toContain('<strong>7.3조</strong>');
  });

  it('escapes content but keeps the inline tags the design uses', () => {
    const hostile = IssueDocumentSchema.parse({
      ...base,
      dek: '<script>alert(1)</script> 그리고 <strong>굵게</strong> 그리고 a & b',
    });
    const out = renderWeb(hostile);
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
    expect(out).toContain('<strong>굵게</strong>');
    expect(out).toContain('a &amp; b');
  });

  it('draws the funnel from counts rather than a fixed grid', () => {
    // 1672/20 + 336/20 = 84 + 17
    expect((html.match(/class="c f"/g) ?? []).length).toBe(84);
    expect((html.match(/class="c c"/g) ?? []).length).toBe(17);
    expect(html).toContain('<em>1,672</em>');
  });

  it('loads no font host other than Google', () => {
    expect(html).not.toContain('jsdelivr');
    expect(html).toContain('fonts.googleapis.com');
  });

  it('styles both themes through tokens', () => {
    expect(html).toContain('prefers-color-scheme: dark');
    expect(html).toContain(':root[data-theme="dark"]');
  });

  it('falls back rather than throwing when a template version is unknown', () => {
    const pinned = IssueDocumentSchema.parse({ ...base, templateVersion: 'web-v99' });
    expect(() => renderWeb(pinned)).not.toThrow();
    expect(renderCacheKey(pinned)).toBe(`brief:${doc.slug}:${DEFAULT_TEMPLATE}`);
  });

  it('keys the cache on the template version so a redesign cannot serve stale html', () => {
    expect(renderCacheKey(doc)).toBe('brief:2026-08-25-ai-tech:web-v1');
  });
});
