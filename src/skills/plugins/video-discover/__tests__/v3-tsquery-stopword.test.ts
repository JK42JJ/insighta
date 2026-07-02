import { buildTsqueryString } from '../v3/tsquery-builder';

/**
 * W2 retrieval precision — buildTsqueryString drops generic-filler tokens so an
 * OR-tsquery no longer pulls cross-domain videos into a topical cell.
 */
describe('buildTsqueryString — W2 generic-filler stopwords', () => {
  it('drops generic filler, keeps topical nouns', () => {
    const q = buildTsqueryString('해외주식 시장 분석 글로벌 기업 투자 역량 강화');
    const toks = q.split(' | ');
    // topical nouns kept
    expect(toks).toContain('해외주식');
    expect(toks).toContain('투자');
    expect(toks).toContain('글로벌');
    // generic filler dropped
    expect(toks).not.toContain('분석');
    expect(toks).not.toContain('강화');
  });

  it('empty-guard: an all-generic cell keeps its original tokens (recall never 0)', () => {
    // every token is a stopword — must NOT collapse to empty tsquery
    const q = buildTsqueryString('학습 관리 전략 강화');
    expect(q.length).toBeGreaterThan(0);
    expect(q.split(' | ')).toContain('학습');
  });

  it("drops '심화' — matched cross-domain videos (알고리즘 심화/명상 심화) in a 대체투자 cell", () => {
    const q = buildTsqueryString('대체투자(부동산·펀드·옵션) 심화 학습');
    const toks = q.split(' | ');
    expect(toks).toContain('대체투자');
    expect(toks).not.toContain('심화');
    expect(toks).not.toContain('학습');
  });

  it('still de-duplicates and returns OR-joined tokens', () => {
    const q = buildTsqueryString('쿠버네티스 쿠버네티스 배포');
    expect(q).toBe('쿠버네티스 | 배포');
  });

  it('returns empty string for token-less input (unchanged contract)', () => {
    expect(buildTsqueryString('   ')).toBe('');
  });
});
