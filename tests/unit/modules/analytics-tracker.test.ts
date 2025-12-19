/**
 * Analytics Tracker Unit Tests
 *
 * Tests for AnalyticsTracker implementation:
 * - Session recording and tracking
 * - Video completion rate calculation
 * - Playlist progress analysis
 * - Learning dashboard statistics
 * - Retention metrics
 * - Learning streak calculation
 */

import { AnalyticsTracker, getAnalyticsTracker } from '../../../src/modules/analytics/tracker';
import { logger } from '../../../src/utils/logger';
import type { CreateSessionInput } from '../../../src/modules/analytics/types';

// Mock dependencies
jest.mock('../../../src/config', () => ({
  config: {
    app: {
      isDevelopment: false,
    },
    paths: {
      logs: '/tmp/logs',
    },
  },
}));

// Mock database
const mockDb: any = {
  video: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
  playlist: {
    findFirst: jest.fn(),
  },
  watchSession: {
    create: jest.fn(),
    delete: jest.fn(),
    findMany: jest.fn(),
  },
};

jest.mock('../../../src/modules/database', () => ({
  getPrismaClient: jest.fn(() => mockDb),
}));
jest.mock('../../../src/utils/logger');

describe('AnalyticsTracker', () => {
  let tracker: AnalyticsTracker;

  // Mock data
  const mockVideo = {
    id: 'video-db-1',
    youtubeId: 'video-yt-1',
    title: 'Test Video',
    duration: 600, // 10 minutes
  };

  const mockSession = {
    id: 'session-1',
    videoId: 'video-db-1',
    startedAt: new Date('2024-01-01T10:00:00Z'),
    endedAt: new Date('2024-01-01T10:05:00Z'),
    startPos: 0,
    endPos: 300,
    duration: 300,
    createdAt: new Date('2024-01-01T10:05:00Z'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tracker = new AnalyticsTracker();
  });

  describe('recordSession', () => {
    const createInput: CreateSessionInput = {
      videoId: 'video-yt-1',
      startPos: 0,
      endPos: 300,
      startedAt: new Date('2024-01-01T10:00:00Z'),
      endedAt: new Date('2024-01-01T10:05:00Z'),
    };

    it('should record session successfully', async () => {
      // Arrange
      mockDb.video.findUnique.mockResolvedValue(mockVideo);
      mockDb.watchSession.create.mockResolvedValue(mockSession);

      // Act
      const result = await tracker.recordSession(createInput);

      // Assert
      expect(result.success).toBe(true);
      expect(result.session).toBeDefined();
      expect(result.session?.id).toBe('session-1');
      expect(result.session?.duration).toBe(300);
      expect(mockDb.video.findUnique).toHaveBeenCalledWith({
        where: { youtubeId: 'video-yt-1' },
      });
      expect(mockDb.watchSession.create).toHaveBeenCalled();
    });

    it('should calculate duration from start and end times', async () => {
      // Arrange
      mockDb.video.findUnique.mockResolvedValue(mockVideo);
      mockDb.watchSession.create.mockResolvedValue(mockSession);

      // Act
      await tracker.recordSession(createInput);

      // Assert
      const createCall = mockDb.watchSession.create.mock.calls[0][0];
      expect(createCall.data.duration).toBe(300); // 5 minutes
    });

    it('should use current time if startedAt/endedAt not provided', async () => {
      // Arrange
      const input: CreateSessionInput = {
        videoId: 'video-yt-1',
        startPos: 0,
        endPos: 300,
      };
      mockDb.video.findUnique.mockResolvedValue(mockVideo);
      mockDb.watchSession.create.mockResolvedValue(mockSession);

      // Act
      const result = await tracker.recordSession(input);

      // Assert
      expect(result.success).toBe(true);
      const createCall = mockDb.watchSession.create.mock.calls[0][0];
      expect(createCall.data.startedAt).toBeInstanceOf(Date);
      expect(createCall.data.endedAt).toBeInstanceOf(Date);
    });

    it('should return error when video not found', async () => {
      // Arrange
      mockDb.video.findUnique.mockResolvedValue(null);

      // Act
      const result = await tracker.recordSession(createInput);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('Video not found in database');
      expect(mockDb.watchSession.create).not.toHaveBeenCalled();
    });

    it('should handle database errors gracefully', async () => {
      // Arrange
      mockDb.video.findUnique.mockRejectedValue(new Error('Database error'));

      // Act
      const result = await tracker.recordSession(createInput);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('Database error');
    });
  });

  describe('getVideoAnalytics', () => {
    it('should return null for non-existent video', async () => {
      // Arrange
      mockDb.video.findUnique.mockResolvedValue(null);

      // Act
      const analytics = await tracker.getVideoAnalytics('non-existent');

      // Assert
      expect(analytics).toBeNull();
    });

    it('should return zero metrics for video with no sessions', async () => {
      // Arrange
      mockDb.video.findUnique.mockResolvedValue({
        ...mockVideo,
        watchSessions: [],
      });

      // Act
      const analytics = await tracker.getVideoAnalytics('video-yt-1');

      // Assert
      expect(analytics).toEqual({
        videoId: 'video-yt-1',
        videoTitle: 'Test Video',
        totalDuration: 600,
        totalWatchTime: 0,
        completionPercentage: 0,
        watchCount: 0,
        lastWatchedAt: null,
        firstWatchedAt: null,
        averageSessionDuration: 0,
        rewatchCount: 0,
      });
    });

    it('should calculate metrics correctly for single session', async () => {
      // Arrange
      mockDb.video.findUnique.mockResolvedValue({
        ...mockVideo,
        watchSessions: [mockSession],
      });

      // Act
      const analytics = await tracker.getVideoAnalytics('video-yt-1');

      // Assert
      expect(analytics).toBeDefined();
      expect(analytics?.totalWatchTime).toBe(300);
      expect(analytics?.completionPercentage).toBe(50); // 300/600 * 100
      expect(analytics?.watchCount).toBe(1);
      expect(analytics?.averageSessionDuration).toBe(300);
      expect(analytics?.rewatchCount).toBe(0);
    });

    it('should calculate completion percentage correctly', async () => {
      // Arrange
      const sessions = [
        { ...mockSession, startPos: 0, endPos: 200, duration: 200 },
        { ...mockSession, id: 'session-2', startPos: 200, endPos: 500, duration: 300 },
      ];
      mockDb.video.findUnique.mockResolvedValue({
        ...mockVideo,
        watchSessions: sessions,
      });

      // Act
      const analytics = await tracker.getVideoAnalytics('video-yt-1');

      // Assert
      expect(analytics?.completionPercentage).toBe(83.33); // 500/600 * 100 rounded
    });

    it('should cap completion percentage at 100%', async () => {
      // Arrange
      const sessions = [
        { ...mockSession, startPos: 0, endPos: 700, duration: 700 },
      ];
      mockDb.video.findUnique.mockResolvedValue({
        ...mockVideo,
        watchSessions: sessions,
      });

      // Act
      const analytics = await tracker.getVideoAnalytics('video-yt-1');

      // Assert
      expect(analytics?.completionPercentage).toBe(100);
    });

    it('should count rewatches correctly', async () => {
      // Arrange
      const sessions = [
        { ...mockSession, id: 's1', startPos: 0, endPos: 200, duration: 200 },
        { ...mockSession, id: 's2', startPos: 200, endPos: 500, duration: 300 }, // Reaches 80%+ (83%)
        { ...mockSession, id: 's3', startPos: 500, endPos: 600, duration: 100 }, // Rewatch
        { ...mockSession, id: 's4', startPos: 0, endPos: 100, duration: 100 }, // Rewatch
        { ...mockSession, id: 's5', startPos: 100, endPos: 300, duration: 200 }, // Rewatch
      ];
      mockDb.video.findUnique.mockResolvedValue({
        ...mockVideo,
        watchSessions: sessions,
      });

      // Act
      const analytics = await tracker.getVideoAnalytics('video-yt-1');

      // Assert
      expect(analytics?.rewatchCount).toBe(3); // 3 sessions after reaching 80% (s3, s4, s5)
    });

    it('should track first and last watched dates', async () => {
      // Arrange
      const sessions = [
        { ...mockSession, id: 's1', startedAt: new Date('2024-01-01T10:00:00Z') },
        { ...mockSession, id: 's2', startedAt: new Date('2024-01-02T10:00:00Z') },
        { ...mockSession, id: 's3', startedAt: new Date('2024-01-03T10:00:00Z') },
      ];
      mockDb.video.findUnique.mockResolvedValue({
        ...mockVideo,
        watchSessions: sessions,
      });

      // Act
      const analytics = await tracker.getVideoAnalytics('video-yt-1');

      // Assert
      expect(analytics?.firstWatchedAt).toEqual(new Date('2024-01-01T10:00:00Z'));
      expect(analytics?.lastWatchedAt).toEqual(new Date('2024-01-03T10:00:00Z'));
    });

    it('should handle database errors gracefully', async () => {
      // Arrange
      mockDb.video.findUnique.mockRejectedValue(new Error('Database error'));

      // Act
      const analytics = await tracker.getVideoAnalytics('video-yt-1');

      // Assert
      expect(analytics).toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getPlaylistAnalytics', () => {
    const mockPlaylist = {
      id: 'playlist-db-1',
      youtubeId: 'playlist-yt-1',
      title: 'Test Playlist',
      items: [],
    };

    it('should return null for non-existent playlist', async () => {
      // Arrange
      mockDb.playlist.findFirst.mockResolvedValue(null);

      // Act
      const analytics = await tracker.getPlaylistAnalytics('non-existent');

      // Assert
      expect(analytics).toBeNull();
    });

    it('should return zero metrics for playlist with no videos', async () => {
      // Arrange
      mockDb.playlist.findFirst.mockResolvedValue({
        ...mockPlaylist,
        items: [],
      });

      // Act
      const analytics = await tracker.getPlaylistAnalytics('playlist-yt-1');

      // Assert
      expect(analytics).toEqual({
        playlistId: 'playlist-yt-1',
        playlistTitle: 'Test Playlist',
        totalVideos: 0,
        watchedVideos: 0,
        completedVideos: 0,
        totalWatchTime: 0,
        averageCompletion: 0,
        lastActivity: null,
        videoAnalytics: [],
      });
    });

    it('should calculate playlist progress correctly', async () => {
      // Arrange
      const video1 = {
        ...mockVideo,
        id: 'v1',
        youtubeId: 'yt1',
        watchSessions: [
          { ...mockSession, endPos: 480, duration: 480 }, // 80% complete
        ],
      };
      const video2 = {
        ...mockVideo,
        id: 'v2',
        youtubeId: 'yt2',
        watchSessions: [
          { ...mockSession, endPos: 300, duration: 300 }, // 50% complete
        ],
      };
      const video3 = {
        ...mockVideo,
        id: 'v3',
        youtubeId: 'yt3',
        watchSessions: [], // Not started
      };

      mockDb.playlist.findFirst.mockResolvedValue({
        ...mockPlaylist,
        items: [
          { video: video1 },
          { video: video2 },
          { video: video3 },
        ],
      });

      // Mock getVideoAnalytics calls
      mockDb.video.findUnique
        .mockResolvedValueOnce(video1)
        .mockResolvedValueOnce(video2)
        .mockResolvedValueOnce(video3);

      // Act
      const analytics = await tracker.getPlaylistAnalytics('playlist-yt-1');

      // Assert
      expect(analytics?.totalVideos).toBe(3);
      expect(analytics?.watchedVideos).toBe(2);
      expect(analytics?.completedVideos).toBe(1); // Only video1 >= 80%
      expect(analytics?.totalWatchTime).toBe(780); // 480 + 300
    });

    it('should track last activity across videos', async () => {
      // Arrange
      const video1 = {
        ...mockVideo,
        id: 'v1',
        youtubeId: 'yt1',
        watchSessions: [
          { ...mockSession, startedAt: new Date('2024-01-01T10:00:00Z') },
        ],
      };
      const video2 = {
        ...mockVideo,
        id: 'v2',
        youtubeId: 'yt2',
        watchSessions: [
          { ...mockSession, startedAt: new Date('2024-01-03T10:00:00Z') }, // Latest
        ],
      };

      mockDb.playlist.findFirst.mockResolvedValue({
        ...mockPlaylist,
        items: [{ video: video1 }, { video: video2 }],
      });

      mockDb.video.findUnique
        .mockResolvedValueOnce(video1)
        .mockResolvedValueOnce(video2);

      // Act
      const analytics = await tracker.getPlaylistAnalytics('playlist-yt-1');

      // Assert
      expect(analytics?.lastActivity).toEqual(new Date('2024-01-03T10:00:00Z'));
    });

    it('should handle database errors gracefully', async () => {
      // Arrange
      mockDb.playlist.findFirst.mockRejectedValue(new Error('Database error'));

      // Act
      const analytics = await tracker.getPlaylistAnalytics('playlist-yt-1');

      // Assert
      expect(analytics).toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getLearningDashboard', () => {
    it('should return empty dashboard when no videos exist', async () => {
      // Arrange
      mockDb.video.findMany.mockResolvedValue([]);
      mockDb.watchSession.findMany.mockResolvedValue([]);

      // Act
      const dashboard = await tracker.getLearningDashboard();

      // Assert
      expect(dashboard).toEqual({
        totalVideos: 0,
        totalWatchTime: 0,
        totalSessions: 0,
        averageSessionDuration: 0,
        completedVideos: 0,
        inProgressVideos: 0,
        notStartedVideos: 0,
        recentActivity: [],
        topVideos: [],
        learningStreak: {
          currentStreak: 0,
          longestStreak: 0,
          lastActiveDate: null,
        },
      });
    });

    it('should categorize videos by completion status', async () => {
      // Arrange
      const videos = [
        {
          ...mockVideo,
          id: 'v1',
          youtubeId: 'yt1',
          watchSessions: [{ ...mockSession, endPos: 480, duration: 480 }], // 80% - completed
        },
        {
          ...mockVideo,
          id: 'v2',
          youtubeId: 'yt2',
          watchSessions: [{ ...mockSession, endPos: 300, duration: 300 }], // 50% - in progress
        },
        {
          ...mockVideo,
          id: 'v3',
          youtubeId: 'yt3',
          watchSessions: [], // Not started
        },
      ];

      mockDb.video.findMany.mockResolvedValue(videos);
      mockDb.watchSession.findMany.mockResolvedValue([]);

      // Act
      const dashboard = await tracker.getLearningDashboard();

      // Assert
      expect(dashboard.totalVideos).toBe(3);
      expect(dashboard.completedVideos).toBe(1);
      expect(dashboard.inProgressVideos).toBe(1);
      expect(dashboard.notStartedVideos).toBe(1);
    });

    it('should calculate total watch time correctly', async () => {
      // Arrange
      const videos = [
        {
          ...mockVideo,
          id: 'v1',
          watchSessions: [
            { ...mockSession, duration: 300 },
            { ...mockSession, duration: 200 },
          ],
        },
        {
          ...mockVideo,
          id: 'v2',
          watchSessions: [{ ...mockSession, duration: 500 }],
        },
      ];

      mockDb.video.findMany.mockResolvedValue(videos);
      mockDb.watchSession.findMany.mockResolvedValue([]);

      // Act
      const dashboard = await tracker.getLearningDashboard();

      // Assert
      expect(dashboard.totalWatchTime).toBe(1000); // 300 + 200 + 500
      expect(dashboard.totalSessions).toBe(3);
      expect(dashboard.averageSessionDuration).toBe(333); // 1000 / 3 rounded
    });

    it('should populate top videos list', async () => {
      // Arrange
      const videos = [
        {
          ...mockVideo,
          id: 'v1',
          youtubeId: 'yt1',
          title: 'Video 1',
          watchSessions: [
            { ...mockSession, duration: 500, endPos: 500 },
          ],
        },
        {
          ...mockVideo,
          id: 'v2',
          youtubeId: 'yt2',
          title: 'Video 2',
          watchSessions: [
            { ...mockSession, duration: 300, endPos: 300 },
          ],
        },
      ];

      mockDb.video.findMany.mockResolvedValue(videos);
      mockDb.watchSession.findMany.mockResolvedValue([]);

      // Act
      const dashboard = await tracker.getLearningDashboard();

      // Assert
      expect(dashboard.topVideos).toHaveLength(2);
      expect(dashboard.topVideos[0]?.videoId).toBe('yt1'); // Sorted by watch time
      expect(dashboard.topVideos[0]?.watchTime).toBe(500);
      expect(dashboard.topVideos[1]?.videoId).toBe('yt2');
    });

    it('should limit top videos to 10', async () => {
      // Arrange
      const videos = Array.from({ length: 15 }, (_, i) => ({
        ...mockVideo,
        id: `v${i}`,
        youtubeId: `yt${i}`,
        title: `Video ${i}`,
        watchSessions: [{ ...mockSession, duration: 100 * i }],
      }));

      mockDb.video.findMany.mockResolvedValue(videos);
      mockDb.watchSession.findMany.mockResolvedValue([]);

      // Act
      const dashboard = await tracker.getLearningDashboard();

      // Assert
      expect(dashboard.topVideos).toHaveLength(10);
    });

    it('should populate recent activity list', async () => {
      // Arrange
      const videos = [
        {
          ...mockVideo,
          id: 'v1',
          youtubeId: 'yt1',
          title: 'Video 1',
          watchSessions: [
            {
              ...mockSession,
              startedAt: new Date('2024-01-03T10:00:00Z'),
              duration: 300,
              endPos: 300,
            },
          ],
        },
        {
          ...mockVideo,
          id: 'v2',
          youtubeId: 'yt2',
          title: 'Video 2',
          watchSessions: [
            {
              ...mockSession,
              startedAt: new Date('2024-01-01T10:00:00Z'),
              duration: 200,
              endPos: 200,
            },
          ],
        },
      ];

      mockDb.video.findMany.mockResolvedValue(videos);
      mockDb.watchSession.findMany.mockResolvedValue([]);

      // Act
      const dashboard = await tracker.getLearningDashboard();

      // Assert
      expect(dashboard.recentActivity).toHaveLength(2);
      expect(dashboard.recentActivity[0]?.videoId).toBe('yt1'); // Sorted by date desc
      expect(dashboard.recentActivity[0]?.watchedAt).toEqual(
        new Date('2024-01-03T10:00:00Z')
      );
    });

    it('should handle database errors gracefully', async () => {
      // Arrange
      mockDb.video.findMany.mockRejectedValue(new Error('Database error'));
      mockDb.watchSession.findMany.mockResolvedValue([]);

      // Act
      const dashboard = await tracker.getLearningDashboard();

      // Assert
      expect(dashboard.totalVideos).toBe(0);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getRetentionMetrics', () => {
    it('should return null for non-existent video', async () => {
      // Arrange
      mockDb.video.findUnique.mockResolvedValue(null);

      // Act
      const metrics = await tracker.getRetentionMetrics('non-existent');

      // Assert
      expect(metrics).toBeNull();
    });

    it('should classify difficulty as easy for no rewatches', async () => {
      // Arrange
      mockDb.video.findUnique.mockResolvedValue({
        ...mockVideo,
        watchSessions: [{ ...mockSession, endPos: 500, duration: 500 }],
      });

      // Act
      const metrics = await tracker.getRetentionMetrics('video-yt-1');

      // Assert
      expect(metrics?.difficulty).toBe('easy');
    });

    it('should classify difficulty as medium for 1-2 rewatches', async () => {
      // Arrange
      mockDb.video.findUnique.mockResolvedValue({
        ...mockVideo,
        watchSessions: [
          { ...mockSession, id: 's1', endPos: 480, duration: 480 }, // Reaches 80%
          { ...mockSession, id: 's2', endPos: 300, duration: 300 }, // Rewatch 1
          { ...mockSession, id: 's3', endPos: 400, duration: 400 }, // Rewatch 2
        ],
      });

      // Act
      const metrics = await tracker.getRetentionMetrics('video-yt-1');

      // Assert
      expect(metrics?.difficulty).toBe('medium');
      expect(metrics?.reviewCount).toBe(2);
    });

    it('should classify difficulty as hard for 3+ rewatches', async () => {
      // Arrange
      mockDb.video.findUnique.mockResolvedValue({
        ...mockVideo,
        watchSessions: [
          { ...mockSession, id: 's1', endPos: 480, duration: 480 }, // Reaches 80%
          { ...mockSession, id: 's2', endPos: 300, duration: 300 }, // Rewatch 1
          { ...mockSession, id: 's3', endPos: 400, duration: 400 }, // Rewatch 2
          { ...mockSession, id: 's4', endPos: 500, duration: 500 }, // Rewatch 3
        ],
      });

      // Act
      const metrics = await tracker.getRetentionMetrics('video-yt-1');

      // Assert
      expect(metrics?.difficulty).toBe('hard');
      expect(metrics?.reviewCount).toBe(3);
    });

    it('should calculate retention score correctly', async () => {
      // Arrange
      mockDb.video.findUnique.mockResolvedValue({
        ...mockVideo,
        watchSessions: [
          { ...mockSession, endPos: 480, duration: 480 }, // 80% completion
        ],
      });

      // Act
      const metrics = await tracker.getRetentionMetrics('video-yt-1');

      // Assert
      // Score = (completion / 100) * (1 - rewatches * 0.15) * 100
      // Score = 0.8 * 1.0 * 100 = 80
      expect(metrics?.retentionScore).toBe(80);
    });

    it('should penalize retention score for rewatches', async () => {
      // Arrange
      mockDb.video.findUnique.mockResolvedValue({
        ...mockVideo,
        watchSessions: [
          { ...mockSession, id: 's1', endPos: 480, duration: 480 }, // 80% completion
          { ...mockSession, id: 's2', endPos: 300, duration: 300 }, // Rewatch 1
          { ...mockSession, id: 's3', endPos: 400, duration: 400 }, // Rewatch 2
        ],
      });

      // Act
      const metrics = await tracker.getRetentionMetrics('video-yt-1');

      // Assert
      // Score = 0.8 * (1 - 2 * 0.15) * 100 = 0.8 * 0.7 * 100 = 56
      expect(metrics?.retentionScore).toBe(56);
    });

    it('should recommend review date based on retention score', async () => {
      // Arrange
      const lastWatched = new Date('2024-01-01T10:00:00Z');
      mockDb.video.findUnique.mockResolvedValue({
        ...mockVideo,
        watchSessions: [
          { ...mockSession, endPos: 540, duration: 540, startedAt: lastWatched }, // 90% completion
        ],
      });

      // Act
      const metrics = await tracker.getRetentionMetrics('video-yt-1');

      // Assert
      // Score >= 80 → 30 days
      expect(metrics?.recommendedReviewDate).toBeDefined();
      const expected = new Date(lastWatched);
      expected.setDate(expected.getDate() + 30);
      expect(metrics?.recommendedReviewDate).toEqual(expected);
    });

    it('should return null review date for low completion', async () => {
      // Arrange
      mockDb.video.findUnique.mockResolvedValue({
        ...mockVideo,
        watchSessions: [
          { ...mockSession, endPos: 100, duration: 100 }, // 16% completion
        ],
      });

      // Act
      const metrics = await tracker.getRetentionMetrics('video-yt-1');

      // Assert
      expect(metrics?.recommendedReviewDate).toBeNull();
    });

    it('should handle database errors gracefully', async () => {
      // Arrange
      mockDb.video.findUnique.mockRejectedValue(new Error('Database error'));

      // Act
      const metrics = await tracker.getRetentionMetrics('video-yt-1');

      // Assert
      expect(metrics).toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('calculateLearningStreak', () => {
    it('should return zero streak when no sessions exist', async () => {
      // Arrange
      mockDb.watchSession.findMany.mockResolvedValue([]);

      // Act
      const dashboard = await tracker.getLearningDashboard();

      // Assert
      expect(dashboard.learningStreak).toEqual({
        currentStreak: 0,
        longestStreak: 0,
        lastActiveDate: null,
      });
    });

    it('should calculate current streak from today', async () => {
      // Arrange
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const twoDaysAgo = new Date(today);
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

      mockDb.video.findMany.mockResolvedValue([
        {
          ...mockVideo,
          watchSessions: [
            { ...mockSession, startedAt: today },
            { ...mockSession, startedAt: yesterday },
            { ...mockSession, startedAt: twoDaysAgo },
          ],
        },
      ]);

      mockDb.watchSession.findMany.mockResolvedValue([
        { ...mockSession, startedAt: today },
        { ...mockSession, startedAt: yesterday },
        { ...mockSession, startedAt: twoDaysAgo },
      ]);

      // Act
      const dashboard = await tracker.getLearningDashboard();

      // Assert
      expect(dashboard.learningStreak.currentStreak).toBe(3);
    });

    it('should calculate current streak from yesterday', async () => {
      // Arrange
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

      mockDb.video.findMany.mockResolvedValue([
        {
          ...mockVideo,
          watchSessions: [
            { ...mockSession, startedAt: yesterday },
            { ...mockSession, startedAt: twoDaysAgo },
          ],
        },
      ]);

      mockDb.watchSession.findMany.mockResolvedValue([
        { ...mockSession, startedAt: yesterday },
        { ...mockSession, startedAt: twoDaysAgo },
      ]);

      // Act
      const dashboard = await tracker.getLearningDashboard();

      // Assert
      expect(dashboard.learningStreak.currentStreak).toBe(2);
    });

    it('should reset current streak if gap exists', async () => {
      // Arrange
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      const fourDaysAgo = new Date();
      fourDaysAgo.setDate(fourDaysAgo.getDate() - 4);

      mockDb.video.findMany.mockResolvedValue([
        {
          ...mockVideo,
          watchSessions: [
            { ...mockSession, startedAt: threeDaysAgo },
            { ...mockSession, startedAt: fourDaysAgo },
          ],
        },
      ]);

      mockDb.watchSession.findMany.mockResolvedValue([
        { ...mockSession, startedAt: threeDaysAgo },
        { ...mockSession, startedAt: fourDaysAgo },
      ]);

      // Act
      const dashboard = await tracker.getLearningDashboard();

      // Assert
      expect(dashboard.learningStreak.currentStreak).toBe(0);
    });

    it('should calculate longest streak correctly', async () => {
      // Arrange
      const sessions = [
        { ...mockSession, startedAt: new Date('2024-01-01') },
        { ...mockSession, startedAt: new Date('2024-01-02') },
        { ...mockSession, startedAt: new Date('2024-01-03') },
        // Gap
        { ...mockSession, startedAt: new Date('2024-01-05') },
        { ...mockSession, startedAt: new Date('2024-01-06') },
        { ...mockSession, startedAt: new Date('2024-01-07') },
        { ...mockSession, startedAt: new Date('2024-01-08') },
      ];

      mockDb.video.findMany.mockResolvedValue([
        { ...mockVideo, watchSessions: sessions },
      ]);

      mockDb.watchSession.findMany.mockResolvedValue(sessions);

      // Act
      const dashboard = await tracker.getLearningDashboard();

      // Assert
      expect(dashboard.learningStreak.longestStreak).toBe(4); // Jan 5-8
    });
  });

  describe('deleteSession', () => {
    it('should delete session successfully', async () => {
      // Arrange
      mockDb.watchSession.delete.mockResolvedValue(mockSession);

      // Act
      const result = await tracker.deleteSession('session-1');

      // Assert
      expect(result.success).toBe(true);
      expect(mockDb.watchSession.delete).toHaveBeenCalledWith({
        where: { id: 'session-1' },
      });
    });

    it('should handle deletion errors gracefully', async () => {
      // Arrange
      mockDb.watchSession.delete.mockRejectedValue(new Error('Not found'));

      // Act
      const result = await tracker.deleteSession('non-existent');

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('Not found');
    });
  });

  describe('getVideoSessions', () => {
    it('should return empty array for non-existent video', async () => {
      // Arrange
      mockDb.video.findUnique.mockResolvedValue(null);

      // Act
      const sessions = await tracker.getVideoSessions('non-existent');

      // Assert
      expect(sessions).toEqual([]);
    });

    it('should return all sessions for a video', async () => {
      // Arrange
      const sessions = [
        { ...mockSession, id: 's1', startedAt: new Date('2024-01-01') },
        { ...mockSession, id: 's2', startedAt: new Date('2024-01-02') },
        { ...mockSession, id: 's3', startedAt: new Date('2024-01-03') },
      ];

      mockDb.video.findUnique.mockResolvedValue({
        ...mockVideo,
        watchSessions: sessions,
      });

      // Act
      const result = await tracker.getVideoSessions('video-yt-1');

      // Assert
      expect(result).toHaveLength(3);
      expect(result[0]?.id).toBe('s1');
    });

    it('should handle database errors gracefully', async () => {
      // Arrange
      mockDb.video.findUnique.mockRejectedValue(new Error('Database error'));

      // Act
      const sessions = await tracker.getVideoSessions('video-yt-1');

      // Assert
      expect(sessions).toEqual([]);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getAnalyticsTracker singleton', () => {
    it('should return singleton instance', () => {
      // Act
      const instance1 = getAnalyticsTracker();
      const instance2 = getAnalyticsTracker();

      // Assert
      expect(instance1).toBe(instance2);
    });

    it('should return AnalyticsTracker instance', () => {
      // Act
      const instance = getAnalyticsTracker();

      // Assert
      expect(instance).toBeInstanceOf(AnalyticsTracker);
    });
  });
});
