const mockQueryRaw = jest.fn();

jest.mock('@/modules/database', () => ({
  getPrismaClient: () => ({ $queryRaw: mockQueryRaw }),
}));

jest.mock('@/utils/logger', () => ({
  logger: {
    child: () => ({
      debug: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

import { getSemanticRank } from '../../../src/modules/video-dictionary/semantic-rank';

describe('getSemanticRank', () => {
  beforeEach(() => {
    mockQueryRaw.mockReset();
  });

  test('empty videoIds — returns empty map, no DB query', async () => {
    const result = await getSemanticRank({ mandalaId: 'm1', videoIds: [] });
    expect(result.size).toBe(0);
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });

  test('happy path — max-across-cells: returns cosine map, missing ids stay null', async () => {
    mockQueryRaw.mockResolvedValue([
      { video_id: 'v1', cosine: 0.82 },
      { video_id: 'v2', cosine: 0.41 },
    ]);

    const result = await getSemanticRank({
      mandalaId: 'm1',
      videoIds: ['v1', 'v2', 'v3'],
    });

    expect(result.get('v1')).toBeCloseTo(0.82, 4);
    expect(result.get('v2')).toBeCloseTo(0.41, 4);
    // v3 had no embedding row — must stay null (fallback contract)
    expect(result.get('v3')).toBeNull();
    expect(result.size).toBe(3);
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });

  test('cell-targeted — when cellAssignments provided, uses targeted query path', async () => {
    mockQueryRaw.mockResolvedValue([{ video_id: 'v1', cosine: 0.75 }]);

    const result = await getSemanticRank({
      mandalaId: 'm1',
      videoIds: ['v1'],
      cellAssignments: new Map([['v1', 3]]),
    });

    expect(result.get('v1')).toBeCloseTo(0.75, 4);
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });

  test('cell-targeted — videoId without assignment is excluded from query but stays null in result', async () => {
    mockQueryRaw.mockResolvedValue([{ video_id: 'v1', cosine: 0.6 }]);

    const result = await getSemanticRank({
      mandalaId: 'm1',
      videoIds: ['v1', 'v2'],
      cellAssignments: new Map([['v1', 0]]),
    });

    expect(result.get('v1')).toBeCloseTo(0.6, 4);
    expect(result.get('v2')).toBeNull();
  });

  test('cosine out-of-range — clamped to [0, 1]', async () => {
    mockQueryRaw.mockResolvedValue([
      { video_id: 'v1', cosine: 1.5 },
      { video_id: 'v2', cosine: -0.3 },
      { video_id: 'v3', cosine: Number.NaN },
    ]);

    const result = await getSemanticRank({
      mandalaId: 'm1',
      videoIds: ['v1', 'v2', 'v3'],
    });

    expect(result.get('v1')).toBe(1);
    expect(result.get('v2')).toBe(0);
    // NaN is non-finite → returns null per fallback contract
    expect(result.get('v3')).toBeNull();
  });

  test('DB error — returns all-null map, does not throw', async () => {
    mockQueryRaw.mockRejectedValue(new Error('connection refused'));

    const result = await getSemanticRank({
      mandalaId: 'm1',
      videoIds: ['v1', 'v2'],
    });

    expect(result.get('v1')).toBeNull();
    expect(result.get('v2')).toBeNull();
  });

  test('duplicate videoIds — deduped before query', async () => {
    mockQueryRaw.mockResolvedValue([{ video_id: 'v1', cosine: 0.5 }]);

    const result = await getSemanticRank({
      mandalaId: 'm1',
      videoIds: ['v1', 'v1', 'v1'],
    });

    // Map uses videoId as key → only 1 entry regardless of input dups
    expect(result.size).toBe(1);
    expect(result.get('v1')).toBeCloseTo(0.5, 4);
  });

  test('cell-targeted — empty assignments map falls back to max-across-cells path', async () => {
    mockQueryRaw.mockResolvedValue([{ video_id: 'v1', cosine: 0.3 }]);

    const result = await getSemanticRank({
      mandalaId: 'm1',
      videoIds: ['v1'],
      cellAssignments: new Map(),
    });

    expect(result.get('v1')).toBeCloseTo(0.3, 4);
  });
});
