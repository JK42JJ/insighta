/**
 * CP494 ④-1 — fanout full-cell skip. Cells in fullCellIndices are searched
 * neither in pool nor live (queries dropped upstream). Separate counter
 * (skippedFullCells), distinct from pool-backfill meta.
 */

import { runYouTubeFanout } from '@/skills/plugins/video-discover/v5/youtube-fanout';
import { resetV5ConfigForTest } from '@/skills/plugins/video-discover/v5/config';

jest.mock('@/skills/plugins/video-discover/v2/youtube-client', () => ({
  searchVideos: jest.fn(),
  resolveSearchApiKeys: jest.fn().mockReturnValue(['key1']),
  titleIndicatesShorts: jest.fn().mockReturnValue(false),
  titleHitsBlocklist: jest.fn().mockReturnValue(false),
}));
jest.mock('@/skills/plugins/video-discover/v3/hybrid-rerank', () => ({
  tsvectorKeywordCandidates: jest.fn(),
}));

const { searchVideos } = jest.requireMock('@/skills/plugins/video-discover/v2/youtube-client');

function items(prefix: string) {
  return [
    {
      id: { videoId: `${prefix}_0` },
      snippet: {
        title: `T${prefix}`,
        description: 'd',
        channelTitle: 'c',
        channelId: 'ch',
        publishedAt: '2026-01-01T00:00:00Z',
        thumbnails: { high: { url: 'u' } },
      },
    },
  ];
}

function input(fullCellIndices?: number[]) {
  return {
    centerGoal: 'goal',
    subGoals: ['a', 'b', 'c'],
    focusTags: [],
    targetLevel: 'standard',
    language: 'en' as const,
    env: {} as NodeJS.ProcessEnv, // pool-backfill off (default) → live path only
    precomputedQueries: [
      { cellIndex: 0, query: 'q0' },
      { cellIndex: 1, query: 'q1' },
      { cellIndex: 2, query: 'q2' },
    ],
    fullCellIndices,
  };
}

describe('runYouTubeFanout — CP494 ④-1 full-cell skip', () => {
  beforeEach(() => {
    resetV5ConfigForTest();
    searchVideos.mockReset();
    searchVideos.mockImplementation(({ query }: { query: string }) =>
      Promise.resolve(items(query))
    );
  });

  test('no fullCellIndices → all cells searched, skippedFullCells=0', async () => {
    const res = await runYouTubeFanout(input());
    expect(searchVideos).toHaveBeenCalledTimes(3);
    expect(res.skippedFullCells).toBe(0);
    expect(res.queriesAttempted).toBe(3);
  });

  test('full cell dropped: cell 1 not searched (pool nor live), skippedFullCells=1', async () => {
    const res = await runYouTubeFanout(input([1]));
    const searched = searchVideos.mock.calls.map((c: [{ query: string }]) => c[0].query).sort();
    expect(searched).toEqual(['q0', 'q2']); // q1 (cell 1) skipped
    expect(res.skippedFullCells).toBe(1);
    expect(res.queriesAttempted).toBe(2);
    expect(res.quotaUnitsApprox).toBe(200); // 2 live × 100
  });

  test('all cells full → no search, skippedFullCells=3, empty candidates', async () => {
    const res = await runYouTubeFanout(input([0, 1, 2]));
    expect(searchVideos).not.toHaveBeenCalled();
    expect(res.skippedFullCells).toBe(3);
    expect(res.queriesAttempted).toBe(0);
    expect(res.candidates).toHaveLength(0);
  });
});
