/**
 * trend-collector — execute() tests (Phase 1.5a redesign)
 *
 * Pipeline under test:
 *   YouTube Trending fetch  →  allVideos
 *     ↓                          ↓
 *   LLM keyword extract     ←   titles  (PRIMARY)
 *     ↓
 *   trend_signals upsert (source = 'youtube_trending_extracted')
 *
 *   For each LEARNING_SEED_TERMS  →  Suggest API  (SECONDARY)
 *     ↓
 *   trend_signals upsert (source = 'youtube_suggest')
 *
 * Tests pin the contracts that matter:
 *   - learning_score < 0.3 entertainment titles are dropped
 *   - same keyword from 2 videos aggregates into 1 row with summed view count
 *   - LLM and Suggest write to DIFFERENT source columns
 *   - Suggest and LLM are independently optional (single-source success OK)
 *   - Both sources failing → status='failed', no upserts
 *   - 404 trending category is treated as empty (Phase 1 carry-over)
 *
 * Mock strategy: route global fetch by URL prefix:
 *   googleapis.com/youtube  → trending response
 *   100.91.173.17:11434     → Ollama chat response (LLM)
 *   suggestqueries.google.com → Suggest JSONP response
 */

const mockUpsert = jest.fn();

jest.mock('@/modules/database', () => ({
  getPrismaClient: () => ({
    trend_signals: { upsert: mockUpsert },
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
import { TREND_COLLECTOR_SOURCE_LLM, TREND_COLLECTOR_SOURCE_SUGGEST } from '../manifest';
import { LEARNING_SEED_TERMS } from '../seed-terms';
import type { ExecuteContext } from '@/skills/_shared/types';

// ============================================================================
// Mock fetch router
// ============================================================================

interface FetchScenario {
  /** Trending response per call (in order). Override for failure tests. */
  trending?: Array<{ ok: boolean; status: number; body: unknown }>;
  /** LLM response. If undefined, throws (simulates Mac Mini unreachable). */
  llmResponse?: { ok: boolean; status: number; body: unknown } | 'throw';
  /** Suggest response. If undefined, returns one suggestion per seed. */
  suggestEnabled?: boolean;
  /** Suggest body returned for any seed (positions encoded in body). */
  suggestSuggestions?: string[];
}

function buildRouterFetch(scenario: FetchScenario): typeof fetch {
  let trendingCallIdx = 0;

  return jest.fn().mockImplementation(async (url: string) => {
    if (url.includes('googleapis.com/youtube')) {
      const next = scenario.trending?.[trendingCallIdx];
      trendingCallIdx += 1;
      if (!next) {
        return { ok: false, status: 404, json: async () => ({ error: { message: 'no more' } }) };
      }
      return {
        ok: next.ok,
        status: next.status,
        json: async () => next.body,
      };
    }

    if (url.includes('100.91.173.17:11434') || url.includes('/api/chat')) {
      const llm = scenario.llmResponse;
      if (llm === 'throw') {
        throw new Error('Mac Mini unreachable (simulated)');
      }
      if (!llm) {
        // No LLM scenario provided — return empty results
        return {
          ok: true,
          status: 200,
          json: async () => ({
            message: { content: JSON.stringify({ results: [] }) },
          }),
        };
      }
      return {
        ok: llm.ok,
        status: llm.status,
        json: async () => llm.body,
      };
    }

    if (url.includes('suggestqueries.google.com')) {
      if (!scenario.suggestEnabled) {
        // Empty Suggest response (parses to [])
        return {
          ok: true,
          status: 200,
          text: async () => 'window.google.ac.h(["",[]])',
        };
      }
      const sugs = scenario.suggestSuggestions ?? ['mock suggestion'];
      const inner = JSON.stringify(['', sugs.map((s) => [s, 0, [512]])]);
      return {
        ok: true,
        status: 200,
        text: async () => `window.google.ac.h(${inner})`,
      };
    }

    throw new Error(`Unmocked URL: ${url}`);
  }) as unknown as typeof fetch;
}

function fakeYouTubeTrendingBody(
  videos: { id: string; title: string; viewCount: number }[]
): unknown {
  return {
    items: videos.map((v) => ({
      id: v.id,
      snippet: {
        title: v.title,
        channelId: `chan-${v.id}`,
        channelTitle: 'mock channel',
        categoryId: '27',
        publishedAt: '2026-04-01T00:00:00Z',
      },
      statistics: { viewCount: String(v.viewCount), likeCount: '100' },
    })),
  };
}

function fakeLlmExtractResponse(
  results: Array<{ title: string; keywords: string[]; learning_score: number }>
): unknown {
  return {
    message: {
      content: JSON.stringify({ results }),
    },
  };
}

function buildExecuteCtx(fetchImpl: typeof fetch): ExecuteContext {
  return {
    userId: '00000000-0000-0000-0000-000000000000',
    tier: 'admin',
    env: { YOUTUBE_API_KEY: 'fake-key' },
    llm: {} as never,
    state: {
      apiKey: 'fake-key',
      categoryIds: ['27'], // single category to keep mock count predictable
      regionCode: 'KR',
      maxResults: 10,
      llmEnabled: true,
      llmUrl: 'http://100.91.173.17:11434',
      suggestEnabled: false,
      seedTerms: [],
      fetchImpl,
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('trend-collector execute() — Phase 1.5a pipeline', () => {
  beforeEach(() => {
    mockUpsert.mockReset();
    mockUpsert.mockResolvedValue({});
  });

  it('LLM-only path: extracts keywords + writes source=youtube_trending_extracted', async () => {
    const fetchImpl = buildRouterFetch({
      trending: [
        {
          ok: true,
          status: 200,
          body: fakeYouTubeTrendingBody([
            { id: 'v1', title: '파이썬 입문 강의 1편', viewCount: 100000 },
            { id: 'v2', title: 'AI 코딩 튜토리얼', viewCount: 50000 },
          ]),
        },
      ],
      llmResponse: {
        ok: true,
        status: 200,
        body: fakeLlmExtractResponse([
          { title: '파이썬 입문 강의 1편', keywords: ['파이썬', '강의'], learning_score: 0.9 },
          { title: 'AI 코딩 튜토리얼', keywords: ['AI 코딩'], learning_score: 0.85 },
        ]),
      },
    });

    const result = await executor.execute(buildExecuteCtx(fetchImpl));

    expect(result.status).toBe('success');
    expect(result.data['llm_keywords']).toBe(3); // 파이썬 + 강의 + AI 코딩
    expect(result.data['suggest_keywords']).toBe(0);
    expect(result.data['total_signals_upserted']).toBe(3);

    // All upserts should use LLM source
    for (const call of mockUpsert.mock.calls) {
      expect(call[0].create.source).toBe(TREND_COLLECTOR_SOURCE_LLM);
    }
  });

  it('drops keywords when learning_score < threshold (entertainment filter)', async () => {
    const fetchImpl = buildRouterFetch({
      trending: [
        {
          ok: true,
          status: 200,
          body: fakeYouTubeTrendingBody([
            { id: 'edu', title: '데이터 분석 강의', viewCount: 1000 },
            { id: 'ent', title: '역대급 스카이 다이빙', viewCount: 50000 },
          ]),
        },
      ],
      llmResponse: {
        ok: true,
        status: 200,
        body: fakeLlmExtractResponse([
          { title: '데이터 분석 강의', keywords: ['데이터분석'], learning_score: 0.9 },
          { title: '역대급 스카이 다이빙', keywords: ['스카이다이빙'], learning_score: 0.0 },
        ]),
      },
    });

    const result = await executor.execute(buildExecuteCtx(fetchImpl));

    expect(result.status).toBe('success');
    // Only 데이터분석 should land — 스카이다이빙 below 0.3 threshold
    expect(result.data['llm_keywords']).toBe(1);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert.mock.calls[0]?.[0].create.keyword).toBe('데이터분석');
  });

  it('aggregates same keyword across multiple videos (sums view counts)', async () => {
    const fetchImpl = buildRouterFetch({
      trending: [
        {
          ok: true,
          status: 200,
          body: fakeYouTubeTrendingBody([
            { id: 'v1', title: 'AI 강의 1', viewCount: 100000 },
            { id: 'v2', title: 'AI 튜토리얼 2', viewCount: 50000 },
          ]),
        },
      ],
      llmResponse: {
        ok: true,
        status: 200,
        body: fakeLlmExtractResponse([
          { title: 'AI 강의 1', keywords: ['AI'], learning_score: 0.9 },
          { title: 'AI 튜토리얼 2', keywords: ['AI'], learning_score: 0.8 },
        ]),
      },
    });

    const result = await executor.execute(buildExecuteCtx(fetchImpl));
    expect(result.data['llm_keywords']).toBe(1); // de-dup to single 'AI' row
    expect(mockUpsert).toHaveBeenCalledTimes(1);

    const upsert = mockUpsert.mock.calls[0]?.[0];
    expect(upsert.create.keyword).toBe('AI');
    expect(upsert.create.raw_score).toBe(150000); // 100000 + 50000
    const meta = upsert.create.metadata as Record<string, unknown>;
    expect(meta['video_count']).toBe(2);
    expect(meta['video_ids']).toEqual(['v1', 'v2']);
  });

  it('LLM unreachable + Suggest enabled → Suggest-only run still succeeds', async () => {
    const fetchImpl = buildRouterFetch({
      trending: [
        {
          ok: true,
          status: 200,
          body: fakeYouTubeTrendingBody([{ id: 'v1', title: '파이썬', viewCount: 1000 }]),
        },
      ],
      llmResponse: 'throw', // Mac Mini down
      suggestEnabled: true,
      suggestSuggestions: ['파이썬 기초', '파이썬 강의'],
    });

    const ctx = buildExecuteCtx(fetchImpl);
    (ctx.state as Record<string, unknown>)['suggestEnabled'] = true;
    (ctx.state as Record<string, unknown>)['seedTerms'] = LEARNING_SEED_TERMS.slice(0, 2);

    const result = await executor.execute(ctx);

    expect(result.status).toBe('success');
    expect(result.data['llm_keywords']).toBe(0);
    expect(result.data['llm_enabled']).toBe(false); // marked degraded
    expect(result.data['suggest_keywords']).toBe(4); // 2 seeds × 2 suggestions
    expect(result.data['suggest_succeeded_seeds']).toBe(2);

    // All upserts should be Suggest source
    for (const call of mockUpsert.mock.calls) {
      expect(call[0].create.source).toBe(TREND_COLLECTOR_SOURCE_SUGGEST);
    }
  });

  it('BOTH sources empty → status=failed, 0 upserts', async () => {
    const fetchImpl = buildRouterFetch({
      trending: [
        {
          ok: true,
          status: 200,
          body: fakeYouTubeTrendingBody([{ id: 'v1', title: 'entertainment', viewCount: 100 }]),
        },
      ],
      llmResponse: {
        ok: true,
        status: 200,
        // All learning_score below threshold → filtered out
        body: fakeLlmExtractResponse([
          { title: 'entertainment', keywords: ['ent'], learning_score: 0.1 },
        ]),
      },
      // suggest disabled → no fallback
    });

    const result = await executor.execute(buildExecuteCtx(fetchImpl));

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/0 keywords/);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('treats trending 404 as empty category (Phase 1 carry-over preserved)', async () => {
    const fetchImpl = buildRouterFetch({
      trending: [{ ok: false, status: 404, body: { error: { message: 'not found' } } }],
      llmResponse: { ok: true, status: 200, body: fakeLlmExtractResponse([]) },
    });

    const result = await executor.execute(buildExecuteCtx(fetchImpl));

    // No videos → no LLM keywords → no Suggest enabled → failed (different cause)
    expect(result.data['empty_categories']).toEqual(['27']);
    expect(result.data['videos_fetched']).toBe(0);
  });

  it('reports llm_duration_ms and suggest_duration_ms metrics', async () => {
    const fetchImpl = buildRouterFetch({
      trending: [
        {
          ok: true,
          status: 200,
          body: fakeYouTubeTrendingBody([{ id: 'v1', title: '파이썬', viewCount: 1000 }]),
        },
      ],
      llmResponse: {
        ok: true,
        status: 200,
        body: fakeLlmExtractResponse([
          { title: '파이썬', keywords: ['파이썬'], learning_score: 0.9 },
        ]),
      },
    });

    const result = await executor.execute(buildExecuteCtx(fetchImpl));
    expect(typeof result.data['llm_duration_ms']).toBe('number');
    expect(typeof result.data['suggest_duration_ms']).toBe('number');
    expect(result.metrics?.rows_written).toEqual({ trend_signals: 1 });
  });
});
