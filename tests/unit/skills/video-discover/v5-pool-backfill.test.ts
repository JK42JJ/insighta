/**
 * CP494 — v5 pool-first backfill gate (V5_POOL_BACKFILL).
 *
 * Verifies the quota-saving gate: cells the video_pool satisfies (≥
 * V5_POOL_MIN_PER_CELL gold/silver tsvector candidates) drop their live
 * search.list query, while deficit cells still go live. Plus hot-path safety
 * (timeout/throw → full live fallback) and the Fork-1 contract (pool candidates
 * pass the SAME off-language gate as live items).
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
const { tsvectorKeywordCandidates } = jest.requireMock(
  '@/skills/plugins/video-discover/v3/hybrid-rerank'
);

/** YouTube search.list result items (live path). */
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

/** video_pool KeywordCandidate rows (lexical supplier). */
function poolCand(cellIndex: number, id: string, title = `pool ${id}`) {
  return {
    videoId: id,
    title,
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

/** Three cells (0,1,2), one merged query each, en language. */
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

describe('runYouTubeFanout — CP494 pool-first backfill', () => {
  beforeEach(() => {
    resetV5ConfigForTest();
    searchVideos.mockReset();
    tsvectorKeywordCandidates.mockReset();
    searchVideos.mockImplementation(({ query }: { query: string }) =>
      Promise.resolve(items(3, query))
    );
  });

  test('flag off (default) → no pool call, all queries live, unchanged behavior', async () => {
    const res = await runYouTubeFanout(fanoutInput({}));

    expect(tsvectorKeywordCandidates).not.toHaveBeenCalled();
    expect(searchVideos).toHaveBeenCalledTimes(3);
    expect(res.queriesAttempted).toBe(3);
    expect(res.quotaUnitsApprox).toBe(300);
    expect(res.poolBackfill.enabled).toBe(false);
    expect(res.poolBackfill.liveCells).toBe(3);
    expect(res.poolBackfill.poolOnlyCells).toBe(0);
  });

  test('pool satisfies a cell (≥ floor) → that live query is dropped (quota saved)', async () => {
    // cell 0 gets 3 pool candidates (= floor) → satisfied; cells 1,2 get none.
    tsvectorKeywordCandidates.mockResolvedValue([
      poolCand(0, 'p0a'),
      poolCand(0, 'p0b'),
      poolCand(0, 'p0c'),
    ]);

    const res = await runYouTubeFanout(fanoutInput({ V5_POOL_BACKFILL: 'true' }));

    expect(tsvectorKeywordCandidates).toHaveBeenCalledTimes(1);
    // cell 0 dropped → only q1, q2 hit live.
    expect(searchVideos).toHaveBeenCalledTimes(2);
    const liveQueries = searchVideos.mock.calls.map((c: [{ query: string }]) => c[0].query).sort();
    expect(liveQueries).toEqual(['q1', 'q2']);
    expect(res.poolBackfill).toMatchObject({
      enabled: true,
      fellBackToLive: false,
      poolOnlyCells: 1,
      liveCells: 2,
      poolCandidates: 3,
      source: 'v2_promoted',
    });
    expect(res.queriesAttempted).toBe(2);
    expect(res.quotaUnitsApprox).toBe(200); // 800→ saved 1 cell
    // pool cell-0 candidates present in the merged candidate set.
    expect(res.candidates.map((c) => c.videoId)).toEqual(
      expect.arrayContaining(['p0a', 'p0b', 'p0c'])
    );
  });

  test('deficit cell (< floor) → query kept, but pool candidates still feed supply', async () => {
    // cell 0 gets only 2 (< floor 3) → NOT satisfied → q0 still goes live.
    tsvectorKeywordCandidates.mockResolvedValue([poolCand(0, 'p0a'), poolCand(0, 'p0b')]);

    const res = await runYouTubeFanout(fanoutInput({ V5_POOL_BACKFILL: 'true' }));

    expect(searchVideos).toHaveBeenCalledTimes(3); // all cells live
    expect(res.poolBackfill.poolOnlyCells).toBe(0);
    expect(res.poolBackfill.liveCells).toBe(3);
    expect(res.poolBackfill.poolCandidates).toBe(2); // still seeded
    expect(res.candidates.map((c) => c.videoId)).toEqual(expect.arrayContaining(['p0a', 'p0b']));
  });

  test('pool throws → full live fallback (hot-path safety)', async () => {
    tsvectorKeywordCandidates.mockRejectedValue(new Error('pg down'));

    const res = await runYouTubeFanout(fanoutInput({ V5_POOL_BACKFILL: 'true' }));

    expect(searchVideos).toHaveBeenCalledTimes(3); // all live, nothing dropped
    expect(res.poolBackfill.fellBackToLive).toBe(true);
    expect(res.poolBackfill.poolCandidates).toBe(0);
    expect(res.poolBackfill.liveCells).toBe(3);
    expect(res.queriesAttempted).toBe(3);
  });

  test('pool timeout → full live fallback', async () => {
    tsvectorKeywordCandidates.mockReturnValue(new Promise(() => {})); // never resolves

    const res = await runYouTubeFanout(
      fanoutInput({ V5_POOL_BACKFILL: 'true', V5_POOL_TIMEOUT_MS: '200' })
    );

    expect(res.poolBackfill.fellBackToLive).toBe(true);
    expect(searchVideos).toHaveBeenCalledTimes(3);
    expect(res.poolBackfill.poolQueryMs).toBeGreaterThanOrEqual(180);
  });

  test('Fork-1 gate: off-language pool candidate is dropped before counting toward the floor', async () => {
    // ko mandala: 2 valid + 1 Chinese-only title. Off-lang drop leaves 2 (< floor 3)
    // → cell NOT satisfied → q0 stays live, off-lang row absent from candidates.
    const koInput = { ...fanoutInput({ V5_POOL_BACKFILL: 'true' }), language: 'ko' as const };
    tsvectorKeywordCandidates.mockResolvedValue([
      poolCand(0, 'p0a', '한국어 제목 A'),
      poolCand(0, 'p0b', '한국어 제목 B'),
      poolCand(0, 'p0bad', '彩礼加倍重生'), // ≥2 Han, no Hangul → off-language drop
    ]);

    const res = await runYouTubeFanout(koInput);

    expect(searchVideos).toHaveBeenCalledTimes(3); // floor not met → q0 live
    expect(res.poolBackfill.poolCandidates).toBe(2); // off-lang dropped
    expect(res.candidates.map((c) => c.videoId)).not.toContain('p0bad');
    expect(res.candidates.map((c) => c.videoId)).toEqual(expect.arrayContaining(['p0a', 'p0b']));
  });
});
