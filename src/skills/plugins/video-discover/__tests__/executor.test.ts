/**
 * video-discover — executor tests (Phase 3)
 *
 * Mocks:
 *   - @/modules/database (Prisma — user_mandalas, youtube_sync_settings,
 *     recommendation_cache.upsert, $queryRaw for vector loads)
 *   - global fetch routed by URL: googleapis.com/youtube/v3/search vs videos
 *
 * Pins the contract that matters for Phase 3:
 *   - preflight FAILS when YouTube OAuth not connected
 *   - preflight FAILS when token expired
 *   - preflight FAILS when mandala has no sub_goal embeddings
 *   - preflight FAILS when keyword_scores has no embedded rows
 *   - execute calls search.list per cell × keyword (8 cells × 1 kw = 8 calls)
 *   - execute calls videos.list ONCE batched
 *   - upsert by composite (user_id, mandala_id, video_id)
 *   - per_mandala_relevance stored in trend_keywords JSONB
 *   - diversity: same channel within a cell deduplicated
 */

const mockUserMandalaFindFirst = jest.fn();
const mockOauthFindUnique = jest.fn();
const mockQueryRaw = jest.fn();
const mockRecCacheUpsert = jest.fn();

jest.mock('@/modules/database', () => ({
  getPrismaClient: () => ({
    user_mandalas: { findFirst: mockUserMandalaFindFirst },
    youtube_sync_settings: { findUnique: mockOauthFindUnique },
    recommendation_cache: { upsert: mockRecCacheUpsert },
    $queryRaw: mockQueryRaw,
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

import { executor } from '../executor';
import type { PreflightContext, ExecuteContext } from '@/skills/_shared/types';

// ============================================================================
// Helpers
// ============================================================================

const USER_ID = '00000000-0000-0000-0000-000000000001';
const MANDALA_ID = '00000000-0000-0000-0000-000000000002';

/**
 * Build a 4096d vector deterministically from a seed value.
 * Used so that cosine similarity between same-seed vectors is high.
 */
function buildVec(seed: number): number[] {
  const arr = new Array<number>(4096);
  for (let i = 0; i < 4096; i++) {
    arr[i] = Math.sin(seed + i * 0.001);
  }
  // L2 normalize
  let norm2 = 0;
  for (const v of arr) norm2 += v * v;
  const norm = Math.sqrt(norm2);
  for (let i = 0; i < 4096; i++) arr[i] = (arr[i] ?? 0) / norm;
  return arr;
}

function vecToLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

function makePreCtx(overrides: Partial<PreflightContext> = {}): PreflightContext {
  return {
    userId: USER_ID,
    mandalaId: MANDALA_ID,
    tier: 'admin',
    env: {},
    ...overrides,
  };
}

// ============================================================================
// Preflight tests
// ============================================================================

describe('video-discover preflight', () => {
  beforeEach(() => {
    mockUserMandalaFindFirst.mockReset();
    mockOauthFindUnique.mockReset();
    mockQueryRaw.mockReset();
  });

  it('rejects when mandala_id is missing', async () => {
    const result = await executor.preflight(makePreCtx({ mandalaId: undefined }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/mandala_id/);
  });

  it('rejects when mandala does not belong to user', async () => {
    mockUserMandalaFindFirst.mockResolvedValue(null);
    const result = await executor.preflight(makePreCtx());
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not found or not owned/);
  });

  it('rejects when YouTube OAuth token is missing (Q2 — Connect YouTube)', async () => {
    mockUserMandalaFindFirst.mockResolvedValue({ id: MANDALA_ID });
    mockOauthFindUnique.mockResolvedValue(null);
    const result = await executor.preflight(makePreCtx());
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/YouTube account not connected/);
  });

  it('rejects when YouTube OAuth token has expired', async () => {
    mockUserMandalaFindFirst.mockResolvedValue({ id: MANDALA_ID });
    mockOauthFindUnique.mockResolvedValue({
      youtube_access_token: 'expired-token',
      youtube_token_expires_at: new Date(Date.now() - 1000),
    });
    const result = await executor.preflight(makePreCtx());
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/expired/);
  });

  it('rejects when mandala has no sub_goal embeddings', async () => {
    mockUserMandalaFindFirst.mockResolvedValue({ id: MANDALA_ID });
    mockOauthFindUnique.mockResolvedValue({
      youtube_access_token: 'fresh-token',
      youtube_token_expires_at: new Date(Date.now() + 3600 * 1000),
    });
    mockQueryRaw.mockResolvedValueOnce([]); // sub_goals query
    const result = await executor.preflight(makePreCtx());
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/sub_goal embeddings/);
  });

  it('rejects when keyword_scores has no embedded rows', async () => {
    mockUserMandalaFindFirst.mockResolvedValue({ id: MANDALA_ID });
    mockOauthFindUnique.mockResolvedValue({
      youtube_access_token: 'fresh-token',
      youtube_token_expires_at: new Date(Date.now() + 3600 * 1000),
    });
    mockQueryRaw
      .mockResolvedValueOnce([
        { sub_goal_index: 0, sub_goal: 'goal1', text: null, embedding: vecToLiteral(buildVec(1)) },
      ])
      .mockResolvedValueOnce([]); // keyword_scores query
    const result = await executor.preflight(makePreCtx());
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/keyword_scores/);
  });

  it('hydrates state with sub_goals, keywords, and oauth token', async () => {
    mockUserMandalaFindFirst.mockResolvedValue({ id: MANDALA_ID });
    mockOauthFindUnique.mockResolvedValue({
      youtube_access_token: 'fresh-token',
      youtube_token_expires_at: new Date(Date.now() + 3600 * 1000),
    });
    mockQueryRaw
      .mockResolvedValueOnce([
        { sub_goal_index: 0, sub_goal: 'goal1', text: null, embedding: vecToLiteral(buildVec(1)) },
        { sub_goal_index: 1, sub_goal: 'goal2', text: null, embedding: vecToLiteral(buildVec(2)) },
      ])
      .mockResolvedValueOnce([
        { keyword: 'kw1', iks_total: 80, domain: null, embedding: vecToLiteral(buildVec(1)) },
        { keyword: 'kw2', iks_total: 70, domain: null, embedding: vecToLiteral(buildVec(3)) },
      ]);

    const result = await executor.preflight(makePreCtx());
    expect(result.ok).toBe(true);
    const state = result.hydrated as Record<string, unknown>;
    expect(state['oauthToken']).toBe('fresh-token');
    expect((state['subGoals'] as unknown[]).length).toBe(2);
    expect((state['keywords'] as unknown[]).length).toBe(2);
  });
});

// ============================================================================
// Execute tests
// ============================================================================

describe('video-discover execute', () => {
  beforeEach(() => {
    mockRecCacheUpsert.mockReset();
    mockRecCacheUpsert.mockResolvedValue({});
  });

  function makeFetchRouter(opts: {
    searchItems?: Array<{
      videoId: string;
      title: string;
      channel: string;
      channelId: string;
      publishedAt?: string;
    }>;
    statsItems?: Array<{ videoId: string; viewCount: number; likeCount: number | null }>;
    searchShouldFail?: boolean;
  }): typeof fetch {
    return jest.fn().mockImplementation(async (url: string) => {
      if (url.includes('/youtube/v3/search')) {
        if (opts.searchShouldFail) {
          return {
            ok: false,
            status: 500,
            json: async () => ({ error: { code: 500, message: 'boom' } }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: (opts.searchItems ?? []).map((it) => ({
              id: { videoId: it.videoId },
              snippet: {
                title: it.title,
                channelTitle: it.channel,
                channelId: it.channelId,
                publishedAt: it.publishedAt ?? '2026-04-01T00:00:00Z',
                thumbnails: { high: { url: `thumb-${it.videoId}` } },
              },
            })),
          }),
        };
      }
      if (url.includes('/youtube/v3/videos')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: (opts.statsItems ?? []).map((s) => ({
              id: s.videoId,
              statistics: {
                viewCount: String(s.viewCount),
                likeCount: s.likeCount === null ? undefined : String(s.likeCount),
              },
            })),
          }),
        };
      }
      throw new Error(`Unmocked URL: ${url}`);
    }) as unknown as typeof fetch;
  }

  function buildExeCtx(
    fetchImpl: typeof fetch,
    customState?: Record<string, unknown>
  ): ExecuteContext {
    return {
      userId: USER_ID,
      mandalaId: MANDALA_ID,
      tier: 'admin',
      env: {},
      llm: {} as never,
      state: {
        mandalaId: MANDALA_ID,
        userId: USER_ID,
        oauthToken: 'fresh-token',
        subGoals: [
          { cellIndex: 0, text: 'cell-0', embedding: buildVec(1) },
          { cellIndex: 1, text: 'cell-1', embedding: buildVec(2) },
        ],
        keywords: [
          { keyword: 'kw1', iksTotal: 80, embedding: buildVec(1), domain: null },
          { keyword: 'kw2', iksTotal: 70, embedding: buildVec(2), domain: null },
        ],
        fetchImpl,
        ...customState,
      },
    };
  }

  it('runs end-to-end: searches per cell, batches stats, upserts recommendations', async () => {
    const fetchImpl = makeFetchRouter({
      searchItems: [
        { videoId: 'v1', title: 'Video 1', channel: 'Ch A', channelId: 'cha' },
        { videoId: 'v2', title: 'Video 2', channel: 'Ch B', channelId: 'chb' },
      ],
      statsItems: [
        { videoId: 'v1', viewCount: 10000, likeCount: 500 },
        { videoId: 'v2', viewCount: 5000, likeCount: 300 },
      ],
    });

    const result = await executor.execute(buildExeCtx(fetchImpl));

    expect(result.status).toBe('success');
    expect(result.data['cells']).toBe(2);
    expect(result.data['cell_keyword_pairs']).toBe(2); // 2 cells × 1 kw
    expect(result.data['search_calls']).toBe(2);
    expect(result.data['recommendations_upserted']).toBeGreaterThan(0);
    expect(result.metrics?.rows_written?.['recommendation_cache']).toBeGreaterThan(0);
  });

  it('upserts using composite key (user_id, mandala_id, video_id)', async () => {
    const fetchImpl = makeFetchRouter({
      searchItems: [{ videoId: 'v-only', title: 'Only Video', channel: 'C', channelId: 'c' }],
      statsItems: [{ videoId: 'v-only', viewCount: 1000, likeCount: 40 }],
    });

    await executor.execute(buildExeCtx(fetchImpl));

    expect(mockRecCacheUpsert).toHaveBeenCalled();
    const upsertCall = mockRecCacheUpsert.mock.calls[0]?.[0];
    expect(upsertCall.where.user_id_mandala_id_video_id).toEqual({
      user_id: USER_ID,
      mandala_id: MANDALA_ID,
      video_id: 'v-only',
    });
  });

  it('stores per_mandala_relevance in trend_keywords JSONB', async () => {
    const fetchImpl = makeFetchRouter({
      searchItems: [{ videoId: 'v1', title: 'V1', channel: 'C', channelId: 'c' }],
      statsItems: [{ videoId: 'v1', viewCount: 1000, likeCount: 40 }],
    });

    await executor.execute(buildExeCtx(fetchImpl));

    const create = mockRecCacheUpsert.mock.calls[0]?.[0].create;
    expect(create.trend_keywords).toBeDefined();
    const tk = create.trend_keywords as Array<Record<string, unknown>>;
    expect(tk[0]).toHaveProperty('per_mandala_relevance');
    expect(typeof tk[0]?.['per_mandala_relevance']).toBe('number');
  });

  it('applies diversity: drops same channel within a cell', async () => {
    // Both videos in cell 0 from same channel — only one should make it through
    const fetchImpl = makeFetchRouter({
      searchItems: [
        { videoId: 'v1', title: 'V1', channel: 'Same', channelId: 'same' },
        { videoId: 'v2', title: 'V2', channel: 'Same', channelId: 'same' },
        { videoId: 'v3', title: 'V3', channel: 'Different', channelId: 'diff' },
      ],
      statsItems: [
        { videoId: 'v1', viewCount: 100, likeCount: 5 },
        { videoId: 'v2', viewCount: 200, likeCount: 10 },
        { videoId: 'v3', viewCount: 50, likeCount: 3 },
      ],
    });

    await executor.execute(
      buildExeCtx(fetchImpl, {
        // Single cell to keep math simple
        subGoals: [{ cellIndex: 0, text: 'cell-0', embedding: buildVec(1) }],
      })
    );

    // 2 unique channels → at most 2 recommendations should be upserted
    const upsertedVideoIds = mockRecCacheUpsert.mock.calls.map(
      (c) => c[0].where.user_id_mandala_id_video_id.video_id
    );
    const channels = new Set(upsertedVideoIds);
    // We assert the dedup logic prevents both v1 and v2 (same channel) coexisting
    const v1v2BothPresent = channels.has('v1') && channels.has('v2');
    expect(v1v2BothPresent).toBe(false);
  });

  it('returns failed when search returns 0 candidates', async () => {
    const fetchImpl = makeFetchRouter({ searchItems: [], statsItems: [] });
    const result = await executor.execute(buildExeCtx(fetchImpl));
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/0 candidate/);
    expect(mockRecCacheUpsert).not.toHaveBeenCalled();
  });

  it('survives videos.list failure (continues without stats)', async () => {
    const fetchImpl = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes('/search')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              {
                id: { videoId: 'v1' },
                snippet: {
                  title: 'V1',
                  channelTitle: 'C',
                  channelId: 'c',
                  publishedAt: '2026-04-01T00:00:00Z',
                  thumbnails: { high: { url: 't' } },
                },
              },
            ],
          }),
        };
      }
      if (url.includes('/videos')) {
        return { ok: false, status: 500, json: async () => ({ error: { message: 'boom' } }) };
      }
      throw new Error(`Unmocked: ${url}`);
    }) as unknown as typeof fetch;

    const result = await executor.execute(buildExeCtx(fetchImpl));
    expect(result.status).toBe('success'); // search succeeded, stats failure was non-fatal
    expect(mockRecCacheUpsert).toHaveBeenCalled();
  });

  it('reports search_calls + candidates + duration in result data', async () => {
    const fetchImpl = makeFetchRouter({
      searchItems: [{ videoId: 'v1', title: 'V1', channel: 'C', channelId: 'c' }],
      statsItems: [{ videoId: 'v1', viewCount: 100, likeCount: 5 }],
    });
    const result = await executor.execute(buildExeCtx(fetchImpl));
    expect(typeof result.data['search_calls']).toBe('number');
    expect(typeof result.data['candidates_total']).toBe('number');
    expect(typeof result.metrics?.duration_ms).toBe('number');
  });
});
