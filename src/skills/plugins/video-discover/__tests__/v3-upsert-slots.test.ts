/**
 * v3/executor — upsertSlots batch path tests
 *
 * Verifies that the batch INSERT … ON CONFLICT … RETURNING path:
 *  1. Returns `rows_upserted` as a number in the execute result (contract unchanged)
 *  2. Calls `notifyCardAdded` once per row returned by the batch RETURNING query
 *  3. Falls back to per-row Prisma upserts when `$queryRaw` throws
 *  4. Returns status='failed' with no DB calls when no slots are produced
 *
 * `upsertSlots` is private; it is exercised indirectly via `executor.execute`.
 */

// ─── Logger mock (must come before any module imports that use logger) ─────────
// database/client.ts calls logger.info at module-init time (line 94 / getPrismaClient
// singleton), so the mock must provide top-level methods, not just child().
const noopFn = jest.fn();
const noopLogger = {
  info: noopFn,
  warn: noopFn,
  error: noopFn,
  debug: noopFn,
  child: () => noopLogger,
};
jest.mock('@/utils/logger', () => ({ logger: noopLogger }));

// ─── Primary mocks ────────────────────────────────────────────────────────────

const mockQueryRaw = jest.fn();
const mockRecCacheUpsert = jest.fn();
const mockNotifyCardAdded = jest.fn();

jest.mock('@/modules/database', () => ({
  getPrismaClient: () => ({
    user_mandalas: {
      findFirst: jest.fn().mockResolvedValue({ id: 'mid' }),
    },
    recommendation_cache: {
      upsert: mockRecCacheUpsert,
    },
    $queryRaw: mockQueryRaw,
  }),
}));

jest.mock('@/modules/recommendations/publisher', () => ({
  notifyCardAdded: mockNotifyCardAdded,
}));

// ─── RedisProvider — unavailable so Tier 0 is a no-op ────────────────────────
jest.mock('@/skills/plugins/video-discover/v3/providers/redis-provider', () => ({
  RedisProvider: jest.fn().mockImplementation(() => ({
    health: jest.fn().mockResolvedValue({ available: false, lastError: 'test-mock' }),
    match: jest.fn().mockResolvedValue({ candidates: [], meta: { latencyMs: 0 } }),
  })),
}));

// ─── Tier 1 video pool — disabled ────────────────────────────────────────────
jest.mock('@/skills/plugins/video-discover/v3/cache-matcher', () => ({
  matchFromVideoPool: jest.fn().mockResolvedValue([]),
  groupByCell: jest.fn().mockReturnValue(new Map()),
}));

// ─── v3 feature flags — all disabled so no extra async paths ─────────────────
jest.mock('@/skills/plugins/video-discover/v3/config', () => ({
  v3Config: {
    enableTier1Cache: false,
    enableSemanticRerank: false,
    enableWhitelistGate: false,
    enableRedisProvider: false,
    maxQueries: 2,
  },
}));

// ─── Semantic rerank / whitelist gate ─────────────────────────────────────────
jest.mock('@/modules/video-dictionary', () => ({
  applySemanticRerank: jest.fn(),
  getSemanticRank: jest.fn().mockResolvedValue([]),
  filterByWhitelist: jest.fn(),
  getChannelWhitelist: jest.fn().mockResolvedValue(null),
}));

// ─── Mandala filter — pass all candidates through, assign to cell 0 ───────────
jest.mock('@/skills/plugins/video-discover/v3/mandala-filter', () => ({
  applyMandalaFilterWithStats: jest
    .fn()
    .mockImplementation((inputs: Array<{ videoId: string; title: string }>) => ({
      byCell: new Map([
        [0, inputs.map((c) => ({ candidate: { videoId: c.videoId }, score: 0.8 }))],
      ]),
      stats: {
        output: inputs.length,
        droppedByCenterGate: 0,
        droppedByJaccardBelowThreshold: 0,
        centerTokens: ['guitar'],
        subGoalTokenCounts: [1],
      },
    })),
  MIN_SUB_RELEVANCE: 0.05,
}));

// ─── Embedding (semantic gate, only used when centerGateMode==='semantic') ────
jest.mock('@/skills/plugins/iks-scorer/embedding', () => ({
  embedBatch: jest.fn().mockResolvedValue([]),
}));

// ─── YouTube client — provide one video for Tier 2 searches ──────────────────
const mockSearchVideos = jest.fn();
const mockVideosBatch = jest.fn();
jest.mock('@/skills/plugins/video-discover/v2/youtube-client', () => ({
  searchVideos: mockSearchVideos,
  videosBatch: mockVideosBatch,
  parseIsoDuration: jest.requireActual('@/skills/plugins/video-discover/v2/youtube-client')
    .parseIsoDuration,
  isShortsByDuration: jest.fn().mockReturnValue(false),
  titleIndicatesShorts: jest.fn().mockReturnValue(false),
  titleHitsBlocklist: jest.fn().mockReturnValue(false),
  resolveSearchApiKeys: jest.fn().mockReturnValue(['test-api-key']),
}));

// ─── LLM keyword builder — return one search query per cell ──────────────────
jest.mock('@/skills/plugins/video-discover/v2/keyword-builder', () => ({
  buildRuleBasedQueriesSync: jest
    .fn()
    .mockReturnValue([{ query: 'guitar chords beginner', cellIndex: 0 }]),
  runLLMQueries: jest.fn().mockResolvedValue([]),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { executor } from '../v3/executor';
import type { ExecuteContext } from '@/skills/_shared/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const USER_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const MANDALA_ID = 'bbbbbbbb-0000-0000-0000-000000000002';

function makeCtx(): ExecuteContext {
  return {
    userId: USER_ID,
    mandalaId: MANDALA_ID,
    tier: 'admin',
    env: {
      YOUTUBE_API_KEY_SEARCH: 'test-key',
      OPENROUTER_API_KEY: '',
    },
    llm: {} as never,
    state: {
      centerGoal: 'Learn guitar',
      subGoals: ['Chords', '', '', '', '', '', '', ''],
      language: 'en' as const,
      focusTags: [],
      targetLevel: 'standard',
    },
  };
}

/** Canned RETURNING row — matches the UpsertedRow interface in v3/executor.ts. */
function makeUpsertedRow(videoId: string) {
  return {
    id: `row-id-${videoId}`,
    video_id: videoId,
    title: `Title for ${videoId}`,
    channel: 'Test Channel',
    thumbnail: `https://img/${videoId}.jpg`,
    duration_sec: 300,
    rec_score: 0.75,
    cell_index: 0,
    keyword: 'Chords',
    weight_version: 3,
    rec_reason: 'realtime',
    published_at: new Date('2026-01-01T00:00:00Z'),
  };
}

/**
 * Canned YouTube search result in the shape expected by runSearchTraced
 * (YouTubeSearchItem with nested id/snippet).
 */
function makeSearchResult(videoId: string) {
  return {
    id: { videoId },
    snippet: {
      title: `Title for ${videoId}`,
      channelTitle: 'Test Channel',
      channelId: 'tc1',
      publishedAt: '2026-01-01T00:00:00Z',
      thumbnails: { high: { url: `https://img/${videoId}.jpg` } },
    },
  };
}

/**
 * Canned videos.list enrichment result in the shape of YouTubeVideoStatsItem
 * (nested statistics + contentDetails).
 */
function makeStatsResult(videoId: string) {
  return {
    id: videoId,
    statistics: {
      viewCount: '50000',
      likeCount: '2000',
    },
    contentDetails: { duration: 'PT5M' },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('v3/executor — upsertSlots batch path', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: searchVideos returns one video so Tier 2 produces one slot
    mockSearchVideos.mockResolvedValue([makeSearchResult('vid-default')]);
    mockVideosBatch.mockResolvedValue([makeStatsResult('vid-default')]);
  });

  it('returns rows_upserted as a number in the execute result (contract unchanged)', async () => {
    // Batch INSERT RETURNING yields two rows
    mockQueryRaw.mockResolvedValueOnce([makeUpsertedRow('vid-1'), makeUpsertedRow('vid-2')]);

    const result = await executor.execute(makeCtx());

    expect(result.status).toBe('success');
    expect(typeof result.data['rows_upserted']).toBe('number');
    expect(result.metrics?.rows_written?.['recommendation_cache']).toBeGreaterThanOrEqual(0);
  });

  it('calls notifyCardAdded once per row returned by the batch RETURNING query (SSE requirement)', async () => {
    const returnedRows = [makeUpsertedRow('vid-sse-1'), makeUpsertedRow('vid-sse-2')];
    // Tier 2 search returns two distinct videos
    mockSearchVideos.mockResolvedValueOnce([
      makeSearchResult('vid-sse-1'),
      makeSearchResult('vid-sse-2'),
    ]);
    mockVideosBatch.mockResolvedValue([makeStatsResult('vid-sse-1'), makeStatsResult('vid-sse-2')]);
    // Batch upsert returns the two rows
    mockQueryRaw.mockResolvedValueOnce(returnedRows);

    await executor.execute(makeCtx());

    // notifyCardAdded must be called exactly once per row in the RETURNING result
    expect(mockNotifyCardAdded).toHaveBeenCalledTimes(returnedRows.length);
    const notifiedVideoIds = (
      mockNotifyCardAdded.mock.calls as Array<[string, { videoId: string }]>
    ).map((args) => args[1].videoId);
    expect(notifiedVideoIds).toContain('vid-sse-1');
    expect(notifiedVideoIds).toContain('vid-sse-2');
  });

  it('falls back to per-row upserts when $queryRaw throws, still returns rows_upserted', async () => {
    // Batch INSERT fails (e.g. SQLite in CI)
    mockQueryRaw.mockRejectedValueOnce(new Error('syntax error near unnest'));
    // Per-row fallback succeeds
    mockRecCacheUpsert.mockResolvedValue(makeUpsertedRow('vid-fallback'));
    mockSearchVideos.mockResolvedValue([makeSearchResult('vid-fallback')]);
    mockVideosBatch.mockResolvedValue([makeStatsResult('vid-fallback')]);

    const result = await executor.execute(makeCtx());

    expect(['success', 'partial']).toContain(result.status);
    expect(typeof result.data['rows_upserted']).toBe('number');
    expect(result.data['rows_upserted'] as number).toBeGreaterThan(0);
    // per-row fallback was used
    expect(mockRecCacheUpsert).toHaveBeenCalled();
    // notifyCardAdded still fires via fallback path
    expect(mockNotifyCardAdded).toHaveBeenCalled();
  });

  it('returns status failed with no DB writes when Tier 2 produces zero slots', async () => {
    mockSearchVideos.mockResolvedValue([]);
    mockVideosBatch.mockResolvedValue([]);

    const result = await executor.execute(makeCtx());

    expect(result.status).toBe('failed');
    expect(mockQueryRaw).not.toHaveBeenCalled();
    expect(mockRecCacheUpsert).not.toHaveBeenCalled();
    expect(mockNotifyCardAdded).not.toHaveBeenCalled();
  });
});
