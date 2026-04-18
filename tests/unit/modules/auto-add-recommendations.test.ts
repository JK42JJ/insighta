/**
 * auto-add-recommendations — selective replace tests
 *
 * Pins the eviction invariants from
 * docs/design/insighta-trend-recommendation-engine.md §14:
 *   - auto_added=true + user_note set      → preserved
 *   - auto_added=true + is_watched=true    → preserved
 *   - auto_added=true + watch_pos > 0      → preserved
 *   - auto_added=true + is_in_ideation=true → preserved (manual scratchpad)
 *   - auto_added=false                     → never deleted
 *   - every fresh rec in recommendation_cache → inserted (2026-04-18: no per-cell cap)
 *   - rec already linked to this user's youtube_videos → skipped (no duplicate)
 *   - idempotent: same recs upserted twice → no duplicate user_video_states
 *
 * Mocks Prisma at module load. The eviction `deleteMany` predicate is
 * inspected via mock.calls so we can verify the WHERE clause exactly.
 */

const mockSkillConfigFindFirst = jest.fn();
const mockRecCacheFindMany = jest.fn();
const mockUserVideoStateCount = jest.fn();
const mockUserVideoStateDeleteMany = jest.fn();
const mockUserVideoStateUpsert = jest.fn();
const mockYoutubeVideosUpsert = jest.fn();
const mockYoutubeVideosFindMany = jest.fn();
const mockRecCacheUpdateMany = jest.fn();

jest.mock('@/modules/database', () => ({
  getPrismaClient: () => ({
    user_skill_config: { findFirst: mockSkillConfigFindFirst },
    recommendation_cache: {
      findMany: mockRecCacheFindMany,
      updateMany: mockRecCacheUpdateMany,
    },
    userVideoState: {
      count: mockUserVideoStateCount,
      deleteMany: mockUserVideoStateDeleteMany,
      upsert: mockUserVideoStateUpsert,
    },
    youtube_videos: {
      upsert: mockYoutubeVideosUpsert,
      findMany: mockYoutubeVideosFindMany,
    },
  }),
}));

jest.mock('@/utils/logger', () => ({
  logger: {
    child: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

import { maybeAutoAddRecommendations } from '../../../src/modules/mandala/auto-add-recommendations';

const USER = '00000000-0000-0000-0000-000000000001';
const MANDALA = '00000000-0000-0000-0000-000000000002';

function makeRec(cellIndex: number, score: number, videoId: string) {
  return {
    id: `rec-${videoId}`,
    user_id: USER,
    mandala_id: MANDALA,
    cell_index: cellIndex,
    keyword: 'test',
    domain: null,
    video_id: videoId,
    title: `Title ${videoId}`,
    thumbnail: `https://img/${videoId}.jpg`,
    channel: 'Test Channel',
    channel_subs: null,
    view_count: null,
    like_ratio: null,
    duration_sec: 600,
    rec_score: score,
    iks_score: null,
    trend_keywords: [],
    rec_reason: null,
    status: 'pending',
    weight_version: 1,
    created_at: new Date(),
    expires_at: new Date(Date.now() + 86_400_000),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // default: enabled + auto_add true
  mockSkillConfigFindFirst.mockResolvedValue({
    enabled: true,
    config: { auto_add: true },
  });
  mockUserVideoStateCount.mockResolvedValue(0);
  mockUserVideoStateDeleteMany.mockResolvedValue({ count: 0 });
  mockYoutubeVideosUpsert.mockImplementation(({ where }) =>
    Promise.resolve({ id: `yt-uuid-${where.youtube_video_id}` })
  );
  // Default: no existing youtube_videos for this user → no rec is filtered.
  mockYoutubeVideosFindMany.mockResolvedValue([]);
  mockUserVideoStateUpsert.mockResolvedValue({});
  mockRecCacheUpdateMany.mockResolvedValue({ count: 0 });
});

describe('maybeAutoAddRecommendations — opt-in gates', () => {
  it('skips when user_skill_config row is missing', async () => {
    mockSkillConfigFindFirst.mockResolvedValue(null);
    const result = await maybeAutoAddRecommendations(USER, MANDALA);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not enabled/);
    expect(mockRecCacheFindMany).not.toHaveBeenCalled();
  });

  it('skips when video_discover skill is disabled', async () => {
    mockSkillConfigFindFirst.mockResolvedValue({ enabled: false, config: {} });
    const result = await maybeAutoAddRecommendations(USER, MANDALA);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not enabled/);
    expect(mockRecCacheFindMany).not.toHaveBeenCalled();
  });

  it('skips when config.auto_add is explicitly false', async () => {
    mockSkillConfigFindFirst.mockResolvedValue({
      enabled: true,
      config: { auto_add: false },
    });
    const result = await maybeAutoAddRecommendations(USER, MANDALA);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/auto_add disabled/);
    expect(mockRecCacheFindMany).not.toHaveBeenCalled();
  });

  it('defaults auto_add ON when key is missing from config', async () => {
    mockSkillConfigFindFirst.mockResolvedValue({ enabled: true, config: {} });
    mockRecCacheFindMany.mockResolvedValue([makeRec(0, 0.9, 'v1')]);
    const result = await maybeAutoAddRecommendations(USER, MANDALA);
    expect(result.ok).toBe(true);
    expect(result.rowsInserted).toBe(1);
  });
});

describe('maybeAutoAddRecommendations — empty paths', () => {
  it('returns ok=false when no recommendation_cache rows exist', async () => {
    mockRecCacheFindMany.mockResolvedValue([]);
    const result = await maybeAutoAddRecommendations(USER, MANDALA);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no pending/);
  });
});

describe('maybeAutoAddRecommendations — selective replace invariants', () => {
  beforeEach(() => {
    mockRecCacheFindMany.mockResolvedValue([
      makeRec(0, 0.9, 'v1'),
      makeRec(0, 0.8, 'v2'),
      makeRec(0, 0.7, 'v3'),
    ]);
  });

  it('only deletes rows with NO user trace (4-condition AND)', async () => {
    await maybeAutoAddRecommendations(USER, MANDALA);

    // Inspect the deleteMany call for cell 0 (first one in the loop)
    const cell0DeleteCall = mockUserVideoStateDeleteMany.mock.calls.find(
      (c) => c[0]?.where?.cell_index === 0
    );
    expect(cell0DeleteCall).toBeDefined();
    const where = cell0DeleteCall?.[0].where;
    expect(where.user_id).toBe(USER);
    expect(where.mandala_id).toBe(MANDALA);
    expect(where.auto_added).toBe(true);
    expect(where.user_note).toBeNull();
    expect(where.is_watched).toBe(false);
    expect(where.watch_position_seconds).toBe(0);
    expect(where.is_in_ideation).toBe(false);
  });

  it('NEVER deletes auto_added=false rows (manual cards untouched)', async () => {
    await maybeAutoAddRecommendations(USER, MANDALA);

    for (const call of mockUserVideoStateDeleteMany.mock.calls) {
      expect(call[0].where.auto_added).toBe(true);
    }
  });

  it('inserts every fresh recommendation regardless of preserve count (2026-04-18)', async () => {
    // 3 preserved rows in cell 0 — pre-2026-04-18 this would have capped the
    // insert to 0. After the AUTO_ADD_PER_CELL removal, every rec in
    // recommendation_cache is inserted (unique-constraint dedup still
    // prevents duplicates).
    mockUserVideoStateCount.mockImplementation(({ where }) =>
      Promise.resolve(where.cell_index === 0 ? 3 : 0)
    );

    await maybeAutoAddRecommendations(USER, MANDALA);

    const cell0Inserts = mockUserVideoStateUpsert.mock.calls.filter(
      (c) => c[0]?.create?.cell_index === 0
    );
    // All three recs for cell 0 (v1, v2, v3) are attempted.
    expect(cell0Inserts).toHaveLength(3);
  });

  it('inserts every fresh rec when some cell rows are preserved (partial)', async () => {
    // Post-2026-04-18: partial preservation no longer shrinks the insert
    // count. 1 preserved + 3 recs → 3 inserts (preserved row is separately
    // retained by the DELETE predicate; all 3 fresh recs go in).
    mockUserVideoStateCount.mockImplementation(({ where }) =>
      Promise.resolve(where.cell_index === 0 ? 1 : 0)
    );

    await maybeAutoAddRecommendations(USER, MANDALA);

    const cell0Inserts = mockUserVideoStateUpsert.mock.calls.filter(
      (c) => c[0]?.create?.cell_index === 0
    );
    expect(cell0Inserts).toHaveLength(3);
    for (const vid of ['v1', 'v2', 'v3']) {
      expect(mockYoutubeVideosUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { youtube_video_id: vid } })
      );
    }
  });

  it('marks inserted rows with auto_added=true on create', async () => {
    await maybeAutoAddRecommendations(USER, MANDALA);

    for (const call of mockUserVideoStateUpsert.mock.calls) {
      expect(call[0].create.auto_added).toBe(true);
    }
  });

  it('does NOT touch user_note/is_watched/watch_position on update path', async () => {
    await maybeAutoAddRecommendations(USER, MANDALA);

    for (const call of mockUserVideoStateUpsert.mock.calls) {
      const updateData = call[0].update;
      expect(updateData.user_note).toBeUndefined();
      expect(updateData.is_watched).toBeUndefined();
      expect(updateData.watch_position_seconds).toBeUndefined();
    }
  });
});

describe('maybeAutoAddRecommendations — edge: skip recs whose video already exists', () => {
  it('passes over a candidate already linked to this user (would otherwise waste a slot)', async () => {
    mockRecCacheFindMany.mockResolvedValue([
      makeRec(0, 0.9, 'v1'),
      makeRec(0, 0.8, 'v2'),
      makeRec(0, 0.7, 'v3'),
    ]);
    // Existing youtube_videos rows for this user — v1 + v2 already linked.
    mockYoutubeVideosFindMany.mockResolvedValue([
      { youtube_video_id: 'v1' },
      { youtube_video_id: 'v2' },
    ]);
    // Post-2026-04-18: preservation no longer affects insert count. Only
    // the dedup filter matters — v1/v2 already linked to this user's
    // youtube_videos, so only v3 is inserted.
    mockUserVideoStateCount.mockImplementation(({ where }) =>
      Promise.resolve(where.cell_index === 0 ? 1 : 0)
    );

    await maybeAutoAddRecommendations(USER, MANDALA);

    const cell0Inserts = mockUserVideoStateUpsert.mock.calls.filter(
      (c) => c[0]?.create?.cell_index === 0
    );
    // Only the un-linked v3 is upserted into cell 0
    expect(cell0Inserts).toHaveLength(1);
    expect(mockYoutubeVideosUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { youtube_video_id: 'v3' } })
    );
  });
});

describe('maybeAutoAddRecommendations — bookkeeping', () => {
  it('marks consumed recs as shown when rows were inserted', async () => {
    mockRecCacheFindMany.mockResolvedValue([makeRec(0, 0.9, 'v1')]);
    await maybeAutoAddRecommendations(USER, MANDALA);
    expect(mockRecCacheUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'pending' }),
        data: { status: 'shown' },
      })
    );
  });

  it('skips status update when nothing was inserted', async () => {
    // Post-2026-04-18: "no insert" is produced only when every candidate
    // video is already linked to this user's youtube_videos (dedup filter).
    mockRecCacheFindMany.mockResolvedValue([makeRec(0, 0.9, 'v1')]);
    mockYoutubeVideosFindMany.mockResolvedValue([{ youtube_video_id: 'v1' }]);
    await maybeAutoAddRecommendations(USER, MANDALA);
    expect(mockRecCacheUpdateMany).not.toHaveBeenCalled();
  });
});
