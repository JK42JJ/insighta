import {
  buildMorningCardReason,
  MORNING_CARD_REASON_MAX_LENGTH,
} from '@/modules/morning-cards/reason';

describe('morning-cards reason', () => {
  it('is non-empty and includes score, source and date', () => {
    const r = buildMorningCardReason({
      relevance_score: 0.8765,
      source: 'tag',
      published_at: new Date('2026-03-05T00:00:00Z'),
    });
    expect(r).toContain('0.88');
    expect(r).toContain('tag');
    expect(r).toContain('2026-03-05');
    expect(r.length).toBeGreaterThan(0);
  });

  it('stays under the max length even for a very long source', () => {
    const r = buildMorningCardReason({
      relevance_score: 0.5,
      source: 'x'.repeat(500),
      published_at: null,
    });
    expect(r.length).toBeLessThanOrEqual(MORNING_CARD_REASON_MAX_LENGTH);
  });

  it('handles missing date and non-finite score', () => {
    const r = buildMorningCardReason({ relevance_score: NaN, source: '', published_at: null });
    expect(r).not.toBe('');
    expect(r).not.toContain('업로드');
  });
});
