import {
  morningCardsConfig,
  parseMorningCardsConfig,
  resolveFreshnessClass,
} from '../../src/modules/morning-cards/config';

describe('morning-cards config', () => {
  it('has eight fields with expected default classes', () => {
    const map = Object.fromEntries(morningCardsConfig.fields.map((f) => [f.id, f.defaultClass]));
    expect(Object.keys(map)).toHaveLength(8);
    expect(map).toEqual({
      work_practice: 'market',
      startup_gov_support: 'time_bound',
      ai_tools_dev: 'fast',
      cert_exam: 'time_bound',
      teaching_materials: 'evergreen',
      career_jobs: 'market',
      marketing_sales: 'market',
      management_consulting: 'market',
    });
    expect(morningCardsConfig.fields[0]?.label).toBe('업무 실무');
  });

  it('has the documented defaults', () => {
    expect(morningCardsConfig.windows).toEqual({
      fastDays: 30,
      marketDays: 90,
      evergreenDays: null,
    });
    expect(morningCardsConfig.timeBoundFallbackMonths).toBe(0);
    expect(morningCardsConfig.allowedLanguages).toEqual(['ko']);
    expect(morningCardsConfig.minRelevance).toBe(60);
    expect(morningCardsConfig.maxCardsPerField).toBe(30);
  });

  it('rejects invalid values', () => {
    expect(() => parseMorningCardsConfig({ minRelevance: 101 })).toThrow();
    expect(() => parseMorningCardsConfig({ minRelevance: 50.5 })).toThrow();
    expect(() => parseMorningCardsConfig({ timeBoundFallbackMonths: -1 })).toThrow();
  });

  it('keyword rule upgrades any field to time_bound', () => {
    expect(resolveFreshnessClass('teaching_materials', '2026 청년 지원사업 안내')).toBe(
      'time_bound'
    );
    expect(resolveFreshnessClass('ai_tools_dev', '세법 개정 정리')).toBe('time_bound');
    expect(resolveFreshnessClass('cert_exam', '시험 일정 총정리')).toBe('time_bound');
  });

  it('falls back to the field default without keywords', () => {
    expect(resolveFreshnessClass('ai_tools_dev', '새 코딩 도구')).toBe('fast');
    expect(resolveFreshnessClass('teaching_materials', '수업 자료')).toBe('evergreen');
    expect(resolveFreshnessClass('nope', 'x')).toBe('market');
  });
});
