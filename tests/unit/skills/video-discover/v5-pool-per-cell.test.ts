/**
 * CP494 안 A — fanout per-cell pool match branch (V5_POOL_MATCH=per_cell).
 *
 * When V5_POOL_MATCH=per_cell AND active cells carry queries with cellIndex,
 * the pool gate calls tsvectorKeywordCandidatesPerCell (NOT the global
 * centerGoal-OR match). Default (global) is unchanged. Plus perCellQueriesFrom
 * (cellIndex filter + per-cell token merge).
 */

import {
  runYouTubeFanout,
  perCellQueriesFrom,
} from '@/skills/plugins/video-discover/v5/youtube-fanout';
import { resetV5ConfigForTest } from '@/skills/plugins/video-discover/v5/config';

jest.mock('@/skills/plugins/video-discover/v2/youtube-client', () => ({
  searchVideos: jest.fn(),
  resolveSearchApiKeys: jest.fn().mockReturnValue(['key1']),
  titleIndicatesShorts: jest.fn().mockReturnValue(false),
  titleHitsBlocklist: jest.fn().mockReturnValue(false),
}));

jest.mock('@/skills/plugins/video-discover/v3/hybrid-rerank', () => ({
  tsvectorKeywordCandidates: jest.fn(),
  tsvectorKeywordCandidatesPerCell: jest.fn(),
}));

const { searchVideos } = jest.requireMock('@/skills/plugins/video-discover/v2/youtube-client');
const { tsvectorKeywordCandidates, tsvectorKeywordCandidatesPerCell } = jest.requireMock(
  '@/skills/plugins/video-discover/v3/hybrid-rerank'
);

function items(n: number, prefix: string) {
  return Array.from({ length: n }, (_, i) => ({
    id: { videoId: `${prefix}_${i}` },
    snippet: {
      title: `T${prefix}${i}`,
      description: 'd',
      channelTitle: 'c',
      channelId: 'ch',
      publishedAt: '2026-01-01T00:00:00Z',
      thumbnails: { high: { url: 'u' } },
    },
  }));
}

function poolCand(cellIndex: number, id: string) {
  return {
    videoId: id,
    title: `pool ${id}`,
    description: null,
    channelName: 'pc',
    channelId: 'pch',
    thumbnail: 'pu',
    viewCount: 10,
    likeCount: 1,
    durationSec: 300,
    publishedAt: null,
    cellIndex,
    rec_score: 0.5,
  };
}

function fanoutInput(env: Record<string, string> = {}) {
  return {
    centerGoal: 'goal',
    subGoals: ['a', 'b', 'c'],
    focusTags: [],
    targetLevel: 'standard',
    language: 'en' as const,
    env: env as unknown as NodeJS.ProcessEnv,
    precomputedQueries: [
      { cellIndex: 0, query: 'q0' },
      { cellIndex: 1, query: 'q1' },
      { cellIndex: 2, query: 'q2' },
    ],
  };
}

describe('perCellQueriesFrom', () => {
  test('drops queries without cellIndex, merges multiple queries per cell', () => {
    const out = perCellQueriesFrom([
      { query: 'core', source: 'core' }, // no cellIndex → dropped
      { query: 'a1', source: 'subgoal', cellIndex: 0 },
      { query: 'a2', source: 'subgoal', cellIndex: 0 }, // same cell → merged
      { query: 'b1', source: 'subgoal', cellIndex: 1 },
    ]);
    expect(out).toEqual([
      { cellIndex: 0, query: 'a1 a2' },
      { cellIndex: 1, query: 'b1' },
    ]);
  });

  test('empty when no query carries a cellIndex', () => {
    expect(perCellQueriesFrom([{ query: 'x', source: 'core' }])).toEqual([]);
  });
});

describe('runYouTubeFanout — CP494 안 A per-cell match', () => {
  beforeEach(() => {
    resetV5ConfigForTest();
    searchVideos.mockReset();
    tsvectorKeywordCandidates.mockReset();
    tsvectorKeywordCandidatesPerCell.mockReset();
    searchVideos.mockImplementation(({ query }: { query: string }) =>
      Promise.resolve(items(3, query))
    );
  });

  test('per_cell + backfill + cellIndex queries → per-cell fn used, global NOT called', async () => {
    // cell 0 satisfied (3 = floor) by the per-cell match.
    tsvectorKeywordCandidatesPerCell.mockResolvedValue([
      poolCand(0, 'p0a'),
      poolCand(0, 'p0b'),
      poolCand(0, 'p0c'),
    ]);

    const res = await runYouTubeFanout(
      fanoutInput({ V5_POOL_BACKFILL: 'true', V5_POOL_MATCH: 'per_cell' })
    );

    expect(tsvectorKeywordCandidatesPerCell).toHaveBeenCalledTimes(1);
    expect(tsvectorKeywordCandidates).not.toHaveBeenCalled();
    // per-cell fn received the 3 per-cell queries (cellIndex preserved).
    const arg = tsvectorKeywordCandidatesPerCell.mock.calls[0][0];
    expect(arg).toEqual([
      { cellIndex: 0, query: 'q0' },
      { cellIndex: 1, query: 'q1' },
      { cellIndex: 2, query: 'q2' },
    ]);
    // cell 0 dropped → only q1, q2 live.
    expect(searchVideos).toHaveBeenCalledTimes(2);
    expect(res.poolBackfill).toMatchObject({
      enabled: true,
      matchMode: 'per_cell',
      poolOnlyCells: 1,
      liveCells: 2,
    });
    expect(res.candidates.map((c) => c.videoId)).toEqual(
      expect.arrayContaining(['p0a', 'p0b', 'p0c'])
    );
  });

  test('default global match (V5_POOL_MATCH unset) → global fn used, per-cell NOT called', async () => {
    tsvectorKeywordCandidates.mockResolvedValue([]);
    const res = await runYouTubeFanout(fanoutInput({ V5_POOL_BACKFILL: 'true' }));

    expect(tsvectorKeywordCandidates).toHaveBeenCalledTimes(1);
    expect(tsvectorKeywordCandidatesPerCell).not.toHaveBeenCalled();
    expect(res.poolBackfill.matchMode).toBe('global');
  });

  test('per_cell flag but backfill off → no pool call at all (gate is off)', async () => {
    const res = await runYouTubeFanout(fanoutInput({ V5_POOL_MATCH: 'per_cell' }));
    expect(tsvectorKeywordCandidatesPerCell).not.toHaveBeenCalled();
    expect(tsvectorKeywordCandidates).not.toHaveBeenCalled();
    expect(res.poolBackfill.enabled).toBe(false);
    expect(searchVideos).toHaveBeenCalledTimes(3);
  });
});
