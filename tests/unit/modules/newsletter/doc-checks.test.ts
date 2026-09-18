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
  checkGroundingQuotes,
  checkQuoteCarriesFigures,
  checkAttributionQuoted,
  checkUnitsConsistent,
  checkCalculationDomain,
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

describe('checkGroundingQuotes', () => {
  const src = '전체 어텐션을 쓰는 층은 16개뿐이고, 토큰당 64킬로바이트가 거기서 나옵니다.';

  it('passes a quote that is in the source', () => {
    const found = checkGroundingQuotes([
      {
        where: '꼭지5',
        text: '토큰당 64KiB입니다.',
        quoted: '토큰당 64킬로바이트',
        sourceText: src,
      },
    ]);
    expect(found).toHaveLength(0);
  });

  it('catches a quote the source does not contain', () => {
    const found = checkGroundingQuotes([
      { where: '꼭지5', text: '층당 64KiB입니다.', quoted: '층당 64킬로바이트', sourceText: src },
    ]);
    expect(found[0]?.check).toBe('grounding-quote');
  });

  it('ignores a line break the caption happened to have', () => {
    const found = checkGroundingQuotes([
      { where: '꼭지5', text: 'x', quoted: '토큰당\n  64킬로바이트', sourceText: src },
    ]);
    expect(found).toHaveLength(0);
  });

  it('compares composed and decomposed Hangul as the same text', () => {
    const found = checkGroundingQuotes([
      {
        where: '꼭지5',
        text: 'x',
        quoted: '토큰당 64킬로바이트'.normalize('NFD'),
        sourceText: src,
      },
    ]);
    expect(found).toHaveLength(0);
  });

  it('catches a sentence with no quote at all', () => {
    const found = checkGroundingQuotes([
      { where: '꼭지1', text: 'x', quoted: '  ', sourceText: src },
    ]);
    expect(found[0]?.detail).toContain('no quote');
  });
});

describe('checkQuoteCarriesFigures', () => {
  it('catches a changed date under a verbatim quote — the issue 1 defect', () => {
    const found = checkQuoteCarriesFigures([
      {
        where: '원장 7행',
        text: '블룸버그는 8월 23일 보도했습니다.',
        quoted: '블룸버그는 8월 16일 보도했다',
        sourceText: '블룸버그는 8월 16일 보도했다',
      },
    ]);
    expect(found[0]?.detail).toContain('23');
  });

  it('passes when the figure is in the quote', () => {
    const found = checkQuoteCarriesFigures([
      { where: 'x', text: '과제는 89개입니다.', quoted: '89 tasks', sourceText: '89 tasks' },
    ]);
    expect(found).toHaveLength(0);
  });
});

describe('checkAttributionQuoted', () => {
  it('catches reported speech with nothing to show for it', () => {
    const found = checkAttributionQuoted([
      { where: '꼭지5 제목', text: '12GB에 올라간다던 그 파일', quoted: '', sourceText: 's' },
    ]);
    expect(found[0]?.check).toBe('attribution-unquoted');
  });

  it('leaves a plain statement alone', () => {
    const found = checkAttributionQuoted([
      { where: 'x', text: '파일은 11.8GB입니다.', quoted: '', sourceText: 's' },
    ]);
    expect(found).toHaveLength(0);
  });
});

describe('checkUnitsConsistent', () => {
  it('catches GiB added to GB — the 32GB story', () => {
    const found = checkUnitsConsistent([
      {
        label: '합',
        inputs: { kv: 16, weights: 11.8 },
        inputUnits: { kv: 'GiB', weights: 'GB' },
        formula: 'kv + weights',
        result: 27.8,
        unit: 'GB',
      },
    ]);
    expect(found.some((f) => f.check === 'unit-mixed')).toBe(true);
  });

  it('passes once both sides are the same kind of unit', () => {
    const found = checkUnitsConsistent([
      {
        label: '합',
        inputs: { kv: 17.18, weights: 11.8 },
        inputUnits: { kv: 'GB', weights: 'GB' },
        formula: 'kv + weights',
        result: 28.98,
        unit: 'GB',
      },
    ]);
    expect(found).toHaveLength(0);
  });

  it('leaves a division that mixes units alone — bytes per token is the point', () => {
    const found = checkUnitsConsistent([
      {
        label: '토큰당',
        inputs: { bytes: 160, tokens: 1 },
        inputUnits: { bytes: 'KiB', tokens: 'token' },
        formula: 'bytes / tokens',
        result: 160,
        unit: 'KiB',
      },
    ]);
    expect(found).toHaveLength(0);
  });
});

describe('checkCalculationDomain', () => {
  const waste: Calculation = {
    label: '경계 낭비',
    inputs: { pool: 637000, ctx: 318501 },
    formula: '1 - (pool - (pool - ctx)) / pool',
    result: 0.5,
    domain: { variable: 'ctx', from: 159251, to: 318501 },
  };

  it('catches a single reading stated as a rule', () => {
    const found = checkCalculationDomain([waste]);
    expect(found[0]?.detail).toContain('one reading');
  });

  it('passes a value that holds across the range', () => {
    const found = checkCalculationDomain([
      {
        label: '상수',
        inputs: { a: 2, x: 0 },
        formula: 'a * 3',
        result: 6,
        domain: { variable: 'x', from: 0, to: 10 },
      },
    ]);
    expect(found).toHaveLength(0);
  });
});
