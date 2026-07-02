import { loadGoalKeywords } from '../sources/goal-source';

type Row = { keyword: string; language: string | null; domain: string | null; freq: number };

function mockDb(rows: Row[]): any {
  return { $queryRawUnsafe: jest.fn().mockResolvedValue(rows) };
}

describe('loadGoalKeywords (W3 goal-driven source)', () => {
  it('maps cell sub-goals to TrendKeyword shape and normalizes score by top freq', async () => {
    const out = await loadGoalKeywords(
      mockDb([
        { keyword: 'ETF 투자로 노후 준비', language: 'ko', domain: 'finance', freq: 4 },
        { keyword: '쿠버네티스 상용 운영', language: null, domain: null, freq: 2 },
      ]),
      10
    );
    expect(out[0]).toMatchObject({
      keyword: 'ETF 투자로 노후 준비',
      language: 'ko',
      domain: 'finance',
      trendSource: 'popular_goals',
      score: 1,
    });
    // null language -> 'ko', null domain -> 'goal', freq 2/4 -> score 0.5
    expect(out[1]).toMatchObject({ language: 'ko', domain: 'goal', score: 0.5 });
  });

  it('dedups by (keyword, language) case-insensitively and respects limit', async () => {
    const rows: Row[] = [
      { keyword: 'Master algorithm patterns', language: 'ko', domain: null, freq: 3 },
      { keyword: 'master algorithm patterns', language: 'ko', domain: null, freq: 2 }, // dup
      { keyword: 'Bond and rate markets', language: 'ko', domain: null, freq: 1 },
    ];
    expect((await loadGoalKeywords(mockDb(rows), 10)).length).toBe(2);
    expect((await loadGoalKeywords(mockDb(rows), 1)).length).toBe(1);
  });

  it('drops too-short goals and returns empty for no rows', async () => {
    expect(await loadGoalKeywords(mockDb([]), 10)).toEqual([]);
    expect(
      await loadGoalKeywords(mockDb([{ keyword: 'ab', language: 'ko', domain: null, freq: 9 }]), 10)
    ).toEqual([]);
  });
});
