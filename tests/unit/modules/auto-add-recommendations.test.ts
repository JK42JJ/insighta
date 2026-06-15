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

const mockCollectAndUpsertMetadata = jest.fn();
jest.mock('@/modules/youtube/metadata-collector', () => ({
  collectAndUpsertMetadata: (...args: unknown[]) => mockCollectAndUpsertMetadata(...args),
}));

import { maybeAutoAddRecommendations } from '../../../src/modules/mandala/auto-add-recommendations';
import { passesViewCountGate } from '../../../src/config/recommendations';

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
  // Meta enrich defaults to a successful no-op; only called when
  // AUTO_ADD_META_ENRICH=true (default off → never invoked).
  mockCollectAndUpsertMetadata.mockResolvedValue({
    videoIds: [],
    fetched: 0,
    upserted: 0,
    errors: 0,
  });
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

// ───────────────────────────────────────────────────────────────────────────
// CP500+ chokepoint guards: view-count gate + meta enrich.
// Diagnosis: v5 live 'realtime' auto-add bypassed the pool's view floor + meta
// ingest (mandala bdc5505f: 13/43 recs <1k views, a 2-view scribble scored 65%;
// 49/49 metadata_fetched_at NULL). Gate sits at the single auto-add confluence.
// ───────────────────────────────────────────────────────────────────────────
describe('passesViewCountGate — pure predicate', () => {
  it('blocks a 2-view video at floor 1000', () => {
    expect(passesViewCountGate(2, 1000)).toBe(false);
    expect(passesViewCountGate(2n, 1000)).toBe(false);
  });
  it('passes a video at/above floor 1000', () => {
    expect(passesViewCountGate(1000, 1000)).toBe(true);
    expect(passesViewCountGate(1001, 1000)).toBe(true);
  });
  it('fail-open: null/undefined view passes (enrich failed or absent)', () => {
    expect(passesViewCountGate(null, 1000)).toBe(true);
    expect(passesViewCountGate(undefined, 1000)).toBe(true);
  });
  it('no-op when floor <= 0 (default disabled)', () => {
    expect(passesViewCountGate(2, 0)).toBe(true);
  });
});

describe('maybeAutoAddRecommendations — view-count gate (CP500+)', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  // (1) 2뷰 차단 + (2) 1001뷰 통과
  it('blocks the 2-view rec and materializes only the 1001-view rec at floor 1000', async () => {
    process.env['AUTO_ADD_MIN_VIEW_COUNT'] = '1000';
    mockRecCacheFindMany.mockResolvedValue([makeRec(0, 0.9, 'low'), makeRec(0, 0.8, 'high')]);
    mockYoutubeVideosFindMany
      .mockResolvedValueOnce([]) // dedup
      .mockResolvedValueOnce([]) // (a) existing — all new
      .mockResolvedValueOnce([
        { id: 'yt-low', youtube_video_id: 'low', view_count: 2n },
        { id: 'yt-high', youtube_video_id: 'high', view_count: 1001n },
      ]); // (c) refetch with authoritative view_count
    mockYoutubeVideosCreateMany.mockResolvedValue({ count: 2 });
    mockUserVideoStateCreateMany.mockResolvedValue({ count: 1 });

    const result = await maybeAutoAddRecommendations(USER, MANDALA);

    const createCall = mockUserVideoStateCreateMany.mock.calls.find(
      (c) => (c[0]?.data as Array<{ cell_index: number }>)?.[0]?.cell_index === 0
    );
    const rows = (createCall?.[0].data as Array<{ videoId: string }>) ?? [];
    expect(rows.length).toBe(1);
    expect(rows[0]?.videoId).toBe('yt-high');
    expect(result.ok).toBe(true);
  });

  // (3) 유저-터치(이미 링크된) 2뷰 카드 보존 — dedup 선제외로 게이트가 못 봄
  it('a 2-view card already linked to the user is deduped out before the gate — never re-evaluated/dropped by it', async () => {
    process.env['AUTO_ADD_MIN_VIEW_COUNT'] = '1000';
    mockRecCacheFindMany.mockResolvedValue([makeRec(0, 0.9, 'touched')]);
    // dedup (call 1) reports it already linked → cellRecs empty → loop continues
    // before the gate ever runs. The existing uvs row is untouched by this module.
    mockYoutubeVideosFindMany.mockResolvedValueOnce([{ youtube_video_id: 'touched' }]);

    const result = await maybeAutoAddRecommendations(USER, MANDALA);

    expect(mockUserVideoStateCreateMany).not.toHaveBeenCalled();
    expect(mockCollectAndUpsertMetadata).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  // (4) wizard inline reach — 동일 공유 함수라 caller 무관하게 게이트 상속
  it('gate lives inside the shared function — wizard inline auto-add inherits it', async () => {
    // wizard-precompute.consumePrecompute calls maybeAutoAddRecommendations
    // inline (#879), so a floor set here applies to the wizard path identically.
    process.env['AUTO_ADD_MIN_VIEW_COUNT'] = '1000';
    mockRecCacheFindMany.mockResolvedValue([makeRec(0, 0.9, 'low')]);
    mockYoutubeVideosFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'yt-low', youtube_video_id: 'low', view_count: 2n }]);

    const result = await maybeAutoAddRecommendations(USER, MANDALA);

    // 2-view filtered → cell yields no survivors → no card materialized.
    expect(mockUserVideoStateCreateMany).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  // (5) fail-open 재실행 무중복 — enrich 실패 시 카드 생성 + skipDuplicates
  it('meta-enrich failure is fail-open (card created) and createMany stays skipDuplicates (re-run safe)', async () => {
    process.env['AUTO_ADD_MIN_VIEW_COUNT'] = '1000';
    process.env['AUTO_ADD_META_ENRICH'] = 'true';
    mockCollectAndUpsertMetadata.mockRejectedValue(new Error('quota exceeded'));
    mockRecCacheFindMany.mockResolvedValue([makeRec(0, 0.9, 'v1')]);
    mockYoutubeVideosFindMany
      .mockResolvedValueOnce([]) // dedup
      .mockResolvedValueOnce([]) // (a) existing — all new (so enrich attempted)
      .mockResolvedValueOnce([{ id: 'yt-v1', youtube_video_id: 'v1', view_count: null }]); // post-enrich still null (failed)
    mockYoutubeVideosCreateMany.mockResolvedValue({ count: 1 });
    mockUserVideoStateCreateMany.mockResolvedValue({ count: 1 });

    const result = await maybeAutoAddRecommendations(USER, MANDALA);

    expect(mockCollectAndUpsertMetadata).toHaveBeenCalledWith(['v1']);
    const createCall = mockUserVideoStateCreateMany.mock.calls[0];
    expect(createCall?.[0].skipDuplicates).toBe(true);
    // null view → fail-open → the card is still created.
    expect((createCall?.[0].data as unknown[]).length).toBe(1);
    expect(result.ok).toBe(true);
  });
});
