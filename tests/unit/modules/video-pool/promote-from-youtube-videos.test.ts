/**
 * Unit tests for promote-from-youtube-videos (CP494 ② supply bridge).
 *
 * Mocks Prisma + the embedding helpers (promote-from-v2.test.ts mirror).
 * classifyQuality runs REAL — the gold/silver admit + bronze/rejected skip
 * gate is the subject under test. Durations are ≥180s so shortGateFields
 * short-circuits without an HTTP probe.
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

import { promoteYoutubeVideosToPool } from '@/modules/video-pool/promote-from-youtube-videos';

// view_count floors (batch-video-collector manifest): gold ≥100K, silver ≥10K,
// bronze ≥1K, rejected <1K. duration valid range 60..3600s.
const baseRow = {
  title: 'A perfectly reasonable video title',
  description: 'full snippet description text',
  channel_title: 'Channel',
  channel_id: 'UCabc123',
  like_count: BigInt(10),
  duration_seconds: 600,
  published_at: null,
  thumbnail_url: null,
  default_language: null,
};

beforeEach(() => {
  mockQueryRaw.mockReset();
  mockExecuteRaw.mockReset();
  mockVideoPoolCreate.mockReset();
  mockEmbedBatch.mockReset();
  mockIsOllamaReachable.mockReset();
});

describe('promoteYoutubeVideosToPool', () => {
  test('zero candidates returns counts of zero', async () => {
    mockQueryRaw.mockResolvedValueOnce([]);
    const r = await promoteYoutubeVideosToPool({ limit: 100 });
    expect(r.candidates).toBe(0);
    expect(r.promoted).toBe(0);
    expect(mockVideoPoolCreate).not.toHaveBeenCalled();
    expect(mockIsOllamaReachable).not.toHaveBeenCalled();
  });

  test('candidate SQL dedupes via NOT EXISTS against video_pool', async () => {
    mockQueryRaw.mockResolvedValueOnce([]);
    await promoteYoutubeVideosToPool({ limit: 100 });
    const sql = JSON.stringify(mockQueryRaw.mock.calls[0]);
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('video_pool');
  });

  test('candidate SQL prefilters hard floors so skip rows never occupy the window', async () => {
    mockQueryRaw.mockResolvedValueOnce([]);
    await promoteYoutubeVideosToPool({ limit: 100 });
    const sql = JSON.stringify(mockQueryRaw.mock.calls[0]);
    // bound values = same constants the JS gate uses (silver floor + duration range)
    expect(sql).toContain('view_count >=');
    expect(sql).toContain('duration_seconds BETWEEN');
    expect(sql).toContain('10000'); // QUALITY_SILVER_VIEW_COUNT
    expect(sql).toContain('3600'); // MAX_DURATION_SEC
  });

  test('skipEmbeddings: no probe, no embed, no embeddings INSERT; flag stays truthful', async () => {
    mockQueryRaw.mockResolvedValueOnce([
      { ...baseRow, video_id: 'g1', view_count: BigInt(200_000) },
    ]);
    const r = await promoteYoutubeVideosToPool({ limit: 100, skipEmbeddings: true });
    expect(r.promoted).toBe(1);
    expect(r.embedded).toBe(0);
    expect(r.embeddings_skipped_unreachable).toBe(false); // skipped by request ≠ unreachable
    expect(mockIsOllamaReachable).not.toHaveBeenCalled();
    expect(mockEmbedBatch).not.toHaveBeenCalled();
    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });

  test('gold/silver promoted; bronze and rejected skipped', async () => {
    mockQueryRaw.mockResolvedValueOnce([
      { ...baseRow, video_id: 'g1', view_count: BigInt(200_000) }, // gold
      { ...baseRow, video_id: 's1', view_count: BigInt(50_000) }, // silver
      { ...baseRow, video_id: 'b1', view_count: BigInt(5_000) }, // bronze → skip
      { ...baseRow, video_id: 'r1', view_count: BigInt(500) }, // below floor → skip
      { ...baseRow, video_id: 'r2', view_count: BigInt(50_000), duration_seconds: 30 }, // too short → skip
    ]);
    mockIsOllamaReachable.mockResolvedValueOnce(false);
    const r = await promoteYoutubeVideosToPool({ limit: 100 });
    expect(r.candidates).toBe(5);
    expect(r.promoted).toBe(2);
    expect(r.gold).toBe(1);
    expect(r.silver).toBe(1);
    expect(r.skipped_bronze).toBe(1);
    expect(r.skipped_rejected).toBe(2);
    expect(mockVideoPoolCreate).toHaveBeenCalledTimes(2);
    const ids = mockVideoPoolCreate.mock.calls.map(
      (c) => (c[0] as { data: { video_id: string } }).data.video_id
    );
    expect(ids).toEqual(['g1', 's1']);
  });

  test('create carries description, channel_id, source=yt_promoted, language fallback ko', async () => {
    mockQueryRaw.mockResolvedValueOnce([
      { ...baseRow, video_id: 'v1', view_count: BigInt(200_000) },
    ]);
    mockIsOllamaReachable.mockResolvedValueOnce(false);
    const r = await promoteYoutubeVideosToPool({ limit: 100 });
    expect(r.promoted).toBe(1);
    const data = (
      mockVideoPoolCreate.mock.calls[0]![0] as {
        data: {
          description: string | null;
          channel_id: string | null;
          source: string;
          language: string;
          quality_tier: string;
        };
      }
    ).data;
    expect(data.description).toBe('full snippet description text');
    expect(data.channel_id).toBe('UCabc123');
    expect(data.source).toBe('yt_promoted');
    expect(data.language).toBe('ko'); // default_language null → fallback
    expect(data.quality_tier).toBe('gold');
  });

  test('embeddings index admissible rows, not raw candidates (skip offset safety)', async () => {
    mockQueryRaw.mockResolvedValueOnce([
      { ...baseRow, video_id: 'r1', view_count: BigInt(100) }, // rejected (index 0 of candidates)
      { ...baseRow, video_id: 'g1', view_count: BigInt(200_000) }, // gold (index 0 of admissible)
    ]);
    mockIsOllamaReachable.mockResolvedValueOnce(true);
    mockEmbedBatch.mockResolvedValueOnce([[0.1]]); // ONE vector for ONE admissible row
    const r = await promoteYoutubeVideosToPool({ limit: 100 });
    expect(r.promoted).toBe(1);
    expect(r.embedded).toBe(1);
    // embedBatch received only the admissible row's text
    const inputs = mockEmbedBatch.mock.calls[0]![0] as string[];
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toContain('A perfectly reasonable video title');
    // the embedding INSERT targeted the gold row
    expect(JSON.stringify(mockExecuteRaw.mock.calls[0])).toContain('g1');
  });

  test('Ollama unreachable → promote without embeddings', async () => {
    mockQueryRaw.mockResolvedValueOnce([
      { ...baseRow, video_id: 'g1', view_count: BigInt(200_000) },
    ]);
    mockIsOllamaReachable.mockResolvedValueOnce(false);
    const r = await promoteYoutubeVideosToPool({ limit: 100 });
    expect(r.promoted).toBe(1);
    expect(r.embedded).toBe(0);
    expect(r.embeddings_skipped_unreachable).toBe(true);
    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });

  test('dry-run returns gate counts without any write or probe', async () => {
    mockQueryRaw.mockResolvedValueOnce([
      { ...baseRow, video_id: 'g1', view_count: BigInt(200_000) },
      { ...baseRow, video_id: 's1', view_count: BigInt(50_000) },
      { ...baseRow, video_id: 'b1', view_count: BigInt(5_000) },
      { ...baseRow, video_id: 'r1', view_count: BigInt(1) },
    ]);
    const r = await promoteYoutubeVideosToPool({ limit: 100, dryRun: true });
    expect(r.candidates).toBe(4);
    expect(r.promoted).toBe(0);
    expect(r.gold).toBe(1);
    expect(r.silver).toBe(1);
    expect(r.skipped_bronze).toBe(1);
    expect(r.skipped_rejected).toBe(1);
    expect(mockVideoPoolCreate).not.toHaveBeenCalled();
    expect(mockIsOllamaReachable).not.toHaveBeenCalled();
  });

  test('per-row create failure is collected, not thrown', async () => {
    mockQueryRaw.mockResolvedValueOnce([
      { ...baseRow, video_id: 'g1', view_count: BigInt(200_000) },
      { ...baseRow, video_id: 'g2', view_count: BigInt(200_000) },
    ]);
    mockIsOllamaReachable.mockResolvedValueOnce(false);
    mockVideoPoolCreate.mockRejectedValueOnce(new Error('duplicate key')).mockResolvedValueOnce({});
    const r = await promoteYoutubeVideosToPool({ limit: 100 });
    expect(r.promoted).toBe(1);
    expect(r.errors).toEqual([{ video_id: 'g1', error: 'duplicate key' }]);
  });
});
