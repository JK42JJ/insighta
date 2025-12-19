/**
 * PlaylistManager Unit Tests
 *
 * Tests for PlaylistManager implementation including:
 * - Import operations
 * - CRUD operations
 * - Sync lock management
 * - Metadata updates
 * - Statistics tracking
 */

import { PlaylistManager } from '../../../src/modules/playlist/manager';
import { SyncStatus } from '../../../src/types/enums';
import {
  InvalidPlaylistError,
  RecordNotFoundError,
  ConcurrentSyncError,
} from '../../../src/utils/errors';

import { db } from '../../../src/modules/database/client';
import { getYouTubeClient } from '../../../src/api/client';
import { getQuotaManager } from '../../../src/modules/quota/manager';

// Mock dependencies
jest.mock('../../../src/modules/database/client', () => ({
  db: {
    playlist: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    playlistItem: {
      findMany: jest.fn(),
    },
    syncHistory: {
      findMany: jest.fn(),
    },
  },
  getPrismaClient: jest.fn(),
}));
jest.mock('../../../src/api/client');
jest.mock('../../../src/modules/quota/manager');
jest.mock('../../../src/utils/logger');

describe('PlaylistManager', () => {
  let manager: PlaylistManager;
  let mockYouTubeClient: any;
  let mockQuotaManager: any;
  let mockDb: any;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup mock db
    mockDb = {
      playlist: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      playlistItem: {
        findMany: jest.fn(),
      },
      syncHistory: {
        findMany: jest.fn(),
      },
    };

    // Assign mocks using type assertion
    (db as any).playlist = mockDb.playlist;
    (db as any).playlistItem = mockDb.playlistItem;
    (db as any).syncHistory = mockDb.syncHistory;

    // Setup mock YouTube client
    mockYouTubeClient = {
      getPlaylist: jest.fn(),
    };
    (getYouTubeClient as jest.Mock).mockReturnValue(mockYouTubeClient);

    // Setup mock quota manager
    mockQuotaManager = {
      reserveQuota: jest.fn().mockResolvedValue(undefined),
      getOperationCost: jest.fn().mockReturnValue(1),
    };
    (getQuotaManager as jest.Mock).mockReturnValue(mockQuotaManager);

    manager = new PlaylistManager();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('importPlaylist', () => {
    const mockYtPlaylist = {
      snippet: {
        title: 'Test Playlist',
        description: 'Test Description',
        channelId: 'UCxxx',
        channelTitle: 'Test Channel',
        thumbnails: {
          default: { url: 'https://example.com/thumb.jpg' },
        },
      },
      contentDetails: {
        itemCount: 10,
      },
    };

    const mockDbPlaylist = {
      id: 'playlist-1',
      youtubeId: 'PLxxx',
      title: 'Test Playlist',
      description: 'Test Description',
      channelId: 'UCxxx',
      channelTitle: 'Test Channel',
      thumbnailUrl: 'https://example.com/thumb.jpg',
      itemCount: 10,
      syncStatus: SyncStatus.PENDING,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSyncedAt: null,
    };

    test('should import new playlist from YouTube ID', async () => {
      (db.playlist.findUnique as jest.Mock).mockResolvedValue(null);
      mockYouTubeClient.getPlaylist.mockResolvedValue(mockYtPlaylist);
      (db.playlist.create as jest.Mock).mockResolvedValue(mockDbPlaylist);

      const result = await manager.importPlaylist('PLxxx');

      expect(db.playlist.findUnique).toHaveBeenCalledWith({
        where: { youtubeId: 'PLxxx' },
      });
      expect(mockQuotaManager.reserveQuota).toHaveBeenCalledWith('playlist.details', 1);
      expect(mockYouTubeClient.getPlaylist).toHaveBeenCalledWith('PLxxx');
      expect(db.playlist.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          youtubeId: 'PLxxx',
          title: 'Test Playlist',
          description: 'Test Description',
          channelId: 'UCxxx',
          channelTitle: 'Test Channel',
          thumbnailUrl: 'https://example.com/thumb.jpg',
          itemCount: 10,
          syncStatus: SyncStatus.PENDING,
        }),
      });
      expect(result).toEqual(mockDbPlaylist);
    });

    test('should import playlist from URL', async () => {
      (db.playlist.findUnique as jest.Mock).mockResolvedValue(null);
      mockYouTubeClient.getPlaylist.mockResolvedValue(mockYtPlaylist);
      (db.playlist.create as jest.Mock).mockResolvedValue(mockDbPlaylist);

      await manager.importPlaylist('https://www.youtube.com/playlist?list=PLxxx');

      expect(mockYouTubeClient.getPlaylist).toHaveBeenCalledWith('PLxxx');
    });

    test('should return existing playlist if already imported', async () => {
      (db.playlist.findUnique as jest.Mock).mockResolvedValue(mockDbPlaylist);

      const result = await manager.importPlaylist('PLxxx');

      expect(result).toEqual(mockDbPlaylist);
      expect(mockYouTubeClient.getPlaylist).not.toHaveBeenCalled();
      expect(db.playlist.create).not.toHaveBeenCalled();
    });

    test('should throw error for invalid playlist URL', async () => {
      await expect(manager.importPlaylist('https://example.com/invalid')).rejects.toThrow(
        InvalidPlaylistError
      );
    });

    test('should throw error if snippet is missing', async () => {
      (db.playlist.findUnique as jest.Mock).mockResolvedValue(null);
      mockYouTubeClient.getPlaylist.mockResolvedValue({});

      await expect(manager.importPlaylist('PLxxx')).rejects.toThrow(
        InvalidPlaylistError
      );
    });

    test('should handle missing optional fields', async () => {
      const minimalPlaylist = {
        snippet: {},
        contentDetails: {},
      };
      (db.playlist.findUnique as jest.Mock).mockResolvedValue(null);
      mockYouTubeClient.getPlaylist.mockResolvedValue(minimalPlaylist);
      (db.playlist.create as jest.Mock).mockResolvedValue(mockDbPlaylist);

      await manager.importPlaylist('PLxxx');

      expect(db.playlist.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: 'Untitled Playlist',
          description: null,
          thumbnailUrl: null,
          itemCount: 0,
        }),
      });
    });
  });

  describe('getPlaylist', () => {
    const mockPlaylist = {
      id: 'playlist-1',
      youtubeId: 'PLxxx',
      title: 'Test Playlist',
      syncStatus: SyncStatus.PENDING,
    };

    test('should get playlist by database ID', async () => {
      (db.playlist.findFirst as jest.Mock).mockResolvedValue(mockPlaylist);

      const result = await manager.getPlaylist('playlist-1');

      expect(db.playlist.findFirst).toHaveBeenCalledWith({
        where: {
          OR: [{ id: 'playlist-1' }, { youtubeId: 'playlist-1' }],
        },
      });
      expect(result).toEqual(mockPlaylist);
    });

    test('should get playlist by YouTube ID', async () => {
      (db.playlist.findFirst as jest.Mock).mockResolvedValue(mockPlaylist);

      const result = await manager.getPlaylist('PLxxx');

      expect(result).toEqual(mockPlaylist);
    });

    test('should throw error if playlist not found', async () => {
      (db.playlist.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(manager.getPlaylist('non-existent')).rejects.toThrow(
        RecordNotFoundError
      );
    });
  });

  describe('listPlaylists', () => {
    const mockPlaylists = [
      { id: '1', title: 'Playlist 1', createdAt: new Date() },
      { id: '2', title: 'Playlist 2', createdAt: new Date() },
    ];

    test('should list all playlists with default options', async () => {
      (db.playlist.findMany as jest.Mock).mockResolvedValue(mockPlaylists);
      (db.playlist.count as jest.Mock).mockResolvedValue(2);

      const result = await manager.listPlaylists();

      expect(db.playlist.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: 'desc' },
        take: undefined,
        skip: undefined,
      });
      expect(result).toEqual({
        playlists: mockPlaylists,
        total: 2,
      });
    });

    test('should filter playlists by title', async () => {
      (db.playlist.findMany as jest.Mock).mockResolvedValue([mockPlaylists[0]]);
      (db.playlist.count as jest.Mock).mockResolvedValue(1);

      await manager.listPlaylists({ filter: 'Playlist 1' });

      // Note: SQLite doesn't support mode: 'insensitive', but it's case-insensitive by default
      expect(db.playlist.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { title: { contains: 'Playlist 1' } },
              { channelTitle: { contains: 'Playlist 1' } },
            ],
          },
        })
      );
    });

    test('should sort playlists by title', async () => {
      (db.playlist.findMany as jest.Mock).mockResolvedValue(mockPlaylists);
      (db.playlist.count as jest.Mock).mockResolvedValue(2);

      await manager.listPlaylists({ sortBy: 'title', sortOrder: 'asc' });

      expect(db.playlist.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { title: 'asc' },
        })
      );
    });

    test('should paginate results', async () => {
      (db.playlist.findMany as jest.Mock).mockResolvedValue([mockPlaylists[0]]);
      (db.playlist.count as jest.Mock).mockResolvedValue(2);

      await manager.listPlaylists({ limit: 1, offset: 1 });

      expect(db.playlist.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 1,
          skip: 1,
        })
      );
    });
  });

  describe('updatePlaylistMetadata', () => {
    const mockPlaylist = {
      id: 'playlist-1',
      youtubeId: 'PLxxx',
      title: 'Old Title',
    };

    const mockYtPlaylist = {
      snippet: {
        title: 'Updated Title',
        description: 'Updated Description',
        channelTitle: 'Updated Channel',
        thumbnails: {
          default: { url: 'https://example.com/new-thumb.jpg' },
        },
      },
      contentDetails: {
        itemCount: 15,
      },
    };

    test('should update playlist metadata from YouTube', async () => {
      (db.playlist.findFirst as jest.Mock).mockResolvedValue(mockPlaylist);
      mockYouTubeClient.getPlaylist.mockResolvedValue(mockYtPlaylist);
      (db.playlist.update as jest.Mock).mockResolvedValue({
        ...mockPlaylist,
        title: 'Updated Title',
      });

      await manager.updatePlaylistMetadata('playlist-1');

      expect(mockQuotaManager.reserveQuota).toHaveBeenCalledWith('playlist.details', 1);
      expect(mockYouTubeClient.getPlaylist).toHaveBeenCalledWith('PLxxx');
      expect(db.playlist.update).toHaveBeenCalledWith({
        where: { id: 'playlist-1' },
        data: expect.objectContaining({
          title: 'Updated Title',
          description: 'Updated Description',
          channelTitle: 'Updated Channel',
          itemCount: 15,
        }),
      });
    });

    test('should preserve old values if new data is missing', async () => {
      (db.playlist.findFirst as jest.Mock).mockResolvedValue(mockPlaylist);
      mockYouTubeClient.getPlaylist.mockResolvedValue({
        snippet: {},
        contentDetails: {},
      });
      (db.playlist.update as jest.Mock).mockResolvedValue(mockPlaylist);

      await manager.updatePlaylistMetadata('playlist-1');

      expect(db.playlist.update).toHaveBeenCalledWith({
        where: { id: 'playlist-1' },
        data: expect.objectContaining({
          title: 'Old Title',
        }),
      });
    });
  });

  describe('deletePlaylist', () => {
    test('should delete playlist', async () => {
      (db.playlist.findFirst as jest.Mock).mockResolvedValue({ id: 'playlist-1' });
      (db.playlist.delete as jest.Mock).mockResolvedValue({ id: 'playlist-1' });

      await manager.deletePlaylist('playlist-1');

      expect(db.playlist.delete).toHaveBeenCalledWith({
        where: { id: 'playlist-1' },
      });
    });

    test('should throw error if playlist not found', async () => {
      (db.playlist.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(manager.deletePlaylist('non-existent')).rejects.toThrow(
        RecordNotFoundError
      );
    });
  });

  describe('getPlaylistWithItems', () => {
    const mockPlaylistWithItems = {
      id: 'playlist-1',
      youtubeId: 'PLxxx',
      title: 'Test Playlist',
      items: [
        {
          id: 'item-1',
          position: 0,
          video: { id: 'video-1', title: 'Video 1' },
        },
        {
          id: 'item-2',
          position: 1,
          video: { id: 'video-2', title: 'Video 2' },
        },
      ],
    };

    test('should get playlist with items', async () => {
      (db.playlist.findFirst as jest.Mock).mockResolvedValue({ id: 'playlist-1' });
      (db.playlist.findUnique as jest.Mock).mockResolvedValue(mockPlaylistWithItems);

      const result = await manager.getPlaylistWithItems('playlist-1');

      expect(db.playlist.findUnique).toHaveBeenCalledWith({
        where: { id: 'playlist-1' },
        include: {
          items: {
            where: { removedAt: null },
            include: { video: true },
            orderBy: { position: 'asc' },
          },
        },
      });
      expect(result).toEqual(mockPlaylistWithItems);
    });
  });

  describe('Sync Lock Management', () => {
    test('should set sync status', async () => {
      (db.playlist.update as jest.Mock).mockResolvedValue({ id: 'playlist-1' });

      await manager.setSyncStatus('playlist-1', SyncStatus.IN_PROGRESS);

      expect(db.playlist.update).toHaveBeenCalledWith({
        where: { id: 'playlist-1' },
        data: { syncStatus: SyncStatus.IN_PROGRESS },
      });
    });

    test('should check if playlist is syncing', async () => {
      (db.playlist.findFirst as jest.Mock).mockResolvedValue({
        id: 'playlist-1',
        syncStatus: SyncStatus.IN_PROGRESS,
      });

      const result = await manager.isSyncing('playlist-1');

      expect(result).toBe(true);
    });

    test('should acquire sync lock', async () => {
      (db.playlist.findFirst as jest.Mock).mockResolvedValue({
        id: 'playlist-1',
        syncStatus: SyncStatus.PENDING,
      });
      (db.playlist.update as jest.Mock).mockResolvedValue({ id: 'playlist-1' });

      await manager.acquireSyncLock('playlist-1');

      expect(db.playlist.update).toHaveBeenCalledWith({
        where: { id: 'playlist-1' },
        data: { syncStatus: SyncStatus.IN_PROGRESS },
      });
    });

    test('should throw error if already syncing', async () => {
      (db.playlist.findFirst as jest.Mock).mockResolvedValue({
        id: 'playlist-1',
        syncStatus: SyncStatus.IN_PROGRESS,
      });

      await expect(manager.acquireSyncLock('playlist-1')).rejects.toThrow(
        ConcurrentSyncError
      );
    });

    test('should release sync lock with completed status', async () => {
      (db.playlist.update as jest.Mock).mockResolvedValue({ id: 'playlist-1' });

      await manager.releaseSyncLock('playlist-1', SyncStatus.COMPLETED);

      expect(db.playlist.update).toHaveBeenCalledWith({
        where: { id: 'playlist-1' },
        data: {
          syncStatus: SyncStatus.COMPLETED,
          lastSyncedAt: expect.any(Date),
        },
      });
    });

    test('should release sync lock with failed status', async () => {
      (db.playlist.update as jest.Mock).mockResolvedValue({ id: 'playlist-1' });

      await manager.releaseSyncLock('playlist-1', SyncStatus.FAILED);

      expect(db.playlist.update).toHaveBeenCalledWith({
        where: { id: 'playlist-1' },
        data: {
          syncStatus: SyncStatus.FAILED,
          lastSyncedAt: undefined,
        },
      });
    });
  });

  describe('extractPlaylistId', () => {
    test('should extract ID from playlist ID string', async () => {
      // Test through importPlaylist which uses extractPlaylistId internally
      (db.playlist.findUnique as jest.Mock).mockResolvedValue(null);
      mockYouTubeClient.getPlaylist.mockResolvedValue({
        snippet: { title: 'Test' },
      });
      (db.playlist.create as jest.Mock).mockResolvedValue({ id: '1' });

      await manager.importPlaylist('PLxxx123');

      expect(mockYouTubeClient.getPlaylist).toHaveBeenCalledWith('PLxxx123');
    });

    test('should extract ID from standard playlist URL', async () => {
      (db.playlist.findUnique as jest.Mock).mockResolvedValue(null);
      mockYouTubeClient.getPlaylist.mockResolvedValue({
        snippet: { title: 'Test' },
      });
      (db.playlist.create as jest.Mock).mockResolvedValue({ id: '1' });

      await manager.importPlaylist('https://www.youtube.com/playlist?list=PLxxx123');

      expect(mockYouTubeClient.getPlaylist).toHaveBeenCalledWith('PLxxx123');
    });

    test('should extract ID from watch URL with list parameter', async () => {
      (db.playlist.findUnique as jest.Mock).mockResolvedValue(null);
      mockYouTubeClient.getPlaylist.mockResolvedValue({
        snippet: { title: 'Test' },
      });
      (db.playlist.create as jest.Mock).mockResolvedValue({ id: '1' });

      await manager.importPlaylist(
        'https://www.youtube.com/watch?v=xxx&list=PLxxx123'
      );

      expect(mockYouTubeClient.getPlaylist).toHaveBeenCalledWith('PLxxx123');
    });
  });

  describe('getSyncStats', () => {
    const mockSyncHistory = [
      {
        id: '3',
        status: SyncStatus.FAILED,
        startedAt: new Date('2024-01-03'),
        duration: null,
      },
      {
        id: '2',
        status: SyncStatus.COMPLETED,
        startedAt: new Date('2024-01-02'),
        duration: 2000,
      },
      {
        id: '1',
        status: SyncStatus.COMPLETED,
        startedAt: new Date('2024-01-01'),
        duration: 1000,
      },
    ];

    test('should calculate sync statistics', async () => {
      (db.playlist.findFirst as jest.Mock).mockResolvedValue({ id: 'playlist-1' });
      (db.syncHistory.findMany as jest.Mock).mockResolvedValue(mockSyncHistory);

      const stats = await manager.getSyncStats('playlist-1');

      expect(stats).toEqual({
        totalSyncs: 3,
        successfulSyncs: 2,
        failedSyncs: 1,
        lastSync: new Date('2024-01-03'),
        averageDuration: 1500,
      });
    });

    test('should handle empty sync history', async () => {
      (db.playlist.findFirst as jest.Mock).mockResolvedValue({ id: 'playlist-1' });
      (db.syncHistory.findMany as jest.Mock).mockResolvedValue([]);

      const stats = await manager.getSyncStats('playlist-1');

      expect(stats).toEqual({
        totalSyncs: 0,
        successfulSyncs: 0,
        failedSyncs: 0,
        lastSync: null,
        averageDuration: null,
      });
    });
  });
});
