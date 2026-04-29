/**
 * Unit tests for promote-from-v2 (CP438).
 *
 * Mocks Prisma + the embedding helpers so we can exercise the tier
 * mapping, error handling, and dry-run path without touching DB or
 * the Mac Mini Ollama box.
 */

const mockQueryRaw = jest.fn();
const mockExecuteRaw = jest.fn();
const mockVideoPoolCreate = jest.fn();
jest.mock('@/modules/database/client', () => ({
  getPrismaClient: () => ({
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
    $executeRaw: (...args: unknown[]) => mockExecuteRaw(...args),
    video_pool: { create: (...args: unknown[]) => mockVideoPoolCreate(...args) },
  }),
}));

const mockEmbedBatch = jest.fn();
const mockIsOllamaReachable = jest.fn();
jest.mock('@/skills/plugins/iks-scorer/embedding', () => ({
  embedBatch: (...args: unknown[]) => mockEmbedBatch(...args),
  isOllamaReachable: (...args: unknown[]) => mockIsOllamaReachable(...args),
  vectorToLiteral: (vec: number[]) => `[${vec.join(',')}]`,
  QWEN3_EMBED_MODEL: 'qwen3-embedding:8b',
  MAC_MINI_OLLAMA_DEFAULT_URL: 'http://test',
}));

import { promoteV2ToVideoPool } from '@/modules/video-pool/promote-from-v2';

const baseRow = {
  yv_title: 'Title',
  yv_description: null,
  yv_channel_title: null,
  yv_channel_id: null,
  yv_view_count: BigInt(100),
  yv_like_count: BigInt(10),
  yv_duration_seconds: 600,
  yv_published_at: null,
  yv_thumbnail_url: null,
  yv_default_language: 'ko',
  one_liner: 'concise summary',
  source_language: 'ko',
  core: null,
  analysis: { core_argument: 'argument' },
};

beforeEach(() => {
  mockQueryRaw.mockReset();
  mockExecuteRaw.mockReset();
  mockVideoPoolCreate.mockReset();
  mockEmbedBatch.mockReset();
  mockIsOllamaReachable.mockReset();
});

describe('promoteV2ToVideoPool', () => {
  test('zero candidates returns counts of zero', async () => {
    mockQueryRaw.mockResolvedValueOnce([]);
    const r = await promoteV2ToVideoPool({ limit: 100 });
    expect(r.candidates).toBe(0);
    expect(r.promoted).toBe(0);
    expect(mockVideoPoolCreate).not.toHaveBeenCalled();
    expect(mockIsOllamaReachable).not.toHaveBeenCalled();
  });

  test('quality_tier from completeness ≥0.9 (gold) else silver', async () => {
    mockQueryRaw.mockResolvedValueOnce([
      { ...baseRow, video_id: 'g1', completeness: 0.95 },
      { ...baseRow, video_id: 'g2', completeness: 0.9 },
      { ...baseRow, video_id: 's1', completeness: 0.7 },
      { ...baseRow, video_id: 's2', completeness: null },
    ]);
    mockIsOllamaReachable.mockResolvedValueOnce(true);
    mockEmbedBatch.mockResolvedValueOnce([[0.1], [0.2], [0.3], [0.4]]);
    const r = await promoteV2ToVideoPool({ limit: 100 });
    expect(r.candidates).toBe(4);
    expect(r.promoted).toBe(4);
    expect(r.gold).toBe(2);
    expect(r.silver).toBe(2);
    expect(r.embedded).toBe(4);
    expect(mockVideoPoolCreate).toHaveBeenCalledTimes(4);
    const tiers = mockVideoPoolCreate.mock.calls.map(
      (c) => (c[0] as { data: { quality_tier: string } }).data.quality_tier
    );
    expect(tiers.filter((t) => t === 'gold')).toHaveLength(2);
    expect(tiers.filter((t) => t === 'silver')).toHaveLength(2);
  });

  test('source field always = v2_promoted', async () => {
    mockQueryRaw.mockResolvedValueOnce([{ ...baseRow, video_id: 'a1', completeness: 0.95 }]);
    mockIsOllamaReachable.mockResolvedValueOnce(false);
    const r = await promoteV2ToVideoPool({ limit: 100 });
    expect(r.promoted).toBe(1);
    expect(r.embeddings_skipped_unreachable).toBe(true);
    expect(
      (mockVideoPoolCreate.mock.calls[0]![0] as { data: { source: string } }).data.source
    ).toBe('v2_promoted');
  });

  test('Ollama unreachable → promote without embeddings', async () => {
    mockQueryRaw.mockResolvedValueOnce([
      { ...baseRow, video_id: 'a', completeness: 0.95 },
      { ...baseRow, video_id: 'b', completeness: 0.5 },
    ]);
    mockIsOllamaReachable.mockResolvedValueOnce(false);
    const r = await promoteV2ToVideoPool({ limit: 100 });
    expect(r.promoted).toBe(2);
    expect(r.embedded).toBe(0);
    expect(r.embeddings_skipped_unreachable).toBe(true);
    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });

  test('skips rows where youtube_videos metadata missing', async () => {
    mockQueryRaw.mockResolvedValueOnce([
      { ...baseRow, video_id: 'orphan', yv_title: null, completeness: 0.9 },
    ]);
    mockIsOllamaReachable.mockResolvedValueOnce(false);
    const r = await promoteV2ToVideoPool({ limit: 100 });
    expect(r.candidates).toBe(1);
    expect(r.promoted).toBe(0);
    expect(r.errors).toEqual([{ video_id: 'orphan', error: 'youtube_videos missing' }]);
  });

  test('dry-run returns gold/silver counts without writes', async () => {
    mockQueryRaw.mockResolvedValueOnce([
      { ...baseRow, video_id: 'g', completeness: 0.95 },
      { ...baseRow, video_id: 's', completeness: 0.5 },
    ]);
    const r = await promoteV2ToVideoPool({ limit: 100, dryRun: true });
    expect(r.candidates).toBe(2);
    expect(r.promoted).toBe(0);
    expect(r.gold).toBe(1);
    expect(r.silver).toBe(1);
    expect(mockVideoPoolCreate).not.toHaveBeenCalled();
    expect(mockIsOllamaReachable).not.toHaveBeenCalled();
  });

  test('embed count mismatch falls back to no embeddings', async () => {
    mockQueryRaw.mockResolvedValueOnce([
      { ...baseRow, video_id: 'a', completeness: 0.5 },
      { ...baseRow, video_id: 'b', completeness: 0.5 },
    ]);
    mockIsOllamaReachable.mockResolvedValueOnce(true);
    mockEmbedBatch.mockResolvedValueOnce([[0.1]]); // mismatch — only 1 vec for 2 candidates
    const r = await promoteV2ToVideoPool({ limit: 100 });
    expect(r.promoted).toBe(2);
    expect(r.embedded).toBe(0);
    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });
});
