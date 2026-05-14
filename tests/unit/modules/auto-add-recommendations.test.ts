/**
 * auto-add-recommendations — selective replace tests
 *
 * Pins the eviction invariants from
 * docs/design/insighta-trend-recommendation-engine.md §14:
 *   - auto_added=true + pinned_at set          → preserved (T2-1 bug fix)
 *   - auto_added=true + user_note set          → preserved
 *   - auto_added=true + is_watched=true        → preserved
 *   - auto_added=true + watch_pos > 0          → preserved
 *   - auto_added=true + is_in_ideation=true    → preserved (manual scratchpad)
 *   - auto_added=false                         → never deleted
 *   - every fresh rec in recommendation_cache  → inserted (2026-04-18: no per-cell cap)
 *   - rec already linked to this user's youtube_videos → skipped (no duplicate)
 *   - idempotent: same recs inserted twice → no duplicate user_video_states
 *
 * Mocks Prisma at module load. The eviction `deleteMany` predicate is
 * inspected via mock.calls so we can verify the WHERE clause exactly.
 *
 * NOTE: The implementation uses bulk createMany (not upsert) since the
 * 2026-05-13 Phase D pipeline speedup. Per-cell youtube_videos.findMany is
 * called 3 times: (1) dedup check, (2) existing-ids lookup, (3) re-fetch ids.
 */

const mockSkillConfigFindFirst = jest.fn();
const mockRecCacheFindMany = jest.fn();
const mockUserVideoStateCount = jest.fn();
const mockUserVideoStateDeleteMany = jest.fn();
const mockUserVideoStateCreateMany = jest.fn();
const mockYoutubeVideosFindMany = jest.fn();
const mockYoutubeVideosCreateMany = jest.fn();
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
      createMany: mockUserVideoStateCreateMany,
    },
    youtube_videos: {
      findMany: mockYoutubeVideosFindMany,
      createMany: mockYoutubeVideosCreateMany,
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

jest.mock('@/modules/recommendations/publisher', () => ({
  notifyCardAdded: jest.fn(),
}));

jest.mock('@/modules/discover-tracing', () => ({
  recordTrace: jest.fn(),
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
    published_at: null,
    created_at: new Date(),
    expires_at: new Date(Date.now() + 86_400_000),
  };
}

/**
 * Default mock chain for a single cell with the given videoIds.
 * youtube_videos.findMany is called 3 times per cell that has recs:
 *   call 1 — dedup check (userState filter): return []  → no existing user-linked vids
 *   call 2 — step (a) existing ids:          return []  → all are new yt rows
 *   call 3 — step (c) re-fetch ids:          return rows with id + youtube_video_id
 */
function setupSingleCellMocks(videoIds: string[]) {
  const refetchRows = videoIds.map((vid) => ({ id: `yt-uuid-${vid}`, youtube_video_id: vid }));
  mockYoutubeVideosFindMany
    .mockResolvedValueOnce([]) // call 1: dedup check
    .mockResolvedValueOnce([]) // call 2: step (a) — all new
    .mockResolvedValueOnce(refetchRows); // call 3: step (c) re-fetch
  mockYoutubeVideosCreateMany.mockResolvedValue({ count: videoIds.length });
  mockUserVideoStateCreateMany.mockResolvedValue({ count: videoIds.length });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSkillConfigFindFirst.mockResolvedValue({
    enabled: true,
    config: { auto_add: true },
  });
  mockUserVideoStateCount.mockResolvedValue(0);
  mockUserVideoStateDeleteMany.mockResolvedValue({ count: 0 });
  mockYoutubeVideosCreateMany.mockResolvedValue({ count: 0 });
  mockUserVideoStateCreateMany.mockResolvedValue({ count: 0 });
  mockRecCacheUpdateMany.mockResolvedValue({ count: 0 });
  // Default: no existing youtube_videos for dedup / existing checks
  mockYoutubeVideosFindMany.mockResolvedValue([]);
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
    setupSingleCellMocks(['v1']);
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
    setupSingleCellMocks(['v1', 'v2', 'v3']);
  });

  it('only deletes rows with NO user trace — 5-condition AND including pinned_at', async () => {
    await maybeAutoAddRecommendations(USER, MANDALA);

    const cell0DeleteCall = mockUserVideoStateDeleteMany.mock.calls.find(
      (c) => c[0]?.where?.cell_index === 0
    );
    expect(cell0DeleteCall).toBeDefined();
    const where = cell0DeleteCall?.[0].where;
    expect(where.user_id).toBe(USER);
    expect(where.mandala_id).toBe(MANDALA);
    expect(where.auto_added).toBe(true);
    // pinned_at: null ensures bookmarked rows survive eviction (T2-1 fix)
    expect(where.pinned_at).toBeNull();
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

  it('marks inserted rows with auto_added=true', async () => {
    await maybeAutoAddRecommendations(USER, MANDALA);

    const createCall = mockUserVideoStateCreateMany.mock.calls.find((c) =>
      (c[0]?.data as Array<{ cell_index: number }>)?.some((r) => r.cell_index === 0)
    );
    expect(createCall).toBeDefined();
    for (const row of (createCall?.[0].data as Array<{ auto_added: boolean }>) ?? []) {
      expect(row.auto_added).toBe(true);
    }
  });
});

describe('maybeAutoAddRecommendations — pinned_at preservation (T2-1 regression)', () => {
  it('deleteMany WHERE includes pinned_at: null — pinned rows are never evicted', async () => {
    // A pinned card has auto_added=true, pinned_at=<timestamp>, no other trace.
    // The fix: deleteMany WHERE must include pinned_at: null so pinned rows match nothing.
    mockRecCacheFindMany.mockResolvedValue([makeRec(0, 0.9, 'v1')]);
    setupSingleCellMocks(['v1']);

    await maybeAutoAddRecommendations(USER, MANDALA);

    // Every deleteMany call must include pinned_at: null.
    // Rows where pinned_at IS NOT NULL will NOT match → they survive.
    for (const call of mockUserVideoStateDeleteMany.mock.calls) {
      expect(call[0].where.pinned_at).toBeNull();
    }
  });

  it('preservation count query OR block includes pinned_at: { not: null }', async () => {
    mockRecCacheFindMany.mockResolvedValue([makeRec(0, 0.9, 'v1')]);
    setupSingleCellMocks(['v1']);

    await maybeAutoAddRecommendations(USER, MANDALA);

    const cell0CountCall = mockUserVideoStateCount.mock.calls.find(
      (c) => c[0]?.where?.cell_index === 0
    );
    expect(cell0CountCall).toBeDefined();
    const orBlock = cell0CountCall?.[0].where.OR as Array<Record<string, unknown>>;
    // OR must contain { pinned_at: { not: null } }
    const hasPinnedAtClause = orBlock?.some(
      (clause) =>
        'pinned_at' in clause && (clause['pinned_at'] as Record<string, unknown>)?.['not'] === null
    );
    expect(hasPinnedAtClause).toBe(true);
  });
});

describe('maybeAutoAddRecommendations — edge: skip recs whose video already exists', () => {
  it('passes over candidates already linked to this user (dedup filter)', async () => {
    mockRecCacheFindMany.mockResolvedValue([
      makeRec(0, 0.9, 'v1'),
      makeRec(0, 0.8, 'v2'),
      makeRec(0, 0.7, 'v3'),
    ]);
    // call 1 — dedup check: v1 + v2 already linked to this user's youtube_videos
    // → cellRecs becomes [v3] only
    // call 2 — step (a) existing ids for [v3]: empty (v3 is brand new)
    // call 3 — step (c) re-fetch ids for [v3]: return row
    mockYoutubeVideosFindMany
      .mockResolvedValueOnce([{ youtube_video_id: 'v1' }, { youtube_video_id: 'v2' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'yt-uuid-v3', youtube_video_id: 'v3' }]);
    mockYoutubeVideosCreateMany.mockResolvedValue({ count: 1 });
    mockUserVideoStateCreateMany.mockResolvedValue({ count: 1 });

    const result = await maybeAutoAddRecommendations(USER, MANDALA);

    // createMany for cell 0 should have exactly 1 row (v3 only)
    const cell0CreateCall = mockUserVideoStateCreateMany.mock.calls.find(
      (c) => (c[0]?.data as Array<{ cell_index: number }>)?.[0]?.cell_index === 0
    );
    expect(cell0CreateCall).toBeDefined();
    expect((cell0CreateCall?.[0].data as unknown[]).length).toBe(1);
    expect(result.ok).toBe(true);
  });
});

describe('maybeAutoAddRecommendations — bookkeeping', () => {
  it('marks consumed recs as shown when rows were inserted', async () => {
    mockRecCacheFindMany.mockResolvedValue([makeRec(0, 0.9, 'v1')]);
    setupSingleCellMocks(['v1']);

    await maybeAutoAddRecommendations(USER, MANDALA);

    expect(mockRecCacheUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'pending' }),
        data: { status: 'shown' },
      })
    );
  });

  it('skips status update when nothing was inserted', async () => {
    // "no insert" when every candidate video is already linked to this user.
    // dedup check (call 1) returns v1 as already-linked → cellRecs is empty →
    // the cell loop hits `if (cellRecs.length === 0) continue` → createMany never called.
    mockRecCacheFindMany.mockResolvedValue([makeRec(0, 0.9, 'v1')]);
    mockYoutubeVideosFindMany.mockResolvedValueOnce([{ youtube_video_id: 'v1' }]);
    // No further findMany calls since the loop continues early.

    await maybeAutoAddRecommendations(USER, MANDALA);

    expect(mockRecCacheUpdateMany).not.toHaveBeenCalled();
  });
});
