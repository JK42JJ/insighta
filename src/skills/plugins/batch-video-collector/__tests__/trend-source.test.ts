import { loadTrendKeywords } from '../sources/trend-source';

type Row = {
  keyword: string;
  language: string;
  norm_score: number;
  source: string;
  metadata: unknown;
};

function mockDb(rows: Row[]): any {
  return {
    trend_signals: {
      findMany: jest.fn().mockResolvedValue(rows),
    },
  };
}

describe('loadTrendKeywords', () => {
  it('extracts seed_domain from metadata', async () => {
    const db = mockDb([
      {
        keyword: '파이썬',
        language: 'ko',
        norm_score: 0.9,
        source: 'youtube_suggest',
        metadata: { seed_domain: '기술/개발' },
      },
      {
        keyword: '토익',
        language: 'ko',
        norm_score: 0.8,
        source: 'youtube_suggest',
        metadata: { seed_domain: '학습/교육' },
      },
    ]);
    const out = await loadTrendKeywords(db, 10);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ keyword: '파이썬', domain: '기술/개발' });
    expect(out[1]).toMatchObject({ keyword: '토익', domain: '학습/교육' });
  });

  it('falls back to "general" when seed_domain missing', async () => {
    const db = mockDb([
      {
        keyword: 'AI',
        language: 'ko',
        norm_score: 0.7,
        source: 'youtube_trending_extracted',
        metadata: {},
      },
    ]);
    const out = await loadTrendKeywords(db, 10);
    expect(out[0]!.domain).toBe('general');
  });

  it('dedupes by (language, keyword.toLowerCase)', async () => {
    const db = mockDb([
      { keyword: 'Python', language: 'en', norm_score: 0.9, source: 's', metadata: {} },
      { keyword: 'python', language: 'en', norm_score: 0.8, source: 's', metadata: {} },
      { keyword: 'Python', language: 'ko', norm_score: 0.7, source: 's', metadata: {} },
    ]);
    const out = await loadTrendKeywords(db, 10);
    // en: first wins; ko: separate entry
    expect(out).toHaveLength(2);
    expect(out.map((k) => k.language).sort()).toEqual(['en', 'ko']);
  });

  it('respects limit', async () => {
    const rows: Row[] = Array.from({ length: 20 }, (_, i) => ({
      keyword: `kw${i}`,
      language: 'ko',
      norm_score: 1 - i * 0.01,
      source: 'x',
      metadata: {},
    }));
    const db = mockDb(rows);
    const out = await loadTrendKeywords(db, 5);
    expect(out).toHaveLength(5);
    expect(out[0]!.keyword).toBe('kw0');
  });

  it('returns [] when no rows', async () => {
    const db = mockDb([]);
    const out = await loadTrendKeywords(db, 10);
    expect(out).toEqual([]);
  });
});
