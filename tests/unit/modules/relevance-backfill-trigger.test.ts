/**
 * relevance-backfill-trigger tests — CP498 PR3b.
 *
 * THE regression guard (James, CP499): relevance is a relation
 * (video × this row's centerGoal), not a video attribute. So the fan-out unit
 * MUST be the ROW, never the video id. If anyone re-introduces a
 * rich-summary-trigger-style uniqueByVideo dedup, the "same video in two rows ⇒
 * two enqueues" test below breaks. Also locks: dual-table fan-out, centerGoal
 * passthrough, and the cutoff filter (auto vs admin).
 */

// ============================================================================
// Mocks (before imports)
// ============================================================================

const mockUvsFindMany = jest.fn();
const mockUlcFindMany = jest.fn();
jest.mock('@/modules/database/client', () => ({
  getPrismaClient: () => ({
    userVideoState: { findMany: mockUvsFindMany },
    user_local_cards: { findMany: mockUlcFindMany },
  }),
}));

const mockGetMandalaById = jest.fn();
jest.mock('@/modules/mandala/manager', () => ({
  getMandalaManager: () => ({ getMandalaById: mockGetMandalaById }),
}));

const mockEnqueue = jest.fn().mockResolvedValue('job-id');
jest.mock('@/modules/queue/handlers/enrich-relevance-quick', () => ({
  enqueueRelevanceQuick: (...args: unknown[]) => mockEnqueue(...args),
}));

jest.mock('@/utils/logger', () => ({
  logger: {
    child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
  },
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { enqueueRelevanceBackfillForMandala } from '../../../src/modules/relevance/relevance-backfill-trigger';

beforeEach(() => {
  jest.clearAllMocks();
  mockGetMandalaById.mockResolvedValue({ levels: [{ centerGoal: 'become a better engineer' }] });
  mockUvsFindMany.mockResolvedValue([]);
  mockUlcFindMany.mockResolvedValue([]);
});

describe('enqueueRelevanceBackfillForMandala — row-not-video fan-out (regression guard)', () => {
  test('same video_id in two uvs rows ⇒ TWO enqueues with distinct rowIds (no video dedup)', async () => {
    // Both rows are the SAME underlying video (same title) in different cells.
    // A uniqueByVideo dedup would collapse these to one enqueue — that is the
    // bug this test exists to catch.
    mockUvsFindMany.mockResolvedValueOnce([
      { id: 'uvs-row-A', video: { title: 'Same Video Title' } },
      { id: 'uvs-row-B', video: { title: 'Same Video Title' } },
    ]);

    const result = await enqueueRelevanceBackfillForMandala({
      userId: 'u1',
      mandalaId: 'm1',
      applyCutoff: false,
    });

    expect(mockEnqueue).toHaveBeenCalledTimes(2);
    const rowIds = mockEnqueue.mock.calls.map((c) => (c[0] as { rowId: string }).rowId).sort();
    expect(rowIds).toEqual(['uvs-row-A', 'uvs-row-B']);
    // each carries table=uvs + the shared centerGoal
    for (const call of mockEnqueue.mock.calls) {
      expect(call[0]).toMatchObject({ table: 'uvs', centerGoal: 'become a better engineer' });
    }
    expect(result.enqueued).toBe(2);
    expect(result.uvsRows).toBe(2);
  });

  test('dual-table: uvs (title-only) + ulc (title + description) both fan out', async () => {
    mockUvsFindMany.mockResolvedValueOnce([{ id: 'uvs-1', video: { title: 'UVS title' } }]);
    mockUlcFindMany.mockResolvedValueOnce([
      { id: 'ulc-1', title: 'ULC title', metadata_title: null, metadata_description: 'ULC desc' },
    ]);

    const result = await enqueueRelevanceBackfillForMandala({
      userId: 'u1',
      mandalaId: 'm1',
      applyCutoff: false,
    });

    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ table: 'uvs', rowId: 'uvs-1', title: 'UVS title' })
    );
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        table: 'ulc',
        rowId: 'ulc-1',
        title: 'ULC title',
        description: 'ULC desc',
      })
    );
    expect(result).toMatchObject({ enqueued: 2, uvsRows: 1, ulcRows: 1 });
  });

  test('ulc title falls back to metadata_title when title is null', async () => {
    mockUlcFindMany.mockResolvedValueOnce([
      { id: 'ulc-2', title: null, metadata_title: 'Meta Title', metadata_description: null },
    ]);

    await enqueueRelevanceBackfillForMandala({ userId: 'u1', mandalaId: 'm1', applyCutoff: false });

    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ table: 'ulc', rowId: 'ulc-2', title: 'Meta Title' })
    );
  });
});

describe('cutoff filter (auto vs admin)', () => {
  test('applyCutoff=true ⇒ both queries filter created_at > cutoff', async () => {
    await enqueueRelevanceBackfillForMandala({
      userId: 'u1',
      mandalaId: 'm1',
      applyCutoff: true,
      cutoff: '2026-06-08T00:00:00.000Z',
    });

    const uvsWhere = mockUvsFindMany.mock.calls[0][0].where;
    const ulcWhere = mockUlcFindMany.mock.calls[0][0].where;
    expect(uvsWhere.createdAt).toEqual({ gt: new Date('2026-06-08T00:00:00.000Z') });
    expect(ulcWhere.created_at).toEqual({ gt: new Date('2026-06-08T00:00:00.000Z') });
    // always-on filters
    expect(uvsWhere).toMatchObject({ cell_index: { gte: 0 }, relevance_pct: null });
    expect(ulcWhere).toMatchObject({ cell_index: { gte: 0 }, relevance_pct: null });
  });

  test('applyCutoff=false (admin) ⇒ no created_at filter on either table', async () => {
    await enqueueRelevanceBackfillForMandala({ userId: 'u1', mandalaId: 'm1', applyCutoff: false });

    expect(mockUvsFindMany.mock.calls[0][0].where.createdAt).toBeUndefined();
    expect(mockUlcFindMany.mock.calls[0][0].where.created_at).toBeUndefined();
  });
});
