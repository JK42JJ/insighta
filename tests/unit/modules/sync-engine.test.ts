/**
 * SyncEngine Unit Tests
 *
 * Tests for SyncEngine implementation:
 * - Playlist synchronization orchestration
 * - Change detection (additions, deletions, reordering)
 * - Transaction management
 * - Quota tracking
 * - Error handling and retries
 */

import { SyncEngine, getSyncEngine } from '../../../src/modules/sync/engine';
import { SyncStatus } from '../../../src/types/enums';
import { db, executeTransaction } from '../../../src/modules/database/client';
import { getPlaylistManager } from '../../../src/modules/playlist/manager';
import { getVideoManager } from '../../../src/modules/video/manager';
import { getYouTubeClient } from '../../../src/api/client';
import { getQuotaManager } from '../../../src/modules/quota/manager';
import { retry } from '../../../src/utils/retry';
import {
  getErrorRecoveryManager,
  resetErrorRecoveryManager,
} from '../../../src/utils/error-recovery';

// Mock dependencies
jest.mock('../../../src/modules/database/client', () => ({
  db: {
    syncHistory: {},
    playlistItem: {},
    playlist: {},
    video: {},
  },
  executeTransaction: jest.fn(),
}));
jest.mock('../../../src/modules/playlist/manager');
jest.mock('../../../src/modules/video/manager');
jest.mock('../../../src/api/client');
jest.mock('../../../src/modules/quota/manager');
jest.mock('../../../src/utils/retry');
jest.mock('../../../src/utils/logger');
jest.mock('../../../src/utils/error-recovery', () => ({
  getErrorRecoveryManager: jest.fn(),
  resetErrorRecoveryManager: jest.fn(),
  RecoveryStrategy: {
    RETRY: 'RETRY',
    FAIL: 'FAIL',
    FALLBACK: 'FALLBACK',
    CIRCUIT_BREAK: 'CIRCUIT_BREAK',
  },
}));

describe('SyncEngine', () => {
  let engine: SyncEngine;
  let mockPlaylistManager: any;
  let mockVideoManager: any;
  let mockYouTubeClient: any;
  let mockQuotaManager: any;
  let mockDb: any;
  let mockRecoveryManager: any;

  // Mock data
  const mockPlaylist = {
    id: 'playlist-1',
    youtubeId: 'PLtest123',
    title: 'Test Playlist',
    itemCount: 0,
    lastSyncedAt: null,
  };

  const mockYtItems = [
    {
      snippet: {
        resourceId: { videoId: 'video1' },
        position: 0,
        publishedAt: '2024-01-01T00:00:00Z',
      },
    },
    {
      snippet: {
        resourceId: { videoId: 'video2' },
        position: 1,
        publishedAt: '2024-01-02T00:00:00Z',
      },
    },
    {
      snippet: {
        resourceId: { videoId: 'video3' },
        position: 2,
        publishedAt: '2024-01-03T00:00:00Z',
      },
    },
  ];

  const mockVideos = [
    {
      id: { videoId: 'video1' },
      snippet: { title: 'Video 1', description: 'Description 1' },
      contentDetails: { duration: 'PT10M30S' },
      statistics: { viewCount: '1000', likeCount: '100' },
    },
    {
      id: { videoId: 'video2' },
      snippet: { title: 'Video 2', description: 'Description 2' },
      contentDetails: { duration: 'PT5M15S' },
      statistics: { viewCount: '2000', likeCount: '200' },
    },
    {
      id: { videoId: 'video3' },
      snippet: { title: 'Video 3', description: 'Description 3' },
      contentDetails: { duration: 'PT8M45S' },
      statistics: { viewCount: '3000', likeCount: '300' },
    },
  ];

  const mockDbVideos = [
    { id: 'db-video-1', youtubeId: 'video1', title: 'Video 1' },
    { id: 'db-video-2', youtubeId: 'video2', title: 'Video 2' },
    { id: 'db-video-3', youtubeId: 'video3', title: 'Video 3' },
  ];

  const mockCurrentItems = [
    {
      id: 'item-1',
      playlistId: 'playlist-1',
      videoId: 'db-video-1',
      position: 0,
      removedAt: null,
      video: { youtubeId: 'video1' },
    },
  ];

  const mockSyncHistory = {
    id: 'sync-1',
    playlistId: 'playlist-1',
    status: SyncStatus.IN_PROGRESS,
    startedAt: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock playlist manager
    mockPlaylistManager = {
      getPlaylist: jest.fn(),
      acquireSyncLock: jest.fn(),
      releaseSyncLock: jest.fn(),
      listPlaylists: jest.fn(),
    };
    (getPlaylistManager as jest.Mock).mockReturnValue(mockPlaylistManager);

    // Setup mock video manager
    mockVideoManager = {
      upsertVideos: jest.fn(),
    };
    (getVideoManager as jest.Mock).mockReturnValue(mockVideoManager);

    // Setup mock YouTube client
    mockYouTubeClient = {
      getPlaylistItems: jest.fn(),
      getVideosBatch: jest.fn(),
    };
    (getYouTubeClient as jest.Mock).mockReturnValue(mockYouTubeClient);

    // Setup mock quota manager
    mockQuotaManager = {
      getOperationCost: jest.fn(),
      reserveQuota: jest.fn(),
    };
    (getQuotaManager as jest.Mock).mockReturnValue(mockQuotaManager);

    // Setup mock database
    mockDb = {
      syncHistory: {
        create: jest.fn(),
        update: jest.fn(),
      },
      playlistItem: {
        findMany: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      playlist: {
        update: jest.fn(),
      },
      video: {
        findUnique: jest.fn(),
      },
    };
    // Assign mocks to the mocked db object
    (db as any).syncHistory = mockDb.syncHistory;
    (db as any).playlistItem = mockDb.playlistItem;
    (db as any).playlist = mockDb.playlist;
    (db as any).video = mockDb.video;

    // Setup retry to execute immediately
    (retry as jest.Mock).mockImplementation((fn) => fn());

    // Setup transaction to execute immediately
    (executeTransaction as jest.Mock).mockImplementation(async (fn) => {
      const tx = mockDb;
      return fn(tx);
    });

    // Setup mock error recovery manager - execute operations immediately
    mockRecoveryManager = {
      executeWithRecovery: jest.fn().mockImplementation(async (operation) => {
        try {
          const data = await operation();
          return { success: true, data };
        } catch (error) {
          return { success: false, error };
        }
      }),
      getCircuitState: jest.fn().mockReturnValue('CLOSED'),
    };
    (getErrorRecoveryManager as jest.Mock).mockReturnValue(mockRecoveryManager);

    engine = new SyncEngine();
  });

  describe('syncPlaylist', () => {
    beforeEach(() => {
      mockPlaylistManager.getPlaylist.mockResolvedValue(mockPlaylist);
      mockPlaylistManager.acquireSyncLock.mockResolvedValue(undefined);
      mockPlaylistManager.releaseSyncLock.mockResolvedValue(undefined);
      mockDb.syncHistory.create.mockResolvedValue(mockSyncHistory);
      mockDb.syncHistory.update.mockResolvedValue({ ...mockSyncHistory, status: SyncStatus.COMPLETED });
      mockQuotaManager.getOperationCost.mockReturnValue(10);
      mockQuotaManager.reserveQuota.mockResolvedValue(undefined);
      mockYouTubeClient.getPlaylistItems.mockResolvedValue(mockYtItems);
      mockYouTubeClient.getVideosBatch.mockResolvedValue(mockVideos);
      mockVideoManager.upsertVideos.mockResolvedValue(undefined);
      mockDb.playlistItem.findMany.mockResolvedValue(mockCurrentItems);
      mockDb.playlist.update.mockResolvedValue(mockPlaylist);
    });

    test('should sync playlist successfully with additions', async () => {
      // Setup: Current has video1, YouTube has video1, video2, video3
      mockDb.video.findUnique.mockImplementation((args: any) => {
        const videoMap: any = {
          video1: mockDbVideos[0],
          video2: mockDbVideos[1],
          video3: mockDbVideos[2],
        };
        return Promise.resolve(videoMap[args.where.youtubeId]);
      });

      const result = await engine.syncPlaylist('playlist-1');

      expect(result.status).toBe(SyncStatus.COMPLETED);
      expect(result.itemsAdded).toBe(2); // video2 and video3 added
      expect(result.itemsRemoved).toBe(0);
      expect(result.itemsReordered).toBe(0);
      expect(result.quotaUsed).toBeGreaterThan(0);
      expect(result.duration).toBeGreaterThanOrEqual(0);

      // Verify sync lock acquired and released
      expect(mockPlaylistManager.acquireSyncLock).toHaveBeenCalledWith('playlist-1');
      expect(mockPlaylistManager.releaseSyncLock).toHaveBeenCalledWith('playlist-1', SyncStatus.COMPLETED);

      // Verify sync history created and updated
      expect(mockDb.syncHistory.create).toHaveBeenCalled();
      expect(mockDb.syncHistory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockSyncHistory.id },
          data: expect.objectContaining({
            status: SyncStatus.COMPLETED,
            itemsAdded: 2,
          }),
        })
      );

      // Verify playlist metadata updated
      expect(mockDb.playlist.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'playlist-1' },
          data: expect.objectContaining({
            itemCount: 3,
            lastSyncedAt: expect.any(Date),
          }),
        })
      );
    });

    test('should sync playlist successfully with deletions', async () => {
      // Setup: Current has video1, video2, video3, YouTube has video1
      const currentItemsWithMore = [
        mockCurrentItems[0],
        {
          id: 'item-2',
          playlistId: 'playlist-1',
          videoId: 'db-video-2',
          position: 1,
          removedAt: null,
          video: { youtubeId: 'video2' },
        },
        {
          id: 'item-3',
          playlistId: 'playlist-1',
          videoId: 'db-video-3',
          position: 2,
          removedAt: null,
          video: { youtubeId: 'video3' },
        },
      ];
      mockDb.playlistItem.findMany.mockResolvedValue(currentItemsWithMore);
      mockYouTubeClient.getPlaylistItems.mockResolvedValue([mockYtItems[0]]); // Only video1

      const result = await engine.syncPlaylist('playlist-1');

      expect(result.status).toBe(SyncStatus.COMPLETED);
      expect(result.itemsAdded).toBe(0);
      expect(result.itemsRemoved).toBe(2); // video2 and video3 removed
      expect(result.itemsReordered).toBe(0);

      // Verify items marked as removed
      expect(mockDb.playlistItem.update).toHaveBeenCalledTimes(2);
      expect(mockDb.playlistItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'item-2' },
          data: { removedAt: expect.any(Date) },
        })
      );
    });

    test('should sync playlist successfully with reordering', async () => {
      // Setup: Current has video1 at position 0, YouTube has video1 at position 2
      const reorderedYtItems = [
        {
          snippet: {
            resourceId: { videoId: 'video1' },
            position: 2, // Changed from 0 to 2
            publishedAt: '2024-01-01T00:00:00Z',
          },
        },
      ];
      mockYouTubeClient.getPlaylistItems.mockResolvedValue(reorderedYtItems);

      const result = await engine.syncPlaylist('playlist-1');

      expect(result.status).toBe(SyncStatus.COMPLETED);
      expect(result.itemsAdded).toBe(0);
      expect(result.itemsRemoved).toBe(0);
      expect(result.itemsReordered).toBe(1);

      // Verify position updated
      expect(mockDb.playlistItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'item-1' },
          data: { position: 2 },
        })
      );
    });

    test('should sync playlist with mixed changes', async () => {
      // Setup: Current has video1, YouTube has video2, video3
      mockDb.playlistItem.findMany.mockResolvedValue([mockCurrentItems[0]]);
      mockYouTubeClient.getPlaylistItems.mockResolvedValue([mockYtItems[1], mockYtItems[2]]); // video2, video3
      mockDb.video.findUnique.mockImplementation((args: any) => {
        const videoMap: any = {
          video2: mockDbVideos[1],
          video3: mockDbVideos[2],
        };
        return Promise.resolve(videoMap[args.where.youtubeId]);
      });

      const result = await engine.syncPlaylist('playlist-1');

      expect(result.status).toBe(SyncStatus.COMPLETED);
      expect(result.itemsAdded).toBe(2); // video2, video3 added
      expect(result.itemsRemoved).toBe(1); // video1 removed
      expect(result.itemsReordered).toBe(0);
    });

    test('should handle quota reservation', async () => {
      await engine.syncPlaylist('playlist-1');

      // Verify quota reserved for playlist items
      expect(mockQuotaManager.reserveQuota).toHaveBeenCalledWith('playlist.items', 10);

      // Verify quota reserved for videos
      expect(mockQuotaManager.reserveQuota).toHaveBeenCalledWith('video.details', 10);

      // Verify quota cost calculated
      expect(mockQuotaManager.getOperationCost).toHaveBeenCalledWith({
        type: 'playlist.items',
        itemCount: 50,
      });
      expect(mockQuotaManager.getOperationCost).toHaveBeenCalledWith({
        type: 'video.details',
        itemCount: 3,
      });
    });

    test('should handle playlist not found error', async () => {
      mockPlaylistManager.getPlaylist.mockRejectedValue(new Error('Playlist not found'));

      const result = await engine.syncPlaylist('non-existent');

      expect(result.status).toBe(SyncStatus.FAILED);
      expect(result.error).toBe('Playlist not found');
      expect(result.itemsAdded).toBe(0);
      expect(result.itemsRemoved).toBe(0);
    });

    test('should handle sync lock acquisition failure', async () => {
      mockPlaylistManager.acquireSyncLock.mockRejectedValue(new Error('Lock already acquired'));

      const result = await engine.syncPlaylist('playlist-1');

      expect(result.status).toBe(SyncStatus.FAILED);
      expect(result.error).toBe('Lock already acquired');
    });

    test('should handle YouTube API errors', async () => {
      mockYouTubeClient.getPlaylistItems.mockRejectedValue(new Error('YouTube API error'));

      const result = await engine.syncPlaylist('playlist-1');

      expect(result.status).toBe(SyncStatus.FAILED);
      expect(result.error).toBe('YouTube API error');

      // Verify sync history updated with error
      expect(mockDb.syncHistory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: SyncStatus.FAILED,
            errorMessage: 'YouTube API error',
          }),
        })
      );

      // Verify lock released with failed status
      expect(mockPlaylistManager.releaseSyncLock).toHaveBeenCalledWith('playlist-1', SyncStatus.FAILED);
    });

    test('should handle database transaction errors', async () => {
      (executeTransaction as jest.Mock).mockRejectedValue(new Error('Transaction failed'));

      const result = await engine.syncPlaylist('playlist-1');

      expect(result.status).toBe(SyncStatus.FAILED);
      expect(result.error).toBe('Transaction failed');

      // Verify sync history updated with error
      expect(mockDb.syncHistory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: SyncStatus.FAILED,
          }),
        })
      );
    });

    test('should track sync duration', async () => {
      const result = await engine.syncPlaylist('playlist-1');

      // Duration should be a number (may be 0 in tests due to fast execution)
      expect(typeof result.duration).toBe('number');
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(mockDb.syncHistory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            duration: expect.any(Number),
          }),
        })
      );
    });

    test('should handle empty playlist items from YouTube', async () => {
      mockYouTubeClient.getPlaylistItems.mockResolvedValue([]);

      const result = await engine.syncPlaylist('playlist-1');

      expect(result.status).toBe(SyncStatus.COMPLETED);
      expect(result.itemsAdded).toBe(0);
      expect(result.itemsRemoved).toBe(1); // Existing item removed
    });

    test('should skip items with missing video data', async () => {
      const itemsWithMissingVideo = [
        mockYtItems[0],
        { snippet: { resourceId: { videoId: 'video-missing' }, position: 1 } },
      ];
      mockYouTubeClient.getPlaylistItems.mockResolvedValue(itemsWithMissingVideo);
      mockDb.video.findUnique.mockImplementation((args: any) => {
        if (args.where.youtubeId === 'video1') return Promise.resolve(mockDbVideos[0]);
        return Promise.resolve(null); // Missing video
      });

      const result = await engine.syncPlaylist('playlist-1');

      expect(result.status).toBe(SyncStatus.COMPLETED);
      expect(result.itemsAdded).toBe(0); // Missing video not added
    });
  });

  describe('fetchPlaylistItems', () => {
    test('should fetch playlist items with quota tracking', async () => {
      mockQuotaManager.getOperationCost.mockReturnValue(5);
      mockQuotaManager.reserveQuota.mockResolvedValue(undefined);
      mockYouTubeClient.getPlaylistItems.mockResolvedValue(mockYtItems);

      // Access private method via any type casting
      const result = await (engine as any).fetchPlaylistItems('PLtest123');

      expect(result.items).toEqual(mockYtItems);
      expect(result.quotaCost).toBe(5);
      expect(mockQuotaManager.reserveQuota).toHaveBeenCalledWith('playlist.items', 5);
      expect(mockYouTubeClient.getPlaylistItems).toHaveBeenCalledWith('PLtest123');
    });

    test('should use error recovery mechanism', async () => {
      mockYouTubeClient.getPlaylistItems.mockResolvedValue(mockYtItems);

      await (engine as any).fetchPlaylistItems('PLtest123');

      expect(mockRecoveryManager.executeWithRecovery).toHaveBeenCalled();
    });
  });

  describe('fetchVideos', () => {
    test('should fetch videos with quota tracking', async () => {
      const videoIds = ['video1', 'video2', 'video3'];
      mockQuotaManager.getOperationCost.mockReturnValue(3);
      mockQuotaManager.reserveQuota.mockResolvedValue(undefined);
      mockYouTubeClient.getVideosBatch.mockResolvedValue(mockVideos);

      const result = await (engine as any).fetchVideos(videoIds);

      expect(result.videos).toEqual(mockVideos);
      expect(result.quotaCost).toBe(3);
      expect(mockQuotaManager.getOperationCost).toHaveBeenCalledWith({
        type: 'video.details',
        itemCount: 3,
      });
      expect(mockQuotaManager.reserveQuota).toHaveBeenCalledWith('video.details', 3);
      expect(mockYouTubeClient.getVideosBatch).toHaveBeenCalledWith(videoIds);
    });

    test('should handle empty video IDs array', async () => {
      const result = await (engine as any).fetchVideos([]);

      expect(result.videos).toEqual([]);
      expect(result.quotaCost).toBe(0);
      expect(mockQuotaManager.reserveQuota).not.toHaveBeenCalled();
      expect(mockYouTubeClient.getVideosBatch).not.toHaveBeenCalled();
    });

    test('should use error recovery mechanism', async () => {
      mockYouTubeClient.getVideosBatch.mockResolvedValue(mockVideos);

      await (engine as any).fetchVideos(['video1']);

      expect(mockRecoveryManager.executeWithRecovery).toHaveBeenCalled();
    });
  });

  describe('detectChanges', () => {
    test('should detect added items', async () => {
      const currentItems = [
        {
          id: 'item-1',
          video: { youtubeId: 'video1' },
          position: 0,
        },
      ];

      const ytItems = [
        { snippet: { resourceId: { videoId: 'video1' }, position: 0 } },
        { snippet: { resourceId: { videoId: 'video2' }, position: 1 } },
        { snippet: { resourceId: { videoId: 'video3' }, position: 2 } },
      ];

      const changes = await (engine as any).detectChanges('playlist-1', currentItems, ytItems);

      expect(changes.added).toHaveLength(2);
      expect(changes.added[0].snippet.resourceId.videoId).toBe('video2');
      expect(changes.added[1].snippet.resourceId.videoId).toBe('video3');
      expect(changes.removed).toHaveLength(0);
      expect(changes.reordered).toHaveLength(0);
    });

    test('should detect removed items', async () => {
      const currentItems = [
        { id: 'item-1', video: { youtubeId: 'video1' }, position: 0 },
        { id: 'item-2', video: { youtubeId: 'video2' }, position: 1 },
        { id: 'item-3', video: { youtubeId: 'video3' }, position: 2 },
      ];

      const ytItems = [
        { snippet: { resourceId: { videoId: 'video1' }, position: 0 } },
      ];

      const changes = await (engine as any).detectChanges('playlist-1', currentItems, ytItems);

      expect(changes.added).toHaveLength(0);
      expect(changes.removed).toHaveLength(2);
      expect(changes.removed[0].id).toBe('item-2');
      expect(changes.removed[1].id).toBe('item-3');
      expect(changes.reordered).toHaveLength(0);
    });

    test('should detect reordered items', async () => {
      const currentItems = [
        { id: 'item-1', video: { youtubeId: 'video1' }, position: 0 },
        { id: 'item-2', video: { youtubeId: 'video2' }, position: 1 },
      ];

      const ytItems = [
        { snippet: { resourceId: { videoId: 'video2' }, position: 0 } }, // Moved from 1 to 0
        { snippet: { resourceId: { videoId: 'video1' }, position: 1 } }, // Moved from 0 to 1
      ];

      const changes = await (engine as any).detectChanges('playlist-1', currentItems, ytItems);

      expect(changes.added).toHaveLength(0);
      expect(changes.removed).toHaveLength(0);
      expect(changes.reordered).toHaveLength(2);
      expect(changes.reordered[0].item.id).toBe('item-2');
      expect(changes.reordered[0].newPosition).toBe(0);
      expect(changes.reordered[1].item.id).toBe('item-1');
      expect(changes.reordered[1].newPosition).toBe(1);
    });

    test('should detect mixed changes', async () => {
      const currentItems = [
        { id: 'item-1', video: { youtubeId: 'video1' }, position: 0 },
        { id: 'item-2', video: { youtubeId: 'video2' }, position: 1 },
      ];

      const ytItems = [
        { snippet: { resourceId: { videoId: 'video2' }, position: 0 } }, // Reordered
        { snippet: { resourceId: { videoId: 'video3' }, position: 1 } }, // Added
        // video1 removed
      ];

      const changes = await (engine as any).detectChanges('playlist-1', currentItems, ytItems);

      expect(changes.added).toHaveLength(1);
      expect(changes.added[0].snippet.resourceId.videoId).toBe('video3');
      expect(changes.removed).toHaveLength(1);
      expect(changes.removed[0].video.youtubeId).toBe('video1');
      expect(changes.reordered).toHaveLength(1);
      expect(changes.reordered[0].item.video.youtubeId).toBe('video2');
      expect(changes.reordered[0].newPosition).toBe(0);
    });

    test('should handle empty current items', async () => {
      const currentItems: any[] = [];
      const ytItems = [
        { snippet: { resourceId: { videoId: 'video1' }, position: 0 } },
      ];

      const changes = await (engine as any).detectChanges('playlist-1', currentItems, ytItems);

      expect(changes.added).toHaveLength(1);
      expect(changes.removed).toHaveLength(0);
      expect(changes.reordered).toHaveLength(0);
    });

    test('should handle empty YouTube items', async () => {
      const currentItems = [
        { id: 'item-1', video: { youtubeId: 'video1' }, position: 0 },
      ];
      const ytItems: any[] = [];

      const changes = await (engine as any).detectChanges('playlist-1', currentItems, ytItems);

      expect(changes.added).toHaveLength(0);
      expect(changes.removed).toHaveLength(1);
      expect(changes.reordered).toHaveLength(0);
    });
  });

  describe('syncPlaylists', () => {
    beforeEach(() => {
      mockPlaylistManager.getPlaylist.mockResolvedValue(mockPlaylist);
      mockPlaylistManager.acquireSyncLock.mockResolvedValue(undefined);
      mockPlaylistManager.releaseSyncLock.mockResolvedValue(undefined);
      mockDb.syncHistory.create.mockResolvedValue(mockSyncHistory);
      mockDb.syncHistory.update.mockResolvedValue({ ...mockSyncHistory, status: SyncStatus.COMPLETED });
      mockQuotaManager.getOperationCost.mockReturnValue(10);
      mockQuotaManager.reserveQuota.mockResolvedValue(undefined);
      mockYouTubeClient.getPlaylistItems.mockResolvedValue([]);
      mockYouTubeClient.getVideosBatch.mockResolvedValue([]);
      mockVideoManager.upsertVideos.mockResolvedValue(undefined);
      mockDb.playlistItem.findMany.mockResolvedValue([]);
      mockDb.playlist.update.mockResolvedValue(mockPlaylist);
    });

    test('should sync multiple playlists successfully', async () => {
      const playlistIds = ['playlist-1', 'playlist-2', 'playlist-3'];

      const results = await engine.syncPlaylists(playlistIds);

      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(result.status).toBe(SyncStatus.COMPLETED);
      });
      expect(mockPlaylistManager.getPlaylist).toHaveBeenCalledTimes(3);
    });

    test('should continue syncing even if one playlist fails', async () => {
      const playlistIds = ['playlist-1', 'playlist-2', 'playlist-3'];
      const mockPlaylist3 = { ...mockPlaylist, id: 'playlist-3', youtubeId: 'PLtest456' };

      mockPlaylistManager.getPlaylist
        .mockResolvedValueOnce(mockPlaylist)
        .mockRejectedValueOnce(new Error('Playlist 2 error'))
        .mockResolvedValueOnce(mockPlaylist3);

      const results = await engine.syncPlaylists(playlistIds);

      // All 3 playlists are processed (failed ones return FAILED status)
      expect(results).toHaveLength(3);
      expect(results[0]!.playlistId).toBe('playlist-1');
      expect(results[0]!.status).toBe(SyncStatus.COMPLETED);
      expect(results[1]!.playlistId).toBe('playlist-2');
      expect(results[1]!.status).toBe(SyncStatus.FAILED);
      expect(results[1]!.error).toBe('Playlist 2 error');
      expect(results[2]!.playlistId).toBe('playlist-3');
      expect(results[2]!.status).toBe(SyncStatus.COMPLETED);
    });

    test('should handle empty playlist IDs array', async () => {
      const results = await engine.syncPlaylists([]);

      expect(results).toHaveLength(0);
      expect(mockPlaylistManager.getPlaylist).not.toHaveBeenCalled();
    });
  });

  describe('syncAll', () => {
    beforeEach(() => {
      mockPlaylistManager.getPlaylist.mockResolvedValue(mockPlaylist);
      mockPlaylistManager.acquireSyncLock.mockResolvedValue(undefined);
      mockPlaylistManager.releaseSyncLock.mockResolvedValue(undefined);
      mockDb.syncHistory.create.mockResolvedValue(mockSyncHistory);
      mockDb.syncHistory.update.mockResolvedValue({ ...mockSyncHistory, status: SyncStatus.COMPLETED });
      mockQuotaManager.getOperationCost.mockReturnValue(10);
      mockQuotaManager.reserveQuota.mockResolvedValue(undefined);
      mockYouTubeClient.getPlaylistItems.mockResolvedValue([]);
      mockYouTubeClient.getVideosBatch.mockResolvedValue([]);
      mockVideoManager.upsertVideos.mockResolvedValue(undefined);
      mockDb.playlistItem.findMany.mockResolvedValue([]);
      mockDb.playlist.update.mockResolvedValue(mockPlaylist);
    });

    test('should sync all playlists', async () => {
      const allPlaylists = [
        { id: 'playlist-1', title: 'Playlist 1' },
        { id: 'playlist-2', title: 'Playlist 2' },
        { id: 'playlist-3', title: 'Playlist 3' },
      ];
      mockPlaylistManager.listPlaylists.mockResolvedValue({
        playlists: allPlaylists,
        total: 3,
      });

      const results = await engine.syncAll();

      expect(results).toHaveLength(3);
      expect(mockPlaylistManager.listPlaylists).toHaveBeenCalled();
      expect(mockPlaylistManager.getPlaylist).toHaveBeenCalledTimes(3);
    });

    test('should handle empty playlist list', async () => {
      mockPlaylistManager.listPlaylists.mockResolvedValue({
        playlists: [],
        total: 0,
      });

      const results = await engine.syncAll();

      expect(results).toHaveLength(0);
      expect(mockPlaylistManager.getPlaylist).not.toHaveBeenCalled();
    });
  });

  describe('getSyncEngine', () => {
    test('should return singleton instance', () => {
      const instance1 = getSyncEngine();
      const instance2 = getSyncEngine();

      expect(instance1).toBe(instance2);
    });

    test('should return SyncEngine instance', () => {
      const instance = getSyncEngine();

      expect(instance).toBeInstanceOf(SyncEngine);
    });
  });
});
