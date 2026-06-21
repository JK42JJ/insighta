/**
 * segment-relevance-trigger — fan-out + stale-scope tests (§2-D #2).
 *
 * Locks:
 *   - one job per current segment (per placed video's v2 sections[]);
 *   - stale DELETE scoped to (mandala_id, the affected videos) — never other
 *     mandalas (James review check c);
 *   - the trigger does NO scoring (computeCardRelevance is never imported here).
 */

const mockGetMandalaById = jest.fn();
jest.mock('@/modules/mandala/manager', () => ({
  getMandalaManager: () => ({ getMandalaById: mockGetMandalaById }),
}));

const mockUvsFindMany = jest.fn();
const mockUlcFindMany = jest.fn();
const mockVrsFindMany = jest.fn();
const mockExec = jest.fn().mockResolvedValue(3);
jest.mock('@/modules/database/client', () => ({
  getPrismaClient: () => ({
    userVideoState: { findMany: mockUvsFindMany },
    user_local_cards: { findMany: mockUlcFindMany },
    video_rich_summaries: { findMany: mockVrsFindMany },
    $executeRawUnsafe: (...args: unknown[]) => mockExec(...args),
  }),
}));

const mockEnqueue = jest.fn().mockResolvedValue('job-x');
jest.mock('@/modules/queue/handlers/segment-relevance-fill', () => ({
  enqueueSegmentRelevanceFill: (...args: unknown[]) => mockEnqueue(...args),
}));

jest.mock('@/config/index', () => ({
  config: {
    database: { url: 'postgresql://postgres:pass@127.0.0.1:5432/postgres', directUrl: undefined },
    app: { isDevelopment: true, isProduction: false, isTest: true },
    queue: { relevanceBackfillConcurrency: 4 },
    paths: { logs: '/tmp' },
  },
}));

import { enqueueSegmentRelevanceForMandala } from '../../../src/modules/relevance/segment-relevance-trigger';

const MANDALA = '72d5fe52-2f35-4a9e-8ef6-cd21629173ef';
const USER = '0192fedf-85f4-47ab-a652-7fdd116e2b39';

beforeEach(() => {
  mockGetMandalaById.mockReset();
  mockUvsFindMany.mockReset();
  mockUlcFindMany.mockReset();
  mockVrsFindMany.mockReset();
  mockExec.mockClear();
  mockEnqueue.mockClear();
  mockGetMandalaById.mockResolvedValue({
    levels: [{ centerGoal: '요가', subjects: ['아침', '호흡'] }],
  });
});

describe('segment-relevance-trigger fan-out + stale scope', () => {
  it('enqueues one job per segment and scopes the stale DELETE to (mandala, videos)', async () => {
    mockUvsFindMany.mockResolvedValue([
      { cell_index: 0, video: { youtube_video_id: 'vidAAAAAAAA' } },
    ]);
    mockUlcFindMany.mockResolvedValue([]);
    mockVrsFindMany.mockResolvedValue([
      {
        video_id: 'vidAAAAAAAA',
        segments: {
          sections: [
            { from_sec: 0, to_sec: 60, title: 'S0', summary: 'a' },
            { from_sec: 60, to_sec: 120, title: 'S1', summary: 'b' },
          ],
        },
      },
    ]);

    const res = await enqueueSegmentRelevanceForMandala({ userId: USER, mandalaId: MANDALA });

    // 2 segments → 2 enqueues, no scoring done here
    expect(mockEnqueue).toHaveBeenCalledTimes(2);
    expect(res.segments).toBe(2);
    expect(res.enqueued).toBe(2);

    // stale DELETE scoped to this mandala + only the affected videos
    expect(mockExec).toHaveBeenCalledTimes(1);
    const [sql, mandalaArg, videosArg] = mockExec.mock.calls[0]!;
    expect(sql).toContain('DELETE FROM video_mandala_segment_relevance');
    expect(sql).toContain('mandala_id = $1::uuid');
    expect(sql).toContain('video_id = ANY($2::text[])');
    expect(mandalaArg).toBe(MANDALA);
    expect(videosArg).toEqual(['vidAAAAAAAA']);

    // each enqueue carries the cell's sub-goal + segment idx + time window
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        videoId: 'vidAAAAAAAA',
        mandalaId: MANDALA,
        segmentIdx: 0,
        fromSec: 0,
        toSec: 60,
        centerGoal: '요가',
        cellGoal: '아침',
      })
    );
  });

  it('returns early (no DELETE, no enqueue) when no placed videos', async () => {
    mockUvsFindMany.mockResolvedValue([]);
    mockUlcFindMany.mockResolvedValue([]);

    const res = await enqueueSegmentRelevanceForMandala({ userId: USER, mandalaId: MANDALA });

    expect(res).toEqual({ enqueued: 0, skipped: 0, videos: 0, segments: 0, staleDeleted: 0 });
    expect(mockExec).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('skips a video whose v2 row has no segments (honest skip)', async () => {
    mockUvsFindMany.mockResolvedValue([
      { cell_index: 1, video: { youtube_video_id: 'vidBBBBBBBB' } },
    ]);
    mockUlcFindMany.mockResolvedValue([]);
    mockVrsFindMany.mockResolvedValue([{ video_id: 'vidBBBBBBBB', segments: null }]);

    const res = await enqueueSegmentRelevanceForMandala({ userId: USER, mandalaId: MANDALA });
    expect(res.segments).toBe(0);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});
