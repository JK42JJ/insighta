/**
 * promote-from-playlists — unit tests
 *
 * Covers:
 *  - filters out video IDs already in video_pool
 *  - inserts with source='user_playlist' and quality_tier='gold'
 *  - dryRun makes no writes
 *  - Ollama unreachable → promotes without embeddings (embeddings_skipped_unreachable=true)
 *  - videos missing metadata → pushed to errors, not inserted
 */

// ============================================================================
// Mocks — must be declared before any imports per jest.mock hoisting rules
// ============================================================================

const mockVideoPoolCreate = jest.fn();
const mockExecuteRaw = jest.fn();
const mockQueryRaw = jest.fn();

jest.mock('@/modules/database/client', () => ({
  getPrismaClient: () => ({
    video_pool: { create: mockVideoPoolCreate },
    $executeRaw: mockExecuteRaw,
    $queryRaw: mockQueryRaw,
  }),
}));

const mockGetUserPlaylists = jest.fn();
const mockGetPlaylistItems = jest.fn();
const mockGetVideosMetadata = jest.fn();

jest.mock('@/modules/youtube/api', () => ({
  getUserPlaylists: (...args: unknown[]) => mockGetUserPlaylists(...args),
  getPlaylistItems: (...args: unknown[]) => mockGetPlaylistItems(...args),
  getVideosMetadata: (...args: unknown[]) => mockGetVideosMetadata(...args),
}));

const mockIsOllamaReachable = jest.fn();
const mockEmbedBatch = jest.fn();
const mockVectorToLiteral = jest.fn((v: number[]) => `[${v.join(',')}]`);

jest.mock('@/skills/plugins/iks-scorer/embedding', () => ({
  isOllamaReachable: (...args: unknown[]) => mockIsOllamaReachable(...args),
  embedBatch: (...args: unknown[]) => mockEmbedBatch(...args),
  vectorToLiteral: (v: number[]) => mockVectorToLiteral(v),
  QWEN3_EMBED_MODEL: 'qwen3-embedding:8b',
  MAC_MINI_OLLAMA_DEFAULT_URL: 'http://100.91.173.17:11434',
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

// ============================================================================
// Import SUT after mocks
// ============================================================================

import { promotePlaylistsToVideoPool } from '../../../src/modules/video-pool/promote-from-playlists';

// ============================================================================
// Helpers
// ============================================================================

const USER_ID = 'user-abc123';

function makePlaylists(ids: string[]) {
  return {
    items: ids.map((playlistId) => ({
      playlistId,
      title: 'Test',
      description: '',
      thumbnailUrl: '',
      itemCount: 2,
      publishedAt: '',
    })),
    totalResults: ids.length,
  };
}

function makePlaylistItems(videoIds: string[]) {
  return {
    items: videoIds.map((videoId, i) => ({ videoId, position: i })),
    totalResults: videoIds.length,
  };
}

function makeVideoMeta(videoId: string, overrides: Partial<{ title: string }> = {}) {
  return {
    videoId,
    title: overrides.title ?? `Title for ${videoId}`,
    description: 'A description',
    channelTitle: 'Test Channel',
    channelId: 'UC123',
    durationSeconds: 300,
    viewCount: 1000,
    likeCount: 100,
    publishedAt: '2024-01-01T00:00:00Z',
    thumbnailUrl: 'https://example.com/thumb.jpg',
    defaultLanguage: 'ko',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsOllamaReachable.mockResolvedValue(true);
  mockEmbedBatch.mockResolvedValue([[0.1, 0.2, 0.3]]);
  mockVideoPoolCreate.mockResolvedValue({});
  mockExecuteRaw.mockResolvedValue(1);
});

// ============================================================================
// Tests
// ============================================================================

describe('promotePlaylistsToVideoPool', () => {
  it('filters out video IDs already in video_pool', async () => {
    mockGetUserPlaylists.mockResolvedValueOnce(makePlaylists(['PL1']));
    mockGetPlaylistItems.mockResolvedValueOnce(makePlaylistItems(['vid-A', 'vid-B', 'vid-C']));
    // vid-B already in video_pool
    mockQueryRaw.mockResolvedValueOnce([{ video_id: 'vid-B' }]);
    mockGetVideosMetadata.mockResolvedValueOnce([makeVideoMeta('vid-A'), makeVideoMeta('vid-C')]);
    mockEmbedBatch.mockResolvedValue([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);

    const result = await promotePlaylistsToVideoPool({ userId: USER_ID });

    expect(result.candidates).toBe(2); // vid-A + vid-C
    expect(result.promoted).toBe(2);
    expect(mockVideoPoolCreate).toHaveBeenCalledTimes(2);

    const createdIds = mockVideoPoolCreate.mock.calls.map((c: any[]) => c[0].data.video_id);
    expect(createdIds).toContain('vid-A');
    expect(createdIds).toContain('vid-C');
    expect(createdIds).not.toContain('vid-B');
  });

  it("inserts with source='user_playlist' and quality_tier='gold'", async () => {
    mockGetUserPlaylists.mockResolvedValueOnce(makePlaylists(['PL1']));
    mockGetPlaylistItems.mockResolvedValueOnce(makePlaylistItems(['vid-X']));
    mockQueryRaw.mockResolvedValueOnce([]); // nothing in pool
    mockGetVideosMetadata.mockResolvedValueOnce([makeVideoMeta('vid-X')]);
    mockEmbedBatch.mockResolvedValue([[0.5, 0.6]]);

    await promotePlaylistsToVideoPool({ userId: USER_ID });

    expect(mockVideoPoolCreate).toHaveBeenCalledTimes(1);
    const data = mockVideoPoolCreate.mock.calls[0][0].data;
    expect(data.source).toBe('user_playlist');
    expect(data.quality_tier).toBe('gold');
    expect(data.video_id).toBe('vid-X');
  });

  it('dryRun makes no writes and returns planned counts', async () => {
    mockGetUserPlaylists.mockResolvedValueOnce(makePlaylists(['PL1']));
    mockGetPlaylistItems.mockResolvedValueOnce(makePlaylistItems(['vid-Y', 'vid-Z']));
    mockQueryRaw.mockResolvedValueOnce([]); // nothing in pool

    const result = await promotePlaylistsToVideoPool({ userId: USER_ID, dryRun: true });

    expect(result.promoted).toBe(0);
    expect(result.embedded).toBe(0);
    expect(result.candidates).toBe(2);
    expect(mockVideoPoolCreate).not.toHaveBeenCalled();
    expect(mockExecuteRaw).not.toHaveBeenCalled();
    // getVideosMetadata should not be called during dryRun
    expect(mockGetVideosMetadata).not.toHaveBeenCalled();
  });

  it('Ollama unreachable → promotes without embeddings, embeddings_skipped_unreachable=true', async () => {
    mockIsOllamaReachable.mockResolvedValue(false);
    mockGetUserPlaylists.mockResolvedValueOnce(makePlaylists(['PL1']));
    mockGetPlaylistItems.mockResolvedValueOnce(makePlaylistItems(['vid-1']));
    mockQueryRaw.mockResolvedValueOnce([]);
    mockGetVideosMetadata.mockResolvedValueOnce([makeVideoMeta('vid-1')]);

    const result = await promotePlaylistsToVideoPool({ userId: USER_ID });

    expect(result.embeddings_skipped_unreachable).toBe(true);
    expect(result.promoted).toBe(1);
    expect(result.embedded).toBe(0);
    expect(mockEmbedBatch).not.toHaveBeenCalled();
    // video_pool row should still be inserted
    expect(mockVideoPoolCreate).toHaveBeenCalledTimes(1);
    // embedding row should NOT be inserted
    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });

  it('videos missing metadata → pushed to errors and not inserted', async () => {
    mockGetUserPlaylists.mockResolvedValueOnce(makePlaylists(['PL1']));
    mockGetPlaylistItems.mockResolvedValueOnce(makePlaylistItems(['vid-good', 'vid-bad']));
    mockQueryRaw.mockResolvedValueOnce([]); // nothing in pool
    // Only vid-good has metadata; vid-bad is absent from API response
    mockGetVideosMetadata.mockResolvedValueOnce([makeVideoMeta('vid-good')]);
    mockEmbedBatch.mockResolvedValue([[0.1, 0.2]]);

    const result = await promotePlaylistsToVideoPool({ userId: USER_ID });

    expect(result.promoted).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.video_id).toBe('vid-bad');
    expect(mockVideoPoolCreate).toHaveBeenCalledTimes(1);
    expect(mockVideoPoolCreate.mock.calls[0][0].data.video_id).toBe('vid-good');
  });

  it('returns playlists_scanned count', async () => {
    mockGetUserPlaylists.mockResolvedValueOnce(makePlaylists(['PL1', 'PL2', 'PL3']));
    mockGetPlaylistItems
      .mockResolvedValueOnce(makePlaylistItems([]))
      .mockResolvedValueOnce(makePlaylistItems([]))
      .mockResolvedValueOnce(makePlaylistItems([]));
    mockQueryRaw.mockResolvedValue([]);
    mockGetVideosMetadata.mockResolvedValue([]);

    const result = await promotePlaylistsToVideoPool({ userId: USER_ID });

    expect(result.playlists_scanned).toBe(3);
    expect(result.candidates).toBe(0);
  });
});
