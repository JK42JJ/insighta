/**
 * VideoManager Unit Tests
 *
 * Tests for VideoManager implementation including:
 * - Video upsert operations
 * - Batch operations
 * - User state management
 * - Watch status tracking
 * - Duplicate detection
 * - Duration parsing
 */

import { VideoManager } from '../../../src/modules/video/manager';
import { WatchStatus } from '../../../src/types/enums';
import { RecordNotFoundError } from '../../../src/utils/errors';

import { db } from '../../../src/modules/database/client';
import { getYouTubeClient } from '../../../src/api/client';
import { getQuotaManager } from '../../../src/modules/quota/manager';

// Mock dependencies
jest.mock('../../../src/modules/database/client', () => ({
  db: {
    video: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    userVideoState: {
      upsert: jest.fn(),
    },
    $queryRaw: jest.fn(),
  },
  getPrismaClient: jest.fn(),
}));
jest.mock('../../../src/api/client');
jest.mock('../../../src/modules/quota/manager');
jest.mock('../../../src/utils/logger');

describe('VideoManager', () => {
  let manager: VideoManager;
  let mockYouTubeClient: any;
  let mockQuotaManager: any;
  let mockDb: any;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup mock db
    mockDb = {
      video: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
      userVideoState: {
        upsert: jest.fn(),
      },
      $queryRaw: jest.fn(),
    };

    // Assign mocks using type assertion
    (db as any).video = mockDb.video;
    (db as any).userVideoState = mockDb.userVideoState;
    (db as any).$queryRaw = mockDb.$queryRaw;

    // Setup mock YouTube client
    mockYouTubeClient = {
      getVideos: jest.fn(),
      getVideosBatch: jest.fn(),
    };
    (getYouTubeClient as jest.Mock).mockReturnValue(mockYouTubeClient);

    // Setup mock quota manager
    mockQuotaManager = {
      reserveQuota: jest.fn().mockResolvedValue(undefined),
      getOperationCost: jest.fn().mockReturnValue(1),
    };
    (getQuotaManager as jest.Mock).mockReturnValue(mockQuotaManager);

    manager = new VideoManager();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('upsertVideo', () => {
    const mockYtVideo = {
      id: 'video123',
      snippet: {
        title: 'Test Video',
        description: 'Test Description',
        channelId: 'UCxxx',
        channelTitle: 'Test Channel',
        publishedAt: '2024-01-01T00:00:00Z',
        thumbnails: {
          default: { url: 'https://example.com/thumb.jpg' },
        },
        tags: ['tag1', 'tag2'],
        categoryId: '22',
        defaultLanguage: 'en',
      },
      contentDetails: {
        duration: 'PT10M30S',
      },
      statistics: {
        viewCount: '1000',
        likeCount: '100',
        commentCount: '10',
      },
    };

    const mockDbVideo = {
      id: 'db-video-1',
      youtubeId: 'video123',
      title: 'Test Video',
      description: 'Test Description',
      channelId: 'UCxxx',
      channelTitle: 'Test Channel',
      publishedAt: new Date('2024-01-01T00:00:00Z'),
      duration: 630,
      thumbnailUrls: JSON.stringify(mockYtVideo.snippet.thumbnails),
      viewCount: 1000,
      likeCount: 100,
      commentCount: 10,
      tags: JSON.stringify(['tag1', 'tag2']),
      categoryId: '22',
      language: 'en',
    };

    test('should upsert video with complete data', async () => {
      (db.video.upsert as jest.Mock).mockResolvedValue(mockDbVideo);

      const result = await manager.upsertVideo(mockYtVideo);

      expect(db.video.upsert).toHaveBeenCalledWith({
        where: { youtubeId: 'video123' },
        create: expect.objectContaining({
          youtubeId: 'video123',
          title: 'Test Video',
          description: 'Test Description',
          channelId: 'UCxxx',
          channelTitle: 'Test Channel',
          duration: 630,
          viewCount: 1000,
          likeCount: 100,
          commentCount: 10,
        }),
        update: expect.objectContaining({
          title: 'Test Video',
        }),
      });
      expect(result).toEqual(mockDbVideo);
    });

    test('should handle missing optional fields', async () => {
      const minimalVideo = {
        id: 'video123',
        snippet: {},
        contentDetails: {},
      };
      (db.video.upsert as jest.Mock).mockResolvedValue(mockDbVideo);

      await manager.upsertVideo(minimalVideo);

      expect(db.video.upsert).toHaveBeenCalledWith({
        where: { youtubeId: 'video123' },
        create: expect.objectContaining({
          title: 'Untitled Video',
          description: null,
          duration: 0,
          viewCount: 0,
          likeCount: 0,
          commentCount: 0,
          tags: null,
          categoryId: null,
          language: null,
        }),
        update: expect.anything(),
      });
    });

    test('should throw error for missing required fields', async () => {
      await expect(manager.upsertVideo({} as any)).rejects.toThrow(
        'Invalid video data: missing required fields'
      );
    });

    test('should parse duration correctly', async () => {
      const videoWithDuration = {
        ...mockYtVideo,
        contentDetails: { duration: 'PT1H30M45S' },
      };
      (db.video.upsert as jest.Mock).mockResolvedValue(mockDbVideo);

      await manager.upsertVideo(videoWithDuration);

      expect(db.video.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            duration: 5445, // 1*3600 + 30*60 + 45
          }),
        })
      );
    });

    test('should use defaultAudioLanguage if defaultLanguage is missing', async () => {
      const videoWithAudioLanguage = {
        ...mockYtVideo,
        snippet: {
          ...mockYtVideo.snippet,
          defaultLanguage: undefined,
          defaultAudioLanguage: 'ko',
        },
      };
      (db.video.upsert as jest.Mock).mockResolvedValue(mockDbVideo);

      await manager.upsertVideo(videoWithAudioLanguage);

      expect(db.video.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            language: 'ko',
          }),
        })
      );
    });
  });

  describe('upsertVideos', () => {
    const mockYtVideos = [
      {
        id: 'video1',
        snippet: { title: 'Video 1' },
        contentDetails: { duration: 'PT5M' },
      },
      {
        id: 'video2',
        snippet: { title: 'Video 2' },
        contentDetails: { duration: 'PT10M' },
      },
    ];

    test('should upsert multiple videos', async () => {
      (db.video.upsert as jest.Mock).mockResolvedValueOnce({ id: '1' });
      (db.video.upsert as jest.Mock).mockResolvedValueOnce({ id: '2' });

      const results = await manager.upsertVideos(mockYtVideos);

      expect(db.video.upsert).toHaveBeenCalledTimes(2);
      expect(results).toHaveLength(2);
    });

    test('should continue on individual video errors', async () => {
      (db.video.upsert as jest.Mock)
        .mockRejectedValueOnce(new Error('Failed'))
        .mockResolvedValueOnce({ id: '2' });

      const results = await manager.upsertVideos(mockYtVideos);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({ id: '2' });
    });
  });

  describe('fetchAndStoreVideos', () => {
    const mockYtVideos = [
      {
        id: 'video1',
        snippet: { title: 'Video 1' },
        contentDetails: { duration: 'PT5M' },
      },
    ];

    test('should fetch and store videos', async () => {
      mockYouTubeClient.getVideosBatch.mockResolvedValue(mockYtVideos);
      (db.video.upsert as jest.Mock).mockResolvedValue({ id: '1' });

      const results = await manager.fetchAndStoreVideos(['video1']);

      expect(mockQuotaManager.getOperationCost).toHaveBeenCalledWith({
        type: 'video.details',
        itemCount: 1,
      });
      expect(mockQuotaManager.reserveQuota).toHaveBeenCalled();
      expect(mockYouTubeClient.getVideosBatch).toHaveBeenCalledWith(['video1']);
      expect(results).toHaveLength(1);
    });

    test('should return empty array for empty input', async () => {
      const results = await manager.fetchAndStoreVideos([]);

      expect(results).toEqual([]);
      expect(mockYouTubeClient.getVideosBatch).not.toHaveBeenCalled();
    });
  });

  describe('getVideo', () => {
    const mockVideo = {
      id: 'db-video-1',
      youtubeId: 'video123',
      title: 'Test Video',
    };

    test('should get video by database ID', async () => {
      (db.video.findFirst as jest.Mock).mockResolvedValue(mockVideo);

      const result = await manager.getVideo('db-video-1');

      expect(db.video.findFirst).toHaveBeenCalledWith({
        where: {
          OR: [{ id: 'db-video-1' }, { youtubeId: 'db-video-1' }],
        },
      });
      expect(result).toEqual(mockVideo);
    });

    test('should get video by YouTube ID', async () => {
      (db.video.findFirst as jest.Mock).mockResolvedValue(mockVideo);

      const result = await manager.getVideo('video123');

      expect(result).toEqual(mockVideo);
    });

    test('should throw error if video not found', async () => {
      (db.video.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(manager.getVideo('non-existent')).rejects.toThrow(
        RecordNotFoundError
      );
    });
  });

  describe('getVideoWithState', () => {
    const mockVideoWithState = {
      id: 'db-video-1',
      youtubeId: 'video123',
      title: 'Test Video',
      userState: {
        id: 'state-1',
        watchStatus: WatchStatus.WATCHING,
        lastPosition: 100,
      },
    };

    test('should get video with user state', async () => {
      (db.video.findFirst as jest.Mock).mockResolvedValue({ id: 'db-video-1' });
      (db.video.findUnique as jest.Mock).mockResolvedValue(mockVideoWithState);

      const result = await manager.getVideoWithState('db-video-1');

      expect(db.video.findUnique).toHaveBeenCalledWith({
        where: { id: 'db-video-1' },
        include: { userState: true },
      });
      expect(result).toEqual(mockVideoWithState);
    });
  });

  describe('updateUserState', () => {
    const mockVideo = { id: 'db-video-1', youtubeId: 'video123' };
    const mockState = {
      id: 'state-1',
      videoId: 'db-video-1',
      watchStatus: WatchStatus.WATCHING,
      lastPosition: 100,
    };

    test('should create new user state', async () => {
      (db.video.findFirst as jest.Mock).mockResolvedValue(mockVideo);
      (db.userVideoState.upsert as jest.Mock).mockResolvedValue(mockState);

      const result = await manager.updateUserState('db-video-1', {
        watchStatus: WatchStatus.WATCHING,
        lastPosition: 100,
      });

      expect(db.userVideoState.upsert).toHaveBeenCalledWith({
        where: { videoId: 'db-video-1' },
        create: expect.objectContaining({
          videoId: 'db-video-1',
          watchStatus: WatchStatus.WATCHING,
          lastPosition: 100,
          watchCount: 0,
        }),
        update: expect.objectContaining({
          watchStatus: WatchStatus.WATCHING,
          lastPosition: 100,
        }),
      });
      expect(result).toEqual(mockState);
    });

    test('should increment watch count when completed', async () => {
      (db.video.findFirst as jest.Mock).mockResolvedValue(mockVideo);
      (db.userVideoState.upsert as jest.Mock).mockResolvedValue(mockState);

      await manager.updateUserState('db-video-1', {
        watchStatus: WatchStatus.COMPLETED,
      });

      expect(db.userVideoState.upsert).toHaveBeenCalledWith({
        where: { videoId: 'db-video-1' },
        create: expect.objectContaining({
          watchCount: 1,
        }),
        update: expect.objectContaining({
          watchCount: { increment: 1 },
        }),
      });
    });

    test('should update notes', async () => {
      (db.video.findFirst as jest.Mock).mockResolvedValue(mockVideo);
      (db.userVideoState.upsert as jest.Mock).mockResolvedValue(mockState);

      await manager.updateUserState('db-video-1', {
        notes: 'My notes',
      });

      expect(db.userVideoState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            notes: 'My notes',
          }),
          update: expect.objectContaining({
            notes: 'My notes',
          }),
        })
      );
    });

    test('should update tags as JSON', async () => {
      (db.video.findFirst as jest.Mock).mockResolvedValue(mockVideo);
      (db.userVideoState.upsert as jest.Mock).mockResolvedValue(mockState);

      await manager.updateUserState('db-video-1', {
        tags: ['tag1', 'tag2'],
      });

      expect(db.userVideoState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            tags: JSON.stringify(['tag1', 'tag2']),
          }),
        })
      );
    });
  });

  describe('markAsWatched', () => {
    test('should mark video as watched', async () => {
      (db.video.findFirst as jest.Mock).mockResolvedValue({ id: 'db-video-1' });
      (db.userVideoState.upsert as jest.Mock).mockResolvedValue({});

      await manager.markAsWatched('db-video-1', 100);

      expect(db.userVideoState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            watchStatus: WatchStatus.COMPLETED,
            lastPosition: 100,
          }),
        })
      );
    });
  });

  describe('updateProgress', () => {
    test('should update watch progress', async () => {
      (db.video.findFirst as jest.Mock).mockResolvedValue({ id: 'db-video-1' });
      (db.userVideoState.upsert as jest.Mock).mockResolvedValue({});

      await manager.updateProgress('db-video-1', 200);

      expect(db.userVideoState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            watchStatus: WatchStatus.WATCHING,
            lastPosition: 200,
          }),
        })
      );
    });
  });

  describe('addNotes', () => {
    test('should add notes to video', async () => {
      (db.video.findFirst as jest.Mock).mockResolvedValue({ id: 'db-video-1' });
      (db.userVideoState.upsert as jest.Mock).mockResolvedValue({});

      await manager.addNotes('db-video-1', 'Test notes');

      expect(db.userVideoState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            notes: 'Test notes',
          }),
        })
      );
    });
  });

  describe('addSummary', () => {
    test('should add summary to video', async () => {
      (db.video.findFirst as jest.Mock).mockResolvedValue({ id: 'db-video-1' });
      (db.userVideoState.upsert as jest.Mock).mockResolvedValue({});

      await manager.addSummary('db-video-1', 'Test summary');

      expect(db.userVideoState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            summary: 'Test summary',
          }),
        })
      );
    });
  });

  describe('rateVideo', () => {
    test('should rate video with valid rating', async () => {
      (db.video.findFirst as jest.Mock).mockResolvedValue({ id: 'db-video-1' });
      (db.userVideoState.upsert as jest.Mock).mockResolvedValue({});

      await manager.rateVideo('db-video-1', 5);

      expect(db.userVideoState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            rating: 5,
          }),
        })
      );
    });

    test('should throw error for invalid rating', async () => {
      (db.video.findFirst as jest.Mock).mockResolvedValue({ id: 'db-video-1' });

      await expect(manager.rateVideo('db-video-1', 0)).rejects.toThrow(
        'Rating must be between 1 and 5'
      );
      await expect(manager.rateVideo('db-video-1', 6)).rejects.toThrow(
        'Rating must be between 1 and 5'
      );
    });
  });

  describe('findDuplicates', () => {
    const mockDuplicates = [
      {
        youtubeId: 'video1',
        title: 'Duplicate Video',
        count: BigInt(3),
      },
    ];

    const mockVideoWithPlaylists = {
      id: 'db-video-1',
      youtubeId: 'video1',
      title: 'Duplicate Video',
      playlistItems: [
        { playlist: { title: 'Playlist 1' } },
        { playlist: { title: 'Playlist 2' } },
        { playlist: { title: 'Playlist 3' } },
      ],
    };

    test('should find duplicate videos across playlists', async () => {
      (db.$queryRaw as jest.Mock).mockResolvedValue(mockDuplicates);
      (db.video.findUnique as jest.Mock).mockResolvedValue(mockVideoWithPlaylists);

      const results = await manager.findDuplicates();

      expect(results).toEqual([
        {
          youtubeId: 'video1',
          title: 'Duplicate Video',
          count: 3,
          playlists: ['Playlist 1', 'Playlist 2', 'Playlist 3'],
        },
      ]);
    });

    test('should return empty array when no duplicates', async () => {
      (db.$queryRaw as jest.Mock).mockResolvedValue([]);

      const results = await manager.findDuplicates();

      expect(results).toEqual([]);
    });

    test('should handle missing video data', async () => {
      (db.$queryRaw as jest.Mock).mockResolvedValue(mockDuplicates);
      (db.video.findUnique as jest.Mock).mockResolvedValue(null);

      const results = await manager.findDuplicates();

      expect(results).toEqual([]);
    });
  });

  describe('updateVideoStats', () => {
    const mockVideo = {
      id: 'db-video-1',
      youtubeId: 'video123',
    };

    const mockYtVideo = {
      id: 'video123',
      snippet: { title: 'Updated Video' },
      contentDetails: { duration: 'PT10M' },
      statistics: {
        viewCount: '2000',
      },
    };

    test('should update video statistics from YouTube', async () => {
      (db.video.findFirst as jest.Mock).mockResolvedValue(mockVideo);
      mockYouTubeClient.getVideos.mockResolvedValue([mockYtVideo]);
      (db.video.upsert as jest.Mock).mockResolvedValue({ ...mockVideo, viewCount: 2000 });

      await manager.updateVideoStats('db-video-1');

      expect(mockQuotaManager.reserveQuota).toHaveBeenCalledWith(
        'video.details',
        1
      );
      expect(mockYouTubeClient.getVideos).toHaveBeenCalledWith(['video123']);
      expect(db.video.upsert).toHaveBeenCalled();
    });

    test('should throw error if video not found on YouTube', async () => {
      (db.video.findFirst as jest.Mock).mockResolvedValue(mockVideo);
      mockYouTubeClient.getVideos.mockResolvedValue([]);

      await expect(manager.updateVideoStats('db-video-1')).rejects.toThrow(
        RecordNotFoundError
      );
    });
  });

  describe('parseDuration', () => {
    test('should parse duration formats correctly', async () => {
      const testCases = [
        { input: 'PT1H30M45S', expected: 5445 },
        { input: 'PT10M30S', expected: 630 },
        { input: 'PT45S', expected: 45 },
        { input: 'PT1H', expected: 3600 },
        { input: 'PT30M', expected: 1800 },
        { input: 'PT0S', expected: 0 },
        { input: 'INVALID', expected: 0 },
      ];

      for (const { input, expected } of testCases) {
        const ytVideo = {
          id: 'test',
          snippet: { title: 'Test' },
          contentDetails: { duration: input },
        };
        (db.video.upsert as jest.Mock).mockResolvedValue({});

        await manager.upsertVideo(ytVideo);

        expect(db.video.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            create: expect.objectContaining({
              duration: expected,
            }),
          })
        );
      }
    });
  });
});
