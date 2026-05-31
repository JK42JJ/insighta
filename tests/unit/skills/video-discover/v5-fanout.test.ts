/**
 * v5 fanout — CP491 F5c per-query observability.
 * Verifies perQuery records raw count + q_ok per attempted query, independent
 * of fulfillment (rejected query → rawCount 0, fulfilled false).
 */

import { runYouTubeFanout } from '@/skills/plugins/video-discover/v5/youtube-fanout';
import { resetV5ConfigForTest } from '@/skills/plugins/video-discover/v5/config';

jest.mock('@/skills/plugins/video-discover/v2/youtube-client', () => ({
  searchVideos: jest.fn(),
  resolveSearchApiKeys: jest.fn().mockReturnValue(['key1']),
  titleIndicatesShorts: jest.fn().mockReturnValue(false),
  titleHitsBlocklist: jest.fn().mockReturnValue(false),
}));

jest.mock('@/skills/plugins/video-discover/v2/keyword-builder', () => ({
  buildRuleBasedQueriesSync: jest.fn(),
}));

const { searchVideos } = jest.requireMock('@/skills/plugins/video-discover/v2/youtube-client');
const { buildRuleBasedQueriesSync } = jest.requireMock(
  '@/skills/plugins/video-discover/v2/keyword-builder'
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

describe('runYouTubeFanout — F5c perQuery', () => {
  beforeEach(() => {
    resetV5ConfigForTest();
    searchVideos.mockReset();
    buildRuleBasedQueriesSync.mockReset();
  });

  test('perQuery records raw count + q_ok per query, including rejected', async () => {
    buildRuleBasedQueriesSync.mockReturnValue([
      { query: 'q0', source: 'core', cellIndex: null },
      { query: 'q1', source: 'subgoal', cellIndex: 1 },
      { query: 'q2', source: 'subgoal', cellIndex: 2 },
    ]);
    searchVideos.mockImplementation(({ query }: { query: string }) => {
      if (query === 'q1') return Promise.reject(new Error('quota'));
      return Promise.resolve(items(query === 'q0' ? 5 : 3, query));
    });

    const res = await runYouTubeFanout({
      centerGoal: 'goal',
      subGoals: [],
      focusTags: [],
      targetLevel: 'standard',
      language: 'en',
      env: {} as NodeJS.ProcessEnv,
    });

    expect(res.perQuery).toHaveLength(3);
    expect(res.perQuery[0]).toEqual({
      query: 'q0',
      source: 'core',
      cellIndex: null,
      rawCount: 5,
      fulfilled: true,
    });
    expect(res.perQuery[1]).toEqual({
      query: 'q1',
      source: 'subgoal',
      cellIndex: 1,
      rawCount: 0,
      fulfilled: false,
    });
    expect(res.perQuery[2]).toMatchObject({ query: 'q2', rawCount: 3, fulfilled: true });
    expect(res.queriesSucceeded).toBe(2);
    expect(res.candidates).toHaveLength(8); // 5 + 3, all unique
  });
});
