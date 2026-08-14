/**
 * Nine-domain taxonomy (P3).
 *
 * Two things are being pinned. That every weekly edition has a domain to sit
 * in, and that short ASCII patterns stop claiming words they merely appear
 * inside — 'ai' was taking appalachian trail, email marketing, detail and
 * chair yoga, all four measured against the live keyword set, so a tagging
 * backfill would have written that into the database.
 */
export {};

import {
  mapKeywordToDomain,
  extractTaxonomyKeywords,
  CURATION_DOMAINS,
  type CurationDomain,
} from '../../src/modules/curation/domain-taxonomy';

describe('the nine editions each have a domain', () => {
  it('carries nine domains plus the fallback, in canonical order', () => {
    expect(CURATION_DOMAINS).toEqual([
      'ai_ml',
      'career',
      'startup',
      'investment',
      'health',
      'learning',
      'policy',
      'creator',
      'lifestyle',
      'other',
    ]);
  });

  const cases: Array<[string, CurationDomain]> = [
    ['Claude 모델', 'ai_ml'],
    ['머신러닝', 'ai_ml'],
    ['면접 준비', 'career'],
    ['창업 아이템', 'startup'],
    ['ETF 투자', 'investment'],
    ['근력운동 루틴', 'health'],
    ['토익 단어', 'learning'],
    ['노인 복지주택', 'policy'],
    ['뉴스레터 마케팅', 'creator'],
    ['디지털 노마드', 'lifestyle'],
    ['바이올린 연주', 'other'],
  ];
  it.each(cases)('%s → %s', (keyword, domain) => {
    expect(mapKeywordToDomain(keyword)).toBe(domain);
  });
});

describe('short ASCII patterns need a word boundary', () => {
  // Every one of these was ai_ml before the boundary rule, measured on the
  // live trend_signals keyword set.
  it.each([
    ['appalachian trail', 'other'],
    ['detail', 'other'],
    ['html', 'other'],
  ])('%s no longer counts as AI', (keyword, domain) => {
    expect(mapKeywordToDomain(keyword)).toBe(domain);
  });

  it('still matches the same tokens when they stand alone', () => {
    expect(mapKeywordToDomain('ai 학습')).toBe('ai_ml');
    expect(mapKeywordToDomain('ml 파이프라인')).toBe('ai_ml');
  });

  it('sends the boundary-freed keywords to where they belong, not just away', () => {
    expect(mapKeywordToDomain('email marketing')).toBe('creator');
    expect(mapKeywordToDomain('chair yoga')).toBe('health');
  });

  it('keeps Korean patterns as plain substrings', () => {
    // No boundary rule applies, so a keyword containing the pattern still hits.
    expect(mapKeywordToDomain('주식 투자 입문')).toBe('investment');
  });
});

describe('learning absorbed language and exam', () => {
  it('puts both study kinds in one edition', () => {
    expect(mapKeywordToDomain('영어회화')).toBe('learning');
    expect(mapKeywordToDomain('수능 국어')).toBe('learning');
  });

  it('does not lose a technical term to the shared word "learning"', () => {
    // 'reinforcement learning' is AI, not studying — the noun is shared.
    expect(mapKeywordToDomain('reinforcement learning')).toBe('ai_ml');
  });
});

describe('extractTaxonomyKeywords', () => {
  it('reports each matched pattern with its domain', () => {
    const out = extractTaxonomyKeywords('머신러닝으로 ETF 투자 분석하기');
    expect(out.find((k) => k.kw === '머신러닝')?.domain).toBe('ai_ml');
    expect(out.find((k) => k.kw === 'etf')?.domain).toBe('investment');
  });

  it('does not extract a short pattern from inside a longer word', () => {
    const out = extractTaxonomyKeywords('appalachian trail hiking');
    expect(out.find((k) => k.kw === 'ai')).toBeUndefined();
  });

  it('returns nothing for a title with no known interest area', () => {
    expect(extractTaxonomyKeywords('바이올린 연주회 후기')).toEqual([]);
  });
});
