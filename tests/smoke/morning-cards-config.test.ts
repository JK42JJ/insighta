import {
  morningCardsConfig as cfg,
  parseMorningCardsConfig,
  resolveFreshnessClass,
} from '../../src/modules/morning-cards/config';

describe('morning-cards config', () => {
  it('has eight fields and documented defaults', () => {
    expect(cfg.fields).toHaveLength(8);
    expect(cfg.fields[0]).toMatchObject({ id: 'work_practice', label: '업무 실무' });
    expect(cfg.fields.find((f) => f.id === 'cert_exam')?.defaultClass).toBe('time_bound');
    expect(cfg.windows).toEqual({ fastDays: 30, marketDays: 90, evergreenDays: null });
    expect(cfg).toMatchObject({
      timeBoundFallbackMonths: 0,
      allowedLanguages: ['ko'],
      minRelevance: 60,
      maxCardsPerField: 30,
    });
  });

  it('rejects invalid values', () => {
    expect(() => parseMorningCardsConfig({ minRelevance: 101 })).toThrow();
    expect(() => parseMorningCardsConfig({ timeBoundFallbackMonths: -1 })).toThrow();
  });

  it('keyword rule upgrades to time_bound, else field default', () => {
    expect(resolveFreshnessClass('teaching_materials', '청년 지원사업')).toBe('time_bound');
    expect(resolveFreshnessClass('ai_tools_dev', '세법 개정')).toBe('time_bound');
    expect(resolveFreshnessClass('ai_tools_dev', '새 도구')).toBe('fast');
    expect(resolveFreshnessClass('teaching_materials', '수업')).toBe('evergreen');
    expect(resolveFreshnessClass('nope', 'x')).toBe('market');
  });
});
