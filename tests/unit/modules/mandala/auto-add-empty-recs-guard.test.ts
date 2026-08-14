/**
 * CP512-incident regression (2026-07-10): auto-add must NOT delete a cell's
 * existing auto_added cards when discover returned NO new recs for that cell.
 * The old loop ran deleteMany BEFORE the empty-recs check, so a quota-429 /
 * empty discover (or an orphaned run) deleted the un-touched cards with no
 * replacement → card loss (james@insighta.one "수채화" 41 → 2).
 */
import { maybeAutoAddRecommendations } from '@/modules/mandala/auto-add-recommendations';

const mockFindMany = jest.fn();
const mockCount = jest.fn().mockResolvedValue(0);
const mockDeleteMany = jest.fn().mockResolvedValue({ count: 0 });
const mockPlace = jest.fn().mockResolvedValue({ inserted: 0 });

jest.mock('@/modules/database', () => ({
  getPrismaClient: () => ({
    user_skill_config: {
      findFirst: jest.fn().mockResolvedValue({ enabled: true, config: { auto_add: true } }),
    },
    recommendation_cache: { findMany: (...a: unknown[]) => mockFindMany(...a) },
    userVideoState: {
      count: (...a: unknown[]) => mockCount(...a),
      deleteMany: (...a: unknown[]) => mockDeleteMany(...a),
    },
  }),
}));
jest.mock('@/modules/mandala/place-auto-added-cards', () => ({
  placeAutoAddedCards: (...a: unknown[]) => mockPlace(...a),
}));
jest.mock('@/config/recommendations', () => ({
  VIDEO_DISCOVER_SKILL_TYPE: 'video-discover',
  loadAutoAddGuardConfig: () => ({}),
}));
jest.mock('@/modules/discover-tracing', () => ({ recordTrace: jest.fn() }));

const rec = (cell: number) => ({
  id: `rec-${cell}`,
  video_id: `vid${cell}`,
  title: 't',
  thumbnail: null,
  channel: null,
  duration_sec: null,
  view_count: null,
  published_at: null,
  like_ratio: null,
  rec_score: 1,
  keyword: null,
  rec_reason: null,
  weight_version: 1,
  cell_index: cell,
});

describe('maybeAutoAddRecommendations — empty-recs guard (CP512 regression)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('deletes ONLY the cell that has new recs, never the empty cells', async () => {
    // discover returned recs for cell 3 only; cells 0..2,4..7 are empty.
    mockFindMany.mockResolvedValue([rec(3)]);

    await maybeAutoAddRecommendations('u-1', 'm-1');

    // pre-fix: 8 deletes (one per cell). post-fix: exactly 1 (cell 3).
    expect(mockDeleteMany).toHaveBeenCalledTimes(1);
    expect(mockDeleteMany.mock.calls[0][0].where.cell_index).toBe(3);
    expect(mockPlace).toHaveBeenCalledTimes(1);
  });

  test('discover empty for every cell → NO deletes at all (cards preserved)', async () => {
    // A non-empty rec set that maps to NO valid cells (out-of-range index) —
    // exercises the per-cell guard rather than the whole-run early return.
    mockFindMany.mockResolvedValue([{ ...rec(3), cell_index: 99 }]);

    await maybeAutoAddRecommendations('u-1', 'm-1');

    expect(mockDeleteMany).not.toHaveBeenCalled();
    expect(mockPlace).not.toHaveBeenCalled();
  });
});
