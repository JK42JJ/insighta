/**
 * The checks that read a finished issue against the materials it came from.
 *
 * Each case here is a defect that shipped in issue 2 and was caught by a
 * person, across five review rounds. The publish gates passed the document
 * every time.
 */

jest.mock('@/utils/logger', () => ({
  logger: { child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) },
}));
jest.mock('@/modules/database/client', () => ({ getPrismaClient: () => ({}) }));

import {
  checkNumbersGrounded,
  checkCalculations,
  checkCitationsListed,
  checkNoSelfCitation,
  checkVerifiedHasPrimary,
  checkSelfCounts,
  checkCrossReferences,
  type Materials,
  type Calculation,
} from '@/modules/newsletter/v2/doc-checks';
import type { IssueDocument } from '@/modules/newsletter/issue-schema';

const materials: Materials = {
  factsText: '카드의 자리는 637,000토큰이었습니다. 과제는 89개입니다.',
  funnelBuckets: [{ key: 'form', count: 1725 }],
};

function doc(over: Partial<IssueDocument> = {}): IssueDocument {
  return {
    schemaVersion: 1,
    templateVersion: 'web-v1',
    locale: 'ko',
    slug: '2026-09-15-ai-tech',
    category: 'AI',
    categoryKey: 'ai-tech',
    issueLabel: '제2호',
    dateLabel: '2026년 9월 15일',
    publishedAt: '2026-09-15T00:00:00.000Z',
    headline: ['제목'],
    dek: '덱',
    runline: '근거 영상 1편',
    preview: '미리보기',
    interest: {
      intro: '소개',
      ledgerCaption: '표',
      ledger: [
        {
          name: '자리',
          grade: 'observed',
          ref: 1,
          desc: '설명',
          value: '637,000토큰',
          emphasis: 'none',
        },
      ],
    },
    stories: [
      {
        kicker: '서빙',
        title: '제목',
        navLabel: '라벨',
        blocks: [{ type: 'p', html: '카드의 자리는 637,000토큰이었습니다.' }],
      },
    ],
    insight: { blocks: [{ type: 'p', html: '종합' }], actions: [] },
    vocabulary: [],
    picks: [],
    next: { intro: '다음', checkpoints: [{ when: '제3호', title: '항목 하나' }] },
    refs: [
      {
        label: '서빙',
        sources: [{ name: '영상', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' }],
      },
    ],
    gradeNote: '등급',
    editNote: '편집',
    sign: 'Insighta',
    ...over,
  } as IssueDocument;
}

describe('checkNumbersGrounded', () => {
  it('passes a number the materials state', () => {
    expect(checkNumbersGrounded(doc(), materials)).toHaveLength(0);
  });

  it('catches a number no source states', () => {
    const d = doc();
    d.stories[0]!.blocks[0] = { type: 'p', html: '카드의 자리는 737,000토큰이었습니다.' };
    const found = checkNumbersGrounded(d, materials);
    expect(found).toHaveLength(1);
    expect(found[0]?.detail).toContain('737000');
  });

  it('accepts a number the issue declares as a calculation', () => {
    const d = doc();
    d.stories[0]!.blocks[0] = { type: 'p', html: '2,000토큰 프롬프트로는 318개가 들어갑니다.' };
    const calc: Calculation = {
      label: '동시 수용',
      inputs: { pool: 637000, ctx: 2000 },
      formula: 'pool / ctx',
      result: 318,
      rounding: 'floor',
    };
    expect(checkNumbersGrounded(d, materials, [calc])).toHaveLength(0);
  });

  it('leaves years and small counts alone', () => {
    const d = doc();
    d.stories[0]!.blocks[0] = { type: 'p', html: '2026년에 세 명이 물었습니다.' };
    expect(checkNumbersGrounded(d, materials)).toHaveLength(0);
  });
});

describe('checkCalculations', () => {
  const base: Calculation = {
    label: '동시 수용',
    inputs: { pool: 637000, ctx: 2000 },
    formula: 'pool / ctx',
    result: 318,
    rounding: 'floor',
  };

  it('accepts a declared floor', () => {
    expect(checkCalculations([base])).toHaveLength(0);
  });

  it('catches a printed value the formula does not produce', () => {
    const found = checkCalculations([{ ...base, result: 400 }]);
    expect(found[0]?.detail).toContain('issue prints 400');
  });

  it('catches an undeclared rounding — the 318.5 that started issue 2', () => {
    const found = checkCalculations([{ ...base, rounding: 'none', result: 318 }]);
    expect(found.some((f) => f.check === 'calculation')).toBe(true);
  });
});

describe('checkCitationsListed', () => {
  it('catches a video cited in the body and absent from refs and picks', () => {
    const d = doc();
    d.stories[0]!.blocks[0] = { type: 'p', html: '그 영상은 (zzzZZZzz-Az) 입니다.' };
    const found = checkCitationsListed(d);
    expect(found.map((f) => f.where)).toContain('zzzZZZzz-Az');
  });
});

describe('checkNoSelfCitation', () => {
  it('catches the issue citing itself', () => {
    const d = doc();
    d.refs[0]!.sources[0] = { name: '이 호', url: 'https://insighta.one/brief/2026-09-15-ai-tech' };
    expect(checkNoSelfCitation(d)).toHaveLength(1);
  });
});

describe('checkVerifiedHasPrimary', () => {
  it('catches a verified row whose only source is a video', () => {
    const d = doc();
    d.interest.ledger[0]!.grade = 'verified';
    expect(checkVerifiedHasPrimary(d)).toHaveLength(1);
  });

  it('passes when a non-video source sits under it', () => {
    const d = doc();
    d.interest.ledger[0]!.grade = 'verified';
    d.refs[0]!.sources.push({ name: '모델 카드', url: 'https://huggingface.co/x' });
    expect(checkVerifiedHasPrimary(d)).toHaveLength(0);
  });
});

describe('checkSelfCounts', () => {
  it('catches a stated citation count the issue does not carry', () => {
    const d = doc({ editNote: '본문 근거 영상은 11편이다.' });
    const found = checkSelfCounts(d);
    expect(found[0]?.detail).toContain('1 distinct videos');
  });
});

describe('checkCrossReferences', () => {
  it('catches a pointer past the end of the next-issue list', () => {
    const d = doc();
    d.insight.blocks = [{ type: 'p', html: '제3호 측정 목록의 아홉 번째 항목이 그것입니다.' }];
    expect(checkCrossReferences(d)).toHaveLength(1);
  });
});
