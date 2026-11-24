import {
  buildMorningCardReason,
  MORNING_CARD_REASON_MAX_LENGTH,
} from '@/modules/morning-cards/reason';

describe('morning-cards reason', () => {
  it('is one non-empty line naming the domain and the year window', () => {
    const r = buildMorningCardReason({ domain_label: '업무 실무' });
    expect(r).toContain('업무 실무');
    expect(r).toContain('올해');
    expect(r).not.toContain('\n');
  });

  it('never exposes internal values: score, pool source or the upload date', () => {
    const r = buildMorningCardReason({ domain_label: 'AI 도구' });
    expect(r).not.toMatch(/관련도|출처|r1_min|\d{4}-\d{2}-\d{2}|0\.\d/);
  });

  it('stays under the max length even for a very long label', () => {
    const r = buildMorningCardReason({ domain_label: 'x'.repeat(500) });
    expect(r.length).toBeLessThanOrEqual(MORNING_CARD_REASON_MAX_LENGTH);
  });

  it('falls back when the label is empty', () => {
    expect(buildMorningCardReason({ domain_label: '' })).not.toBe('');
  });
});
