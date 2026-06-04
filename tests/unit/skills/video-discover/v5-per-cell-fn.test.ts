/**
 * CP494 안 A — tsvectorKeywordCandidatesPerCell unit tests.
 *
 * The per-cell pool match: each cell's query runs its OWN tsquery with its OWN
 * top-N (one LATERAL round-trip), and cellIndex comes from the query (no argmax
 * drop). Verifies row→KeywordCandidate mapping, the empty-token short-circuit,
 * and non-fatal error handling. $queryRaw is mocked (no DB).
 */

const mockQueryRaw = jest.fn();

jest.mock('@/modules/database/client', () => ({
  getPrismaClient: () => ({ $queryRaw: mockQueryRaw }),
}));
jest.mock('@/modules/discover-tracing', () => ({ recordTrace: jest.fn() }));

import { tsvectorKeywordCandidatesPerCell } from '@/skills/plugins/video-discover/v3/hybrid-rerank';

describe('tsvectorKeywordCandidatesPerCell (CP494 안 A)', () => {
  beforeEach(() => mockQueryRaw.mockReset());

  test('empty / token-less queries → [] without hitting the DB', async () => {
    const out = await tsvectorKeywordCandidatesPerCell(
      [
        { cellIndex: 0, query: '   ' },
        { cellIndex: 1, query: '&|()' }, // all stripped → no token
      ],
      [],
      8,
      ['v2_promoted']
    );
    expect(out).toEqual([]);
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });

  test('maps rows → KeywordCandidate, cellIndex from row, bigint → number', async () => {
    mockQueryRaw.mockResolvedValue([
      {
        cell_index: 2,
        video_id: 'v1',
        title: 't1',
        description: 'd1',
        channel_name: 'ch',
        channel_id: 'chid',
        thumbnail_url: 'thumb',
        view_count: BigInt(1234),
        like_count: BigInt(56),
        duration_seconds: 300,
        published_at: null,
        rank: 0.42,
      },
    ]);

    const out = await tsvectorKeywordCandidatesPerCell(
      [{ cellIndex: 2, query: '러닝 달리기' }],
      [],
      8,
      ['v2_promoted', 'batch_trend']
    );

    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      videoId: 'v1',
      cellIndex: 2, // from row.cell_index (NOT argmax)
      viewCount: 1234, // bigint → number
      likeCount: 56,
      rec_score: 0.42, // from rank
    });
  });

  test('only cells with usable tokens are queried (empty ones dropped)', async () => {
    mockQueryRaw.mockResolvedValue([]);
    await tsvectorKeywordCandidatesPerCell(
      [
        { cellIndex: 0, query: 'valid query' },
        { cellIndex: 1, query: '   ' }, // dropped
      ],
      [],
      8,
      ['v2_promoted']
    );
    // still queried once (cell 0 survived); empty cell never reached SQL.
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });

  test('$queryRaw throws → returns [] (non-fatal, falls back to live upstream)', async () => {
    mockQueryRaw.mockRejectedValue(new Error('db down'));
    const out = await tsvectorKeywordCandidatesPerCell([{ cellIndex: 0, query: 'q' }], [], 8, [
      'v2_promoted',
    ]);
    expect(out).toEqual([]);
  });
});
