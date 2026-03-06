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
    youtube_playlists: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    youtube_playlist_items: {
      findMany: jest.fn(),
    },
    youtube_sync_history: {
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

  const mockUserId = 'user-1';

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup mock db
    mockDb = {
      youtube_playlists: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      youtube_playlist_items: {
        findMany: jest.fn(),
      },
      youtube_sync_history: {
        findMany: jest.fn(),
      },
    };

    // Assign mocks using type assertion
    (db as any).youtube_playlists = mockDb.youtube_playlists;
    (db as any).youtube_playlist_items = mockDb.youtube_playlist_items;
    (db as any).youtube_sync_history = mockDb.youtube_sync_history;

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
      youtube_playlist_id: 'PLxxx',
      user_id: mockUserId,
      title: 'Test Playlist',
      description: 'Test Description',
      channel_title: 'Test Channel',
      thumbnail_url: 'https://example.com/thumb.jpg',
      item_count: 10,
      sync_status: SyncStatus.PENDING,
      created_at: new Date(),
      updated_at: new Date(),
      last_synced_at: null,
    };

    test('should import new playlist from YouTube ID', async () => {
      (db.youtube_playlists.findFirst as jest.Mock).mockResolvedValue(null);
      mockYouTubeClient.getPlaylist.mockResolvedValue(mockYtPlaylist);
      (db.youtube_playlists.create as jest.Mock).mockResolvedValue(mockDbPlaylist);

      const result = await manager.importPlaylist('PLxxx', mockUserId);

      expect(db.youtube_playlists.findFirst).toHaveBeenCalledWith({
        where: { youtube_playlist_id: 'PLxxx', user_id: mockUserId },
      });
      expect(mockQuotaManager.reserveQuota).toHaveBeenCalledWith('playlist.details', 1);
      expect(mockYouTubeClient.getPlaylist).toHaveBeenCalledWith('PLxxx');
      expect(db.youtube_playlists.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          youtube_playlist_id: 'PLxxx',
          user_id: mockUserId,
          title: 'Test Playlist',
          description: 'Test Description',
          channel_title: 'Test Channel',
          thumbnail_url: 'https://example.com/thumb.jpg',
          item_count: 10,
          sync_status: SyncStatus.PENDING,
        }),
      });
      expect(result).toEqual(mockDbPlaylist);
    });

    test('should import playlist from URL', async () => {
      (db.youtube_playlists.findFirst as jest.Mock).mockResolvedValue(null);
      mockYouTubeClient.getPlaylist.mockResolvedValue(mockYtPlaylist);
      (db.youtube_playlists.create as jest.Mock).mockResolvedValue(mockDbPlaylist);

      await manager.importPlaylist('https://www.youtube.com/playlist?list=PLxxx', mockUserId);

      expect(mockYouTubeClient.getPlaylist).toHaveBeenCalledWith('PLxxx');
    });

    test('should return existing playlist if already imported', async () => {
      (db.youtube_playlists.findFirst as jest.Mock).mockResolvedValue(mockDbPlaylist);

      const result = await manager.importPlaylist('PLxxx', mockUserId);

      expect(result).toEqual(mockDbPlaylist);
      expect(mockYouTubeClient.getPlaylist).not.toHaveBeenCalled();
      expect(db.youtube_playlists.create).not.toHaveBeenCalled();
    });

    test('should throw error for invalid playlist URL', async () => {
      await expect(
        manager.importPlaylist('https://example.com/invalid', mockUserId)
      ).rejects.toThrow(InvalidPlaylistError);
    });

    test('should throw error if snippet is missing', async () => {
      (db.youtube_playlists.findFirst as jest.Mock).mockResolvedValue(null);
      mockYouTubeClient.getPlaylist.mockResolvedValue({});

      await expect(manager.importPlaylist('PLxxx', mockUserId)).rejects.toThrow(
        InvalidPlaylistError
      );
    });

    test('should handle missing optional fields', async () => {
      const minimalPlaylist = {
        snippet: {},
        contentDetails: {},
      };
      (db.youtube_playlists.findFirst as jest.Mock).mockResolvedValue(null);
      mockYouTubeClient.getPlaylist.mockResolvedValue(minimalPlaylist);
      (db.youtube_playlists.create as jest.Mock).mockResolvedValue(mockDbPlaylist);

      await manager.importPlaylist('PLxxx', mockUserId);

      expect(db.youtube_playlists.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: 'Untitled Playlist',
          description: null,
          thumbnail_url: null,
          item_count: 0,
        }),
      });
    });
  });

  describe('getPlaylist', () => {
    const mockPlaylist = {
      id: 'playlist-1',
      youtube_playlist_id: 'PLxxx',
      title: 'Test Playlist',
      sync_status: SyncStatus.PENDING,
    };

    test('should get playlist by database ID', async () => {
      (db.youtube_playlists.findFirst as jest.Mock).mockResolvedValue(mockPlaylist);

      const result = await manager.getPlaylist('playlist-1');

      expect(db.youtube_playlists.findFirst).toHaveBeenCalledWith({
        where: {
          OR: [{ id: 'playlist-1' }, { youtube_playlist_id: 'playlist-1' }],
        },
      });
      expect(result).toEqual(mockPlaylist);
    });

    test('should get playlist by YouTube ID', async () => {
      (db.youtube_playlists.findFirst as jest.Mock).mockResolvedValue(mockPlaylist);

      const result = await manager.getPlaylist('PLxxx');

      expect(result).toEqual(mockPlaylist);
    });

    test('should throw error if playlist not found', async () => {
      (db.youtube_playlists.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(manager.getPlaylist('non-existent')).rejects.toThrow(RecordNotFoundError);
    });
  });

  describe('listPlaylists', () => {
    const mockPlaylists = [
      { id: '1', title: 'Playlist 1', created_at: new Date() },
      { id: '2', title: 'Playlist 2', created_at: new Date() },
    ];

    test('should list all playlists with default options', async () => {
      (db.youtube_playlists.findMany as jest.Mock).mockResolvedValue(mockPlaylists);
      (db.youtube_playlists.count as jest.Mock).mockResolvedValue(2);

      const result = await manager.listPlaylists();

      expect(db.youtube_playlists.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { created_at: 'desc' },
        take: undefined,
        skip: undefined,
      });
      expect(result).toEqual({
        playlists: mockPlaylists,
        total: 2,
      });
    });

    test('should filter playlists by title', async () => {
      (db.youtube_playlists.findMany as jest.Mock).mockResolvedValue([mockPlaylists[0]]);
      (db.youtube_playlists.count as jest.Mock).mockResolvedValue(1);

      await manager.listPlaylists({ filter: 'Playlist 1' });

      expect(db.youtube_playlists.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { title: { contains: 'Playlist 1' } },
              { channel_title: { contains: 'Playlist 1' } },
            ],
          },
        })
      );
    });

    test('should sort playlists by title', async () => {
      (db.youtube_playlists.findMany as jest.Mock).mockResolvedValue(mockPlaylists);
      (db.youtube_playlists.count as jest.Mock).mockResolvedValue(2);

      await manager.listPlaylists({ sortBy: 'title', sortOrder: 'asc' });

      expect(db.youtube_playlists.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { title: 'asc' },
        })
      );
    });

    test('should paginate results', async () => {
      (db.youtube_playlists.findMany as jest.Mock).mockResolvedValue([mockPlaylists[0]]);
      (db.youtube_playlists.count as jest.Mock).mockResolvedValue(2);

      await manager.listPlaylists({ limit: 1, offset: 1 });

      expect(db.youtube_playlists.findMany).toHaveBeenCalledWith(
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
      youtube_playlist_id: 'PLxxx',
      title: 'Old Title',
      description: null,
      channel_title: '',
      thumbnail_url: null,
      item_count: 0,
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
      (db.youtube_playlists.findFirst as jest.Mock).mockResolvedValue(mockPlaylist);
      mockYouTubeClient.getPlaylist.mockResolvedValue(mockYtPlaylist);
      (db.youtube_playlists.update as jest.Mock).mockResolvedValue({
        ...mockPlaylist,
        title: 'Updated Title',
      });

      await manager.updatePlaylistMetadata('playlist-1');

      expect(mockQuotaManager.reserveQuota).toHaveBeenCalledWith('playlist.details', 1);
      expect(mockYouTubeClient.getPlaylist).toHaveBeenCalledWith('PLxxx');
      expect(db.youtube_playlists.update).toHaveBeenCalledWith({
        where: { id: 'playlist-1' },
        data: expect.objectContaining({
          title: 'Updated Title',
          description: 'Updated Description',
          channel_title: 'Updated Channel',
          item_count: 15,
        }),
      });
    });

    test('should preserve old values if new data is missing', async () => {
      (db.youtube_playlists.findFirst as jest.Mock).mockResolvedValue(mockPlaylist);
      mockYouTubeClient.getPlaylist.mockResolvedValue({
        snippet: {},
        contentDetails: {},
      });
      (db.youtube_playlists.update as jest.Mock).mockResolvedValue(mockPlaylist);

      await manager.updatePlaylistMetadata('playlist-1');

      expect(db.youtube_playlists.update).toHaveBeenCalledWith({
        where: { id: 'playlist-1' },
        data: expect.objectContaining({
          title: 'Old Title',
        }),
      });
    });
  });

  describe('deletePlaylist', () => {
    test('should delete playlist', async () => {
      (db.youtube_playlists.findFirst as jest.Mock).mockResolvedValue({ id: 'playlist-1' });
      (db.youtube_playlists.delete as jest.Mock).mockResolvedValue({ id: 'playlist-1' });

      await manager.deletePlaylist('playlist-1');

      expect(db.youtube_playlists.delete).toHaveBeenCalledWith({
        where: { id: 'playlist-1' },
      });
    });

    test('should throw error if playlist not found', async () => {
      (db.youtube_playlists.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(manager.deletePlaylist('non-existent')).rejects.toThrow(RecordNotFoundError);
    });
  });

  describe('getPlaylistWithItems', () => {
    const mockPlaylistWithItems = {
      id: 'playlist-1',
      youtube_playlist_id: 'PLxxx',
      title: 'Test Playlist',
      youtube_playlist_items: [
        {
          id: 'item-1',
          position: 0,
          youtube_videos: { id: 'video-1', title: 'Video 1' },
        },
        {
          id: 'item-2',
          position: 1,
          youtube_videos: { id: 'video-2', title: 'Video 2' },
        },
      ],
    };

    test('should get playlist with items', async () => {
      (db.youtube_playlists.findFirst as jest.Mock).mockResolvedValue({ id: 'playlist-1' });
      (db.youtube_playlists.findUnique as jest.Mock).mockResolvedValue(mockPlaylistWithItems);

      const result = await manager.getPlaylistWithItems('playlist-1');

      expect(db.youtube_playlists.findUnique).toHaveBeenCalledWith({
        where: { id: 'playlist-1' },
        include: {
          youtube_playlist_items: {
            where: { removed_at: null },
            include: { youtube_videos: true },
            orderBy: { position: 'asc' },
          },
        },
      });
      expect(result).toEqual(mockPlaylistWithItems);
    });
  });

  describe('Sync Lock Management', () => {
    test('should set sync status', async () => {
      (db.youtube_playlists.update as jest.Mock).mockResolvedValue({ id: 'playlist-1' });

      await manager.setSyncStatus('playlist-1', SyncStatus.IN_PROGRESS);

      expect(db.youtube_playlists.update).toHaveBeenCalledWith({
        where: { id: 'playlist-1' },
        data: { sync_status: SyncStatus.IN_PROGRESS },
      });
    });

    test('should check if playlist is syncing', async () => {
      (db.youtube_playlists.findFirst as jest.Mock).mockResolvedValue({
        id: 'playlist-1',
        sync_status: SyncStatus.IN_PROGRESS,
      });

      const result = await manager.isSyncing('playlist-1');

      expect(result).toBe(true);
    });

    test('should acquire sync lock', async () => {
      (db.youtube_playlists.findFirst as jest.Mock).mockResolvedValue({
        id: 'playlist-1',
        sync_status: SyncStatus.PENDING,
      });
      (db.youtube_playlists.update as jest.Mock).mockResolvedValue({ id: 'playlist-1' });

      await manager.acquireSyncLock('playlist-1');

      expect(db.youtube_playlists.update).toHaveBeenCalledWith({
        where: { id: 'playlist-1' },
        data: { sync_status: SyncStatus.IN_PROGRESS },
      });
    });

    test('should throw error if already syncing', async () => {
      (db.youtube_playlists.findFirst as jest.Mock).mockResolvedValue({
        id: 'playlist-1',
        sync_status: SyncStatus.IN_PROGRESS,
      });

      await expect(manager.acquireSyncLock('playlist-1')).rejects.toThrow(ConcurrentSyncError);
    });

    test('should release sync lock with completed status', async () => {
      (db.youtube_playlists.update as jest.Mock).mockResolvedValue({ id: 'playlist-1' });

      await manager.releaseSyncLock('playlist-1', SyncStatus.COMPLETED);

      expect(db.youtube_playlists.update).toHaveBeenCalledWith({
        where: { id: 'playlist-1' },
        data: {
          sync_status: SyncStatus.COMPLETED,
          last_synced_at: expect.any(Date),
        },
      });
    });

    test('should release sync lock with failed status', async () => {
      (db.youtube_playlists.update as jest.Mock).mockResolvedValue({ id: 'playlist-1' });

      await manager.releaseSyncLock('playlist-1', SyncStatus.FAILED);

      expect(db.youtube_playlists.update).toHaveBeenCalledWith({
        where: { id: 'playlist-1' },
        data: {
          sync_status: SyncStatus.FAILED,
          last_synced_at: undefined,
        },
      });
    });
  });

  describe('extractPlaylistId', () => {
    test('should extract ID from playlist ID string', async () => {
      // Test through importPlaylist which uses extractPlaylistId internally
      (db.youtube_playlists.findFirst as jest.Mock).mockResolvedValue(null);
      mockYouTubeClient.getPlaylist.mockResolvedValue({
        snippet: { title: 'Test' },
      });
      (db.youtube_playlists.create as jest.Mock).mockResolvedValue({ id: '1' });

      await manager.importPlaylist('PLxxx123', mockUserId);

      expect(mockYouTubeClient.getPlaylist).toHaveBeenCalledWith('PLxxx123');
    });

    test('should extract ID from standard playlist URL', async () => {
      (db.youtube_playlists.findFirst as jest.Mock).mockResolvedValue(null);
      mockYouTubeClient.getPlaylist.mockResolvedValue({
        snippet: { title: 'Test' },
      });
      (db.youtube_playlists.create as jest.Mock).mockResolvedValue({ id: '1' });

      await manager.importPlaylist('https://www.youtube.com/playlist?list=PLxxx123', mockUserId);

      expect(mockYouTubeClient.getPlaylist).toHaveBeenCalledWith('PLxxx123');
    });

    test('should extract ID from watch URL with list parameter', async () => {
      (db.youtube_playlists.findFirst as jest.Mock).mockResolvedValue(null);
      mockYouTubeClient.getPlaylist.mockResolvedValue({
        snippet: { title: 'Test' },
      });
      (db.youtube_playlists.create as jest.Mock).mockResolvedValue({ id: '1' });

      await manager.importPlaylist('https://www.youtube.com/watch?v=xxx&list=PLxxx123', mockUserId);

      expect(mockYouTubeClient.getPlaylist).toHaveBeenCalledWith('PLxxx123');
    });
  });

  describe('getSyncStats', () => {
    const mockSyncHistory = [
      {
        id: '3',
        status: SyncStatus.FAILED,
        started_at: new Date('2024-01-03'),
        completed_at: null,
      },
      {
        id: '2',
        status: SyncStatus.COMPLETED,
        started_at: new Date('2024-01-02'),
        completed_at: new Date('2024-01-02T00:00:02Z'),
      },
      {
        id: '1',
        status: SyncStatus.COMPLETED,
        started_at: new Date('2024-01-01'),
        completed_at: new Date('2024-01-01T00:00:01Z'),
      },
    ];

    test('should calculate sync statistics', async () => {
      (db.youtube_playlists.findFirst as jest.Mock).mockResolvedValue({ id: 'playlist-1' });
      (db.youtube_sync_history.findMany as jest.Mock).mockResolvedValue(mockSyncHistory);

      const stats = await manager.getSyncStats('playlist-1');

      expect(stats).toMatchObject({
        totalSyncs: 3,
        successfulSyncs: 2,
        failedSyncs: 1,
        lastSync: new Date('2024-01-03'),
      });
      expect(stats.averageDuration).toBeGreaterThan(0);
    });

    test('should handle empty sync history', async () => {
      (db.youtube_playlists.findFirst as jest.Mock).mockResolvedValue({ id: 'playlist-1' });
      (db.youtube_sync_history.findMany as jest.Mock).mockResolvedValue([]);

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
