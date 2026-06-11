/**
 * CP499+ B7 — poorest-cell-wins dedup regression.
 *
 * Measured defect ("Claude Code…" mandala): every cell's search returned
 * raw≈40 but rec_cache cells 6·7 = 0 — overlapping query families return
 * the same videos for many cells and first-cell-wins dedup let the EARLIER
 * cell swallow every duplicate, hollowing later buckets before binning.
 *
 * Pins: a duplicate yields to the strictly poorer cell / unique results
 * keep their own cell / null-cell (core) candidates never reassign /
 * fully-overlapping two-cell fixture ends balanced, not N:0.
 */

jest.mock('@/skills/plugins/video-discover/v2/youtube-client', () => ({
  searchVideos: jest.fn(),
  resolveSearchApiKeys: jest.fn().mockReturnValue(['key1']),
  titleIndicatesShorts: jest.fn().mockReturnValue(false),
  titleHitsBlocklist: jest.fn().mockReturnValue(false),
}));
jest.mock('@/skills/plugins/video-discover/v2/keyword-builder', () => ({
  buildRuleBasedQueriesSync: jest.fn(),
}));
jest.mock('@/utils/logger', () => {
  const base: Record<string, unknown> = {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  };
  base['child'] = jest.fn(() => base);
  return { logger: base };
});

const { searchVideos } = jest.requireMock('@/skills/plugins/video-discover/v2/youtube-client');
const { buildRuleBasedQueriesSync } = jest.requireMock(
  '@/skills/plugins/video-discover/v2/keyword-builder'
);

import { runYouTubeFanout } from '@/skills/plugins/video-discover/v5/youtube-fanout';
import { resetV5ConfigForTest } from '@/skills/plugins/video-discover/v5/config';

const item = (id: string) => ({
  id: { videoId: id },
  snippet: {
    title: `한국어 영상 ${id}`,
    channelTitle: 'ch',
    channelId: 'cid',
    publishedAt: '2026-01-01T00:00:00Z',
    thumbnails: { high: { url: 'u' } },
  },
});

const baseInput = {
  centerGoal: '클로드 코드',
  subGoals: ['모니터링', '스케일링'],
  focusTags: [],
  targetLevel: 'standard',
  language: 'ko' as const,
  env: {} as NodeJS.ProcessEnv,
};

beforeEach(() => {
  jest.clearAllMocks();
  resetV5ConfigForTest();
});

describe('v5 fanout dedup — poorest-cell-wins (B7)', () => {
  it('FULL overlap: buckets end balanced instead of N:0 (the measured starvation)', async () => {
    buildRuleBasedQueriesSync.mockReturnValue([
      { query: 'q-cell0', source: 'subgoal', cellIndex: 0 },
      { query: 'q-cell1', source: 'subgoal', cellIndex: 1 },
    ]);
    // both cells return the SAME 4 videos — pre-fix: cell0 4, cell1 0.
    const overlap = [item('v1'), item('v2'), item('v3'), item('v4')];
    searchVideos.mockResolvedValue(overlap);

    const res = await runYouTubeFanout(baseInput);

    const byCell = new Map<number | null, number>();
    for (const c of res.candidates) byCell.set(c.cellIndex, (byCell.get(c.cellIndex) ?? 0) + 1);
    expect(res.candidates).toHaveLength(4); // dedup count unchanged
    expect(byCell.get(0)).toBe(2);
    expect(byCell.get(1)).toBe(2); // tail cell no longer starved
  });

  it('NO overlap: every result keeps its own cell (no spurious reassignment)', async () => {
    buildRuleBasedQueriesSync.mockReturnValue([
      { query: 'q-cell0', source: 'subgoal', cellIndex: 0 },
      { query: 'q-cell1', source: 'subgoal', cellIndex: 1 },
    ]);
    searchVideos.mockImplementation(({ query }: { query: string }) =>
      Promise.resolve(query === 'q-cell0' ? [item('a1'), item('a2')] : [item('b1'), item('b2')])
    );
    const res = await runYouTubeFanout(baseInput);
    expect(
      res.candidates
        .filter((c) => c.cellIndex === 0)
        .map((c) => c.videoId)
        .sort()
    ).toEqual(['a1', 'a2']);
    expect(
      res.candidates
        .filter((c) => c.cellIndex === 1)
        .map((c) => c.videoId)
        .sort()
    ).toEqual(['b1', 'b2']);
  });

  it('duplicate does NOT move to an equal-or-richer cell (strictly poorer only)', async () => {
    buildRuleBasedQueriesSync.mockReturnValue([
      { query: 'q-cell0', source: 'subgoal', cellIndex: 0 },
      { query: 'q-cell1', source: 'subgoal', cellIndex: 1 },
    ]);
    // cell0: [v1]; cell1: [u1, v1] — when v1 re-arrives for cell1, counts are
    // cell0=1 vs cell1=1 (u1 assigned first) → equal → v1 STAYS in cell0.
    searchVideos.mockImplementation(({ query }: { query: string }) =>
      Promise.resolve(query === 'q-cell0' ? [item('v1')] : [item('u1'), item('v1')])
    );
    const res = await runYouTubeFanout(baseInput);
    expect(res.candidates.find((c) => c.videoId === 'v1')?.cellIndex).toBe(0);
    expect(res.candidates.find((c) => c.videoId === 'u1')?.cellIndex).toBe(1);
  });
});
