/**
 * domains SSOT — invariant checks (CP437).
 *
 * Spec lock: 9 fixed slugs, KO/EN labels match prod data verbatim,
 * label→slug map covers both languages.
 */

import {
  DOMAIN_SLUGS,
  DOMAIN_LABEL_KO,
  DOMAIN_LABEL_EN,
  DOMAIN_LABEL_TO_SLUG,
  isDomainSlug,
  DOMAINS,
  DOMAIN_SLUG_TO_LABEL_KO,
  DOMAIN_SLUG_TO_LABEL_EN,
  type DomainSlug,
} from '@/config/domains';

describe('domains SSOT', () => {
  test('exactly 9 slugs (locked)', () => {
    expect(DOMAIN_SLUGS).toHaveLength(9);
    expect([...DOMAIN_SLUGS]).toEqual([
      'tech',
      'learning',
      'health',
      'business',
      'finance',
      'social',
      'creative',
      'lifestyle',
      'mind',
    ]);
  });

  test('KO labels match prod data verbatim (mandala_embeddings.domain rows)', () => {
    expect(DOMAIN_LABEL_KO).toEqual({
      tech: '기술/개발',
      learning: '학습/교육',
      health: '건강/피트니스',
      business: '비즈니스/커리어',
      finance: '재테크/투자',
      social: '인간관계/커뮤니티',
      creative: '창작/예술',
      lifestyle: '라이프스타일/여행',
      mind: '마인드/영성',
    });
  });

  test('EN labels match prod data verbatim (Relationships plural, Mind/Spirituality)', () => {
    expect(DOMAIN_LABEL_EN.social).toBe('Relationships/Community');
    expect(DOMAIN_LABEL_EN.mind).toBe('Mind/Spirituality');
  });

  test('label → slug map round-trips both KO and EN labels', () => {
    for (const slug of DOMAIN_SLUGS) {
      expect(DOMAIN_LABEL_TO_SLUG[DOMAIN_LABEL_KO[slug]]).toBe(slug);
      expect(DOMAIN_LABEL_TO_SLUG[DOMAIN_LABEL_EN[slug]]).toBe(slug);
    }
  });

  test('isDomainSlug type guard', () => {
    expect(isDomainSlug('tech')).toBe(true);
    expect(isDomainSlug('mind')).toBe(true);
    expect(isDomainSlug('기술/개발')).toBe(false);
    expect(isDomainSlug(null)).toBe(false);
    expect(isDomainSlug(undefined)).toBe(false);
    expect(isDomainSlug('unknown')).toBe(false);
  });

  test('legacy aliases identical to canonical exports', () => {
    expect(DOMAINS).toBe(DOMAIN_SLUGS);
    expect(DOMAIN_SLUG_TO_LABEL_KO).toBe(DOMAIN_LABEL_KO);
    expect(DOMAIN_SLUG_TO_LABEL_EN).toBe(DOMAIN_LABEL_EN);
  });

  test('DomainSlug type narrows correctly', () => {
    const ok: DomainSlug = 'tech';
    expect(typeof ok).toBe('string');
  });
});
