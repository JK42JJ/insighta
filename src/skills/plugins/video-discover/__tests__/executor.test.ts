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
const mockRecCacheFindMany = jest.fn();

jest.mock('@/modules/database', () => ({
  getPrismaClient: () => ({
    user_mandalas: { findFirst: mockUserMandalaFindFirst },
    youtube_sync_settings: { findUnique: mockOauthFindUnique },
    recommendation_cache: {
      upsert: mockRecCacheUpsert,
      findMany: mockRecCacheFindMany,
    },
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

import { executor, parseIsoDuration, titleContainsBlocked, classifySearchError } from '../executor';
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
    // Default: cache lookup returns nothing → tests exercise the
    // YouTube-search path unless they override this mock explicitly.
    mockRecCacheFindMany.mockReset();
    mockRecCacheFindMany.mockResolvedValue([]);
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
    /**
     * Fix 2 (CP358): mock Ollama LLM responses. Default returns 3 valid queries
     * so existing tests get the same per-cell coverage. Set `llmShouldFail`
     * to exercise the fallback path.
     */
    llmQueries?: string[];
    llmShouldFail?: boolean;
  }): typeof fetch {
    return jest.fn().mockImplementation(async (url: string) => {
      // Fix 2: route Ollama LLM calls (Mac Mini Tailscale IP or test override)
      if (url.includes('/api/chat')) {
        if (opts.llmShouldFail) {
          return {
            ok: false,
            status: 500,
            json: async () => ({ error: 'llm down' }),
            text: async () => 'llm down',
          };
        }
        const queries = opts.llmQueries ?? ['llm-q1', 'llm-q2', 'llm-q3'];
        return {
          ok: true,
          status: 200,
          json: async () => ({ message: { content: JSON.stringify(queries) } }),
        };
      }
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
        // Fix 1 (CP358): defaults so existing tests stay green; per-test
        // overrides drive the new language/region branches.
        mandalaLanguage: 'ko',
        centerGoal: 'test center goal',
        // Fix 2 (CP358): llmUrl is forwarded to generateSearchQueriesRace
        // via executor; tests use the in-process URL string and rely on the
        // fetch router to short-circuit /api/chat to canned responses.
        llmUrl: 'http://test-ollama:11434',
        // Race orchestrator (CP358 hotfix 2). Default to Ollama-only mode
        // by leaving the OpenRouter API key empty — existing tests then
        // exercise the degraded-Ollama path which behaves like the
        // pre-race code (1 LLM provider call per cell).
        openRouterApiKey: '',
        openRouterModel: 'qwen/test-model',
        // Kill switch (CP358 hotfix). Default false so existing LLM-path
        // tests stay green; the disable-path test below sets this true via
        // customState override.
        llmDisabled: false,
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
    // CP360: 2 cells × 1 LLM query = 2 search.list calls (was 3 → 6 pre-CP360,
    // reduced to cut quota waste — see manifest.ts VIDEO_DISCOVER_QUERIES_PER_CELL)
    // Default test state has empty OpenRouter key → race degrades to
    // Ollama-only → all wins counted as ollama.
    expect(result.data['search_calls']).toBe(2);
    expect(result.data['llm_query_gen_success']).toBe(2);
    expect(result.data['llm_query_gen_failures']).toBe(0);
    expect(result.data['race_wins_ollama']).toBe(2);
    expect(result.data['race_wins_openrouter']).toBe(0);
    expect(result.data['race_both_failed']).toBe(0);
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

  // ─────────────────────────────────────────────────────────────────────
  // Fix 1 (CP358): YouTube Search params are dynamic per mandala language
  // ─────────────────────────────────────────────────────────────────────

  it('Fix 1: passes dynamic relevanceLanguage + regionCode + videoDuration=medium', async () => {
    const calls: string[] = [];
    const fetchImpl = jest.fn().mockImplementation(async (url: string) => {
      calls.push(url);
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
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [{ id: 'v1', statistics: { viewCount: '100', likeCount: '5' } }],
          }),
        };
      }
      throw new Error(`Unmocked: ${url}`);
    }) as unknown as typeof fetch;

    await executor.execute(
      buildExeCtx(fetchImpl, {
        mandalaLanguage: 'en',
        subGoals: [{ cellIndex: 0, text: 'cell-0', embedding: buildVec(1) }],
      })
    );

    const searchCall = calls.find((u) => u.includes('/search'));
    expect(searchCall).toBeDefined();
    expect(searchCall).toContain('relevanceLanguage=en');
    expect(searchCall).toContain('regionCode=US');
    expect(searchCall).toContain('videoDuration=medium');
    expect(searchCall).not.toContain('relevanceLanguage=ko');
    expect(searchCall).not.toContain('regionCode=KR');
  });

  it('Fix 1: omits regionCode when language is not in LANG_TO_REGION map', async () => {
    const calls: string[] = [];
    const fetchImpl = jest.fn().mockImplementation(async (url: string) => {
      calls.push(url);
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
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [{ id: 'v1', statistics: { viewCount: '100', likeCount: '5' } }],
        }),
      };
    }) as unknown as typeof fetch;

    await executor.execute(
      buildExeCtx(fetchImpl, {
        mandalaLanguage: 'xx', // unknown language → no region
        subGoals: [{ cellIndex: 0, text: 'cell-0', embedding: buildVec(1) }],
      })
    );

    const searchCall = calls.find((u) => u.includes('/search'));
    expect(searchCall).toContain('relevanceLanguage=xx');
    expect(searchCall).not.toContain('regionCode=');
  });

  // ─────────────────────────────────────────────────────────────────────
  // Fix 2 (CP358): LLM-driven multi-query search per cell + fallback path
  // ─────────────────────────────────────────────────────────────────────

  it('Fix 2: caps LLM queries per cell at VIDEO_DISCOVER_QUERIES_PER_CELL (CP360: 1)', async () => {
    const queriesSeen: string[] = [];
    const fetchImpl = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/chat')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            message: { content: '["llm-q-A", "llm-q-B", "llm-q-C"]' },
          }),
        };
      }
      if (url.includes('/youtube/v3/search')) {
        const m = url.match(/[?&]q=([^&]+)/);
        if (m) queriesSeen.push(decodeURIComponent(m[1] ?? ''));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              {
                id: { videoId: `v-${queriesSeen.length}` },
                snippet: {
                  title: `Video ${queriesSeen.length}`,
                  channelTitle: `Ch${queriesSeen.length}`,
                  channelId: `c${queriesSeen.length}`,
                  publishedAt: '2026-04-01T00:00:00Z',
                  thumbnails: { high: { url: 't' } },
                },
              },
            ],
          }),
        };
      }
      if (url.includes('/youtube/v3/videos')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: queriesSeen.map((_, i) => ({
              id: `v-${i + 1}`,
              statistics: { viewCount: '100', likeCount: '5' },
            })),
          }),
        };
      }
      throw new Error(`Unmocked: ${url}`);
    }) as unknown as typeof fetch;

    const result = await executor.execute(
      buildExeCtx(fetchImpl, {
        subGoals: [{ cellIndex: 0, text: 'cell-0', embedding: buildVec(1) }],
      })
    );

    // CP360: 1 cell × 1 query (cap) = 1 search call. LLM returns 3 queries
    // but VIDEO_DISCOVER_QUERIES_PER_CELL=1 caps it to the first one only.
    expect(result.data['search_calls']).toBe(1);
    expect(queriesSeen).toEqual(['llm-q-A']);
    expect(result.data['llm_query_gen_success']).toBe(1);
    expect(result.data['llm_query_gen_failures']).toBe(0);
  });

  it('Fix 2: falls back to keyword-concat when LLM throws LlmQueryGenError', async () => {
    const queriesSeen: string[] = [];
    const fetchImpl = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/chat')) {
        // Simulate Ollama HTTP failure → LlmQueryGenError → fallback path
        return {
          ok: false,
          status: 503,
          text: async () => 'service unavailable',
          json: async () => ({}),
        };
      }
      if (url.includes('/youtube/v3/search')) {
        const m = url.match(/[?&]q=([^&]+)/);
        if (m) queriesSeen.push(decodeURIComponent(m[1] ?? ''));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              {
                id: { videoId: 'fallback-vid' },
                snippet: {
                  title: 'Fallback Video',
                  channelTitle: 'Ch',
                  channelId: 'c',
                  publishedAt: '2026-04-01T00:00:00Z',
                  thumbnails: { high: { url: 't' } },
                },
              },
            ],
          }),
        };
      }
      if (url.includes('/youtube/v3/videos')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [{ id: 'fallback-vid', statistics: { viewCount: '100', likeCount: '5' } }],
          }),
        };
      }
      throw new Error(`Unmocked: ${url}`);
    }) as unknown as typeof fetch;

    const result = await executor.execute(
      buildExeCtx(fetchImpl, {
        subGoals: [{ cellIndex: 0, text: 'cell-0-text', embedding: buildVec(1) }],
      })
    );

    // 1 cell × 1 fallback concat query = 1 search call
    expect(result.data['search_calls']).toBe(1);
    expect(result.data['llm_query_gen_success']).toBe(0);
    expect(result.data['llm_query_gen_failures']).toBe(1);
    // Fallback uses `${cell.text} ${keyword}` format. URL search params encode
    // spaces as `+` (URLSearchParams default), so the assertion sees `+`.
    expect(queriesSeen).toEqual(['cell-0-text+kw1']);
  });

  it('Fix 2 hotfix: llmDisabled=true skips Ollama and uses legacy concat for all cells', async () => {
    const ollamaCalls: string[] = [];
    const queriesSeen: string[] = [];
    const fetchImpl = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/chat')) {
        // If this is reached, the kill switch is broken.
        ollamaCalls.push(url);
        return {
          ok: true,
          status: 200,
          json: async () => ({ message: { content: '["should-not-see-this"]' } }),
        };
      }
      if (url.includes('/youtube/v3/search')) {
        const m = url.match(/[?&]q=([^&]+)/);
        if (m) queriesSeen.push(decodeURIComponent(m[1] ?? ''));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              {
                id: { videoId: 'fb-vid' },
                snippet: {
                  title: 'Fallback Video',
                  channelTitle: 'Ch',
                  channelId: 'c',
                  publishedAt: '2026-04-01T00:00:00Z',
                  thumbnails: { high: { url: 't' } },
                },
              },
            ],
          }),
        };
      }
      if (url.includes('/youtube/v3/videos')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              {
                id: 'fb-vid',
                statistics: { viewCount: '100', likeCount: '5' },
                contentDetails: { duration: 'PT5M' },
              },
            ],
          }),
        };
      }
      throw new Error(`Unmocked: ${url}`);
    }) as unknown as typeof fetch;

    const result = await executor.execute(
      buildExeCtx(fetchImpl, {
        llmDisabled: true,
        subGoals: [
          { cellIndex: 0, text: 'cell-zero', embedding: buildVec(1) },
          { cellIndex: 1, text: 'cell-one', embedding: buildVec(2) },
        ],
      })
    );

    // Kill switch: zero Ollama calls
    expect(ollamaCalls).toHaveLength(0);
    expect(result.data['llm_query_gen_success']).toBe(0);
    expect(result.data['llm_query_gen_failures']).toBe(0);
    // Each cell makes exactly 1 search call using `${cell.text} ${keyword}`
    expect(result.data['search_calls']).toBe(2);
    // Each cell picks its closest keyword by cosine sim (cell-0/kw1 are
    // buildVec(1), cell-1/kw2 are buildVec(2)) — fallback concat is
    // `${cell.text} ${matched_keyword}`, encoded to + by URLSearchParams.
    expect(queriesSeen.sort()).toEqual(['cell-one+kw2', 'cell-zero+kw1'].sort());
  });

  it('Fix 2: single-query cap yields single search.list call per cell (CP360)', async () => {
    const fetchImpl = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/chat')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            message: { content: '["q1", "q2", "q3"]' },
          }),
        };
      }
      if (url.includes('/youtube/v3/search')) {
        // Every query returns the SAME video — without dedup we'd get 3 candidates
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              {
                id: { videoId: 'same-vid' },
                snippet: {
                  title: 'Same Video',
                  channelTitle: 'Ch',
                  channelId: 'c',
                  publishedAt: '2026-04-01T00:00:00Z',
                  thumbnails: { high: { url: 't' } },
                },
              },
            ],
          }),
        };
      }
      if (url.includes('/youtube/v3/videos')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [{ id: 'same-vid', statistics: { viewCount: '100', likeCount: '5' } }],
          }),
        };
      }
      throw new Error(`Unmocked: ${url}`);
    }) as unknown as typeof fetch;

    const result = await executor.execute(
      buildExeCtx(fetchImpl, {
        subGoals: [{ cellIndex: 0, text: 'cell-0', embedding: buildVec(1) }],
      })
    );

    // CP360: VIDEO_DISCOVER_QUERIES_PER_CELL=1, so only 1 search.list call
    // per cell regardless of how many queries the LLM returns. The per-cell
    // dedup code path is no longer exercised by the default config — it
    // remains in place as a safety net if the cap is ever raised again.
    expect(result.data['search_calls']).toBe(1);
    expect(result.data['candidates_total']).toBe(1);
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

  // ─────────────────────────────────────────────────────────────────────
  // Fix 3 (CP358): Shorts filter, title blocklist, global channel cap
  // ─────────────────────────────────────────────────────────────────────

  function makeFetchRouterWithDuration(opts: {
    searchItems: Array<{
      videoId: string;
      title: string;
      channel: string;
      channelId: string;
    }>;
    statsItems: Array<{
      videoId: string;
      viewCount: number;
      likeCount: number | null;
      durationIso: string; // PT5M, PT45S, etc.
    }>;
  }): typeof fetch {
    return jest.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/chat')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ message: { content: '["q1", "q2", "q3"]' } }),
        };
      }
      if (url.includes('/youtube/v3/search')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: opts.searchItems.map((it) => ({
              id: { videoId: it.videoId },
              snippet: {
                title: it.title,
                channelTitle: it.channel,
                channelId: it.channelId,
                publishedAt: '2026-04-01T00:00:00Z',
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
            items: opts.statsItems.map((s) => ({
              id: s.videoId,
              statistics: {
                viewCount: String(s.viewCount),
                likeCount: s.likeCount === null ? undefined : String(s.likeCount),
              },
              contentDetails: { duration: s.durationIso },
            })),
          }),
        };
      }
      throw new Error(`Unmocked: ${url}`);
    }) as unknown as typeof fetch;
  }

  it('Fix 3: drops candidates with durationSec < 60 (Shorts)', async () => {
    const fetchImpl = makeFetchRouterWithDuration({
      searchItems: [
        { videoId: 'short', title: 'Quick Short', channel: 'A', channelId: 'a' },
        { videoId: 'medium', title: 'Real Tutorial', channel: 'B', channelId: 'b' },
      ],
      statsItems: [
        { videoId: 'short', viewCount: 1000, likeCount: 50, durationIso: 'PT45S' },
        { videoId: 'medium', viewCount: 1000, likeCount: 50, durationIso: 'PT5M' },
      ],
    });

    await executor.execute(
      buildExeCtx(fetchImpl, {
        subGoals: [{ cellIndex: 0, text: 'cell-0', embedding: buildVec(1) }],
      })
    );

    const upsertedVideoIds = mockRecCacheUpsert.mock.calls.map(
      (c) => c[0].where.user_id_mandala_id_video_id.video_id
    );
    expect(upsertedVideoIds).toContain('medium');
    expect(upsertedVideoIds).not.toContain('short');
  });

  it('Fix 3: keeps candidates with durationSec >= 60', async () => {
    const fetchImpl = makeFetchRouterWithDuration({
      searchItems: [{ videoId: 'exactly60', title: 'Tutorial', channel: 'A', channelId: 'a' }],
      statsItems: [{ videoId: 'exactly60', viewCount: 1000, likeCount: 50, durationIso: 'PT1M' }],
    });

    await executor.execute(
      buildExeCtx(fetchImpl, {
        subGoals: [{ cellIndex: 0, text: 'cell-0', embedding: buildVec(1) }],
      })
    );

    const upsertedVideoIds = mockRecCacheUpsert.mock.calls.map(
      (c) => c[0].where.user_id_mandala_id_video_id.video_id
    );
    expect(upsertedVideoIds).toEqual(['exactly60']);
  });

  it('Fix 3: drops candidates whose title matches TITLE_BLOCKLIST', async () => {
    const fetchImpl = makeFetchRouterWithDuration({
      searchItems: [
        { videoId: 'drama', title: '드라마 추천 TOP 10', channel: 'A', channelId: 'a' },
        { videoId: 'edu', title: '집중력 키우는 법', channel: 'B', channelId: 'b' },
        { videoId: 'vlog', title: 'My Daily Vlog', channel: 'C', channelId: 'c' },
        { videoId: 'good', title: '학습 동기 부여 강의', channel: 'D', channelId: 'd' },
      ],
      statsItems: [
        { videoId: 'drama', viewCount: 1000, likeCount: 50, durationIso: 'PT5M' },
        { videoId: 'edu', viewCount: 1000, likeCount: 50, durationIso: 'PT5M' },
        { videoId: 'vlog', viewCount: 1000, likeCount: 50, durationIso: 'PT5M' },
        { videoId: 'good', viewCount: 1000, likeCount: 50, durationIso: 'PT5M' },
      ],
    });

    await executor.execute(
      buildExeCtx(fetchImpl, {
        subGoals: [{ cellIndex: 0, text: 'cell-0', embedding: buildVec(1) }],
      })
    );

    const upsertedVideoIds = mockRecCacheUpsert.mock.calls.map(
      (c) => c[0].where.user_id_mandala_id_video_id.video_id
    );
    expect(upsertedVideoIds).toContain('edu');
    expect(upsertedVideoIds).toContain('good');
    expect(upsertedVideoIds).not.toContain('drama');
    expect(upsertedVideoIds).not.toContain('vlog');
  });

  it('Fix 3: global channel cap collapses 3+ same-channel videos to highest-scored 1', async () => {
    // Create 8 cells where 3 different cells return videos from the same channel `noisy`
    // Per-cell dedup keeps at most 1 noisy video per cell, but the noisy
    // channel ends up in 3 cells = 3 finalRecommendations → channel cap fires.
    const fetchImpl = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/chat')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ message: { content: '["q1", "q2", "q3"]' } }),
        };
      }
      if (url.includes('/youtube/v3/search')) {
        // Each cell receives the same noisy channel video plus a unique alt
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              {
                id: { videoId: 'noisy-vid' },
                snippet: {
                  title: 'Noisy Video',
                  channelTitle: 'NoisyChannel',
                  channelId: 'noisy',
                  publishedAt: '2026-04-01T00:00:00Z',
                  thumbnails: { high: { url: 't' } },
                },
              },
              {
                id: { videoId: `alt-${Math.random()}` },
                snippet: {
                  title: 'Alt Video',
                  channelTitle: 'AltChannel',
                  channelId: `alt-${Math.random()}`,
                  publishedAt: '2026-04-01T00:00:00Z',
                  thumbnails: { high: { url: 't' } },
                },
              },
            ],
          }),
        };
      }
      if (url.includes('/youtube/v3/videos')) {
        // Stub: return PT5M for any id requested
        const idsParam = new URL(url).searchParams.get('id') ?? '';
        const ids = idsParam.split(',').filter(Boolean);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: ids.map((id) => ({
              id,
              statistics: { viewCount: '1000', likeCount: '50' },
              contentDetails: { duration: 'PT5M' },
            })),
          }),
        };
      }
      throw new Error(`Unmocked: ${url}`);
    }) as unknown as typeof fetch;

    await executor.execute(
      buildExeCtx(fetchImpl, {
        subGoals: [
          { cellIndex: 0, text: 'cell-0', embedding: buildVec(1) },
          { cellIndex: 1, text: 'cell-1', embedding: buildVec(2) },
          { cellIndex: 2, text: 'cell-2', embedding: buildVec(3) },
          { cellIndex: 3, text: 'cell-3', embedding: buildVec(4) },
        ],
      })
    );

    const upsertedVideoIds = mockRecCacheUpsert.mock.calls.map(
      (c) => c[0].where.user_id_mandala_id_video_id.video_id
    );
    // After global channel cap, the noisy channel should have at most 1 video kept
    const noisyCount = upsertedVideoIds.filter((id) => id === 'noisy-vid').length;
    expect(noisyCount).toBeLessThanOrEqual(1);
  });

  // ─────────────────────────────────────────────────────────────────────
  // CP360 Phase 1 — Cross-run recommendation_cache reuse
  // ─────────────────────────────────────────────────────────────────────

  it('Phase 1: serves cell from recommendation_cache when ≥3 fresh rows exist', async () => {
    // Mock: cache lookup returns 3 videos whose titles share tokens with
    // the sub_goal "python basics" so they pass the title-overlap filter
    // (CP361 cache reuse hardening).
    const cachedRows = [
      {
        video_id: 'cached-vid-1',
        title: 'Python Basics Tutorial 1',
        channel: 'Cached Channel A',
        view_count: 50_000,
        duration_sec: 600,
        published_at: new Date('2026-04-01T00:00:00Z'),
        thumbnail: 'https://img/1.jpg',
        rec_score: 0.8,
      },
      {
        video_id: 'cached-vid-2',
        title: 'Python for Beginners',
        channel: 'Cached Channel B',
        view_count: 30_000,
        duration_sec: 480,
        published_at: new Date('2026-04-02T00:00:00Z'),
        thumbnail: 'https://img/2.jpg',
        rec_score: 0.75,
      },
      {
        video_id: 'cached-vid-3',
        title: 'Learn Python Basics Fast',
        channel: 'Cached Channel C',
        view_count: 100_000,
        duration_sec: 720,
        published_at: new Date('2026-04-03T00:00:00Z'),
        thumbnail: 'https://img/3.jpg',
        rec_score: 0.7,
      },
    ];
    mockRecCacheFindMany.mockResolvedValue(cachedRows);

    // Track fetch calls — should see NO YouTube search for the cell that
    // was served from cache
    const fetchCalls: string[] = [];
    const fetchImpl = jest.fn().mockImplementation(async (url: string) => {
      fetchCalls.push(url);
      // Only videos.list should be called, and only for non-cached candidates
      // (which is zero here since we only have 1 cell and it's cache-served)
      if (url.includes('/youtube/v3/videos')) {
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const result = await executor.execute(
      buildExeCtx(fetchImpl, {
        subGoals: [{ cellIndex: 0, text: 'python basics', embedding: buildVec(1) }],
      })
    );

    expect(result.status).toBe('success');
    expect(result.data['cells_served_from_cache']).toBe(1);
    expect(result.data['cache_hits_total']).toBe(3);
    expect(result.data['quota_saved_units']).toBeGreaterThan(0);
    // Search was NOT called — everything came from cache
    expect(result.data['search_calls']).toBe(0);
    // YouTube search.list was NOT in the fetch calls
    expect(fetchCalls.some((u) => u.includes('/youtube/v3/search'))).toBe(false);

    // All 3 cached videos were upserted with current user/mandala
    expect(mockRecCacheUpsert).toHaveBeenCalledTimes(3);
    const upsertedIds = mockRecCacheUpsert.mock.calls.map(
      (c) => c[0].where.user_id_mandala_id_video_id.video_id
    );
    expect(upsertedIds.sort()).toEqual(['cached-vid-1', 'cached-vid-2', 'cached-vid-3']);
  });

  it('Phase 1: falls through to YouTube search when cached titles fail topic-token filter', async () => {
    // Simulate the 2026-04-09 basketball incident: cache has ≥3 rows for
    // the keyword, but the titles are topically unrelated to the sub_goal.
    // CP361 fix: title-overlap filter rejects them → fall through to search.
    const cachedRows = Array.from({ length: 5 }, (_, i) => ({
      video_id: `off-topic-${i}`,
      title: `Marathon Training Tips ${i}`, // NO overlap with "python basics"
      channel: `Running Channel ${i}`,
      view_count: 50_000,
      duration_sec: 600,
      published_at: new Date(),
      thumbnail: 't',
      rec_score: 0.8,
    }));
    mockRecCacheFindMany.mockResolvedValue(cachedRows);

    const fetchImpl = makeFetchRouter({
      searchItems: [
        { videoId: 'fresh-1', title: 'Python Tutorial', channel: 'PyCh', channelId: 'fc1' },
      ],
      statsItems: [{ videoId: 'fresh-1', viewCount: 20_000, likeCount: 100 }],
    });

    const result = await executor.execute(
      buildExeCtx(fetchImpl, {
        subGoals: [{ cellIndex: 0, text: 'python basics', embedding: buildVec(1) }],
      })
    );

    // Title filter rejected all cached rows → fallback to search fired
    expect(result.data['cells_served_from_cache']).toBe(0);
    expect(result.data['search_calls']).toBeGreaterThan(0);
    // NO cached videos were upserted
    const upsertedIds = mockRecCacheUpsert.mock.calls.map(
      (c) => c[0].where.user_id_mandala_id_video_id.video_id
    );
    expect(upsertedIds.some((id: string) => id.startsWith('off-topic-'))).toBe(false);
  });

  it('Phase 1: falls through to YouTube search when cache has <3 rows', async () => {
    // Only 2 cached rows — below MIN_CACHE_HITS_PER_CELL=3 threshold
    mockRecCacheFindMany.mockResolvedValue([
      {
        video_id: 'cached-1',
        title: 'Cached 1',
        channel: 'Ch1',
        view_count: 50_000,
        duration_sec: 600,
        published_at: new Date(),
        thumbnail: 't',
        rec_score: 0.8,
      },
      {
        video_id: 'cached-2',
        title: 'Cached 2',
        channel: 'Ch2',
        view_count: 30_000,
        duration_sec: 500,
        published_at: new Date(),
        thumbnail: 't',
        rec_score: 0.7,
      },
    ]);

    const fetchImpl = makeFetchRouter({
      searchItems: [{ videoId: 'fresh-1', title: 'Fresh 1', channel: 'FreshCh', channelId: 'fc1' }],
      statsItems: [{ videoId: 'fresh-1', viewCount: 20_000, likeCount: 100 }],
    });

    const result = await executor.execute(
      buildExeCtx(fetchImpl, {
        subGoals: [{ cellIndex: 0, text: 'cell-0', embedding: buildVec(1) }],
      })
    );

    expect(result.data['cells_served_from_cache']).toBe(0);
    expect(result.data['search_calls']).toBeGreaterThan(0);
  });

  it('Phase 1: VIDEO_DISCOVER_DISABLE_CACHE_REUSE=1 bypasses cache lookup', async () => {
    // Stuff the cache with 5 rows but disable the feature — expect fallthrough
    mockRecCacheFindMany.mockResolvedValue([
      {
        video_id: 'c1',
        title: 'C1',
        channel: 'C',
        view_count: 50000,
        duration_sec: 600,
        published_at: new Date(),
        thumbnail: 't',
        rec_score: 0.8,
      },
      {
        video_id: 'c2',
        title: 'C2',
        channel: 'C',
        view_count: 50000,
        duration_sec: 600,
        published_at: new Date(),
        thumbnail: 't',
        rec_score: 0.8,
      },
      {
        video_id: 'c3',
        title: 'C3',
        channel: 'C',
        view_count: 50000,
        duration_sec: 600,
        published_at: new Date(),
        thumbnail: 't',
        rec_score: 0.8,
      },
      {
        video_id: 'c4',
        title: 'C4',
        channel: 'C',
        view_count: 50000,
        duration_sec: 600,
        published_at: new Date(),
        thumbnail: 't',
        rec_score: 0.8,
      },
    ]);

    const fetchImpl = makeFetchRouter({
      searchItems: [{ videoId: 'fresh-1', title: 'Fresh 1', channel: 'FreshCh', channelId: 'fc1' }],
      statsItems: [{ videoId: 'fresh-1', viewCount: 20_000, likeCount: 100 }],
    });

    const ctx = buildExeCtx(fetchImpl, {
      subGoals: [{ cellIndex: 0, text: 'cell-0', embedding: buildVec(1) }],
    });
    // Override: inject kill switch into hydrated state
    (ctx.state as unknown as { cacheReuseDisabled: boolean }).cacheReuseDisabled = true;

    const result = await executor.execute(ctx);
    expect(result.data['cells_served_from_cache']).toBe(0);
    // cache lookup MUST NOT be called when feature is disabled
    expect(mockRecCacheFindMany).not.toHaveBeenCalled();
  });

  it('Phase 1: videos.list skips cached video ids (no wasted quota on enrichment)', async () => {
    const cachedRows = [
      {
        video_id: 'cache-1',
        title: 'C1',
        channel: 'Ch',
        view_count: 50000,
        duration_sec: 600,
        published_at: new Date(),
        thumbnail: 't',
        rec_score: 0.8,
      },
      {
        video_id: 'cache-2',
        title: 'C2',
        channel: 'Ch',
        view_count: 50000,
        duration_sec: 600,
        published_at: new Date(),
        thumbnail: 't',
        rec_score: 0.8,
      },
      {
        video_id: 'cache-3',
        title: 'C3',
        channel: 'Ch',
        view_count: 50000,
        duration_sec: 600,
        published_at: new Date(),
        thumbnail: 't',
        rec_score: 0.8,
      },
    ];
    mockRecCacheFindMany.mockResolvedValue(cachedRows);

    const videosListCalls: string[] = [];
    const fetchImpl = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes('/youtube/v3/videos')) {
        videosListCalls.push(url);
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      }
      // If search gets called, something went wrong
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    await executor.execute(
      buildExeCtx(fetchImpl, {
        subGoals: [{ cellIndex: 0, text: 'cell-0', embedding: buildVec(1) }],
      })
    );

    // Either videos.list was not called at all (no non-cached candidates),
    // OR it was called but the id param didn't include any of the cached ids
    for (const url of videosListCalls) {
      expect(url).not.toContain('cache-1');
      expect(url).not.toContain('cache-2');
      expect(url).not.toContain('cache-3');
    }
  });
});

// ============================================================================
// Fix 3 (CP358) — helper unit tests
// ============================================================================

describe('parseIsoDuration', () => {
  it('parses PT30S → 30', () => {
    expect(parseIsoDuration('PT30S')).toBe(30);
  });
  it('parses PT5M → 300', () => {
    expect(parseIsoDuration('PT5M')).toBe(300);
  });
  it('parses PT1H2M3S → 3723', () => {
    expect(parseIsoDuration('PT1H2M3S')).toBe(3723);
  });
  it('parses PT1H → 3600', () => {
    expect(parseIsoDuration('PT1H')).toBe(3600);
  });
  it('returns null for null input', () => {
    expect(parseIsoDuration(null)).toBeNull();
  });
  it('returns null for undefined input', () => {
    expect(parseIsoDuration(undefined)).toBeNull();
  });
  it('returns null for empty string', () => {
    expect(parseIsoDuration('')).toBeNull();
  });
  it('returns null for malformed input', () => {
    expect(parseIsoDuration('not-iso')).toBeNull();
    expect(parseIsoDuration('5M')).toBeNull();
  });
});

describe('titleContainsBlocked', () => {
  it('matches Korean blocklist tokens', () => {
    expect(titleContainsBlocked('드라마 추천 TOP 10')).toBe(true);
    expect(titleContainsBlocked('웹소설 베스트')).toBe(true);
    expect(titleContainsBlocked('애니 OP 모음')).toBe(true);
  });
  it('matches English blocklist tokens (case-insensitive)', () => {
    expect(titleContainsBlocked('My Daily Vlog')).toBe(true);
    expect(titleContainsBlocked('VLOG: Morning Routine')).toBe(true);
    expect(titleContainsBlocked('Best Anime Openings')).toBe(true);
  });
  it('passes legitimate education titles', () => {
    expect(titleContainsBlocked('학습 동기 부여 강의')).toBe(false);
    expect(titleContainsBlocked('How to focus better')).toBe(false);
    expect(titleContainsBlocked('집중력 키우는 법')).toBe(false);
  });
  it('returns false for empty/null titles', () => {
    expect(titleContainsBlocked('')).toBe(false);
    expect(titleContainsBlocked(null as unknown as string)).toBe(false);
  });

  // CP360 Phase 1-D — expanded blocklist covering ads/PPL/sponsored content
  it('catches CP360 ad/PPL additions', () => {
    expect(titleContainsBlocked('신형 블루투스 이어폰 유료광고 리뷰')).toBe(true);
    expect(titleContainsBlocked('협찬받고 제작한 영상')).toBe(true);
    expect(titleContainsBlocked('PPL 논란 정리')).toBe(true);
    expect(titleContainsBlocked('Sponsored: Learn X in 10 min')).toBe(true);
    expect(titleContainsBlocked('Product review [AD]')).toBe(true);
    expect(titleContainsBlocked('영상 제작 #광고')).toBe(true);
  });
});

// ============================================================================
// classifySearchError — CP360 failure classification
// ============================================================================

describe('classifySearchError', () => {
  it('detects YouTube quota exhaustion', () => {
    expect(classifySearchError('search.list HTTP 403 — exceeded your quota')).toBe(
      'youtube_quota_exhausted'
    );
    expect(classifySearchError('The request cannot be completed, quotaExceeded')).toBe(
      'youtube_quota_exhausted'
    );
  });

  it('distinguishes 403 without quota from quota', () => {
    expect(classifySearchError('search.list HTTP 403 — forbidden')).toBe('youtube_forbidden');
  });

  it('detects OAuth token invalidation', () => {
    expect(classifySearchError('search.list HTTP 401 — Invalid Credentials')).toBe(
      'oauth_token_invalid'
    );
    expect(classifySearchError('HTTP 401 Unauthorized')).toBe('oauth_token_invalid');
  });

  it('detects bad request and rate limit', () => {
    expect(classifySearchError('search.list HTTP 400 — invalid parameter')).toBe(
      'youtube_bad_request'
    );
    expect(classifySearchError('HTTP 429 rate limited')).toBe('youtube_rate_limited');
  });

  it('detects server errors and network failures', () => {
    expect(classifySearchError('search.list HTTP 503 — service unavailable')).toBe(
      'youtube_server_error'
    );
    expect(classifySearchError('fetch failed')).toBe('network_error');
    expect(classifySearchError('request timeout after 30000ms')).toBe('network_error');
  });

  it('falls through to unknown for novel errors', () => {
    expect(classifySearchError('something weird happened')).toBe('unknown_search_error');
    expect(classifySearchError('')).toBe('unknown_search_error');
  });
});
