/**
 * CaptionExtractor Unit Tests
 *
 * Tests for CaptionExtractor implementation including:
 * - Caption extraction from YouTube
 * - Multi-language support
 * - Database caching
 * - Error handling and recovery
 * - Playlist batch operations
 */

import { CaptionExtractor } from '../../../src/modules/caption/extractor';

// Mock dependencies
jest.mock('youtube-caption-extractor');
jest.mock('../../../src/modules/database');
jest.mock('../../../src/utils/logger');

import { getSubtitles } from 'youtube-caption-extractor';
import { getPrismaClient } from '../../../src/modules/database';

const mockGetSubtitles = getSubtitles as jest.MockedFunction<typeof getSubtitles>;

describe('CaptionExtractor', () => {
  let extractor: CaptionExtractor;
  let mockDb: any;

  // Mock data
  const mockVideoId = 'test-video-123';
  const mockVideoRecord = {
    id: 'db-video-1',
    youtubeId: mockVideoId,
    title: 'Test Video',
    channelId: 'test-channel',
    channelTitle: 'Test Channel',
    publishedAt: new Date('2024-01-01'),
    duration: 600,
    thumbnailUrls: '[]',
  };

  const mockCaptionData = [
    { text: 'Hello world', start: '0', dur: '2' },
    { text: 'This is a test', start: '2', dur: '3' },
    { text: 'YouTube caption', start: '5', dur: '2.5' },
  ];

  const mockCaptionRecord = {
    id: 'caption-1',
    videoId: 'db-video-1',
    language: 'en',
    text: 'Hello world This is a test YouTube caption',
    segments: JSON.stringify([
      { text: 'Hello world', start: 0, duration: 2 },
      { text: 'This is a test', start: 2, duration: 3 },
      { text: 'YouTube caption', start: 5, duration: 2.5 },
    ]),
  };

  beforeEach(() => {
    // Setup mock database
    mockDb = {
      video: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      videoCaption: {
        findUnique: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
      },
      playlistItem: {
        findMany: jest.fn(),
      },
    };

    (getPrismaClient as jest.Mock).mockReturnValue(mockDb);

    // Create fresh extractor instance
    extractor = new CaptionExtractor();

    // Clear all mocks
    jest.clearAllMocks();
  });

  describe('extractCaptions', () => {
    it('should extract captions successfully for new video', async () => {
      // Arrange
      mockDb.video.findUnique.mockResolvedValue(null);
      mockDb.video.create.mockResolvedValue(mockVideoRecord);
      mockDb.videoCaption.findUnique.mockResolvedValue(null);
      mockGetSubtitles.mockResolvedValue(mockCaptionData);
      mockDb.videoCaption.create.mockResolvedValue(mockCaptionRecord);

      // Act
      const result = await extractor.extractCaptions(mockVideoId);

      // Assert
      expect(result.success).toBe(true);
      expect(result.videoId).toBe(mockVideoId);
      expect(result.language).toBe('en');
      expect(result.caption).toBeDefined();
      expect(result.caption!.segments).toHaveLength(3);
      expect(result.caption!.fullText).toContain('Hello world');
      expect(mockGetSubtitles).toHaveBeenCalledWith({
        videoID: mockVideoId,
        lang: 'en',
      });
    });

    it('should use existing video record if available', async () => {
      // Arrange
      mockDb.video.findUnique.mockResolvedValue(mockVideoRecord);
      mockDb.videoCaption.findUnique.mockResolvedValue(null);
      mockGetSubtitles.mockResolvedValue(mockCaptionData);
      mockDb.videoCaption.create.mockResolvedValue(mockCaptionRecord);

      // Act
      await extractor.extractCaptions(mockVideoId);

      // Assert
      expect(mockDb.video.create).not.toHaveBeenCalled();
      expect(mockDb.video.findUnique).toHaveBeenCalledWith({
        where: { youtubeId: mockVideoId },
      });
    });

    it('should return cached caption if already exists', async () => {
      // Arrange
      mockDb.video.findUnique.mockResolvedValue(mockVideoRecord);
      mockDb.videoCaption.findUnique.mockResolvedValue(mockCaptionRecord);

      // Act
      const result = await extractor.extractCaptions(mockVideoId, 'en');

      // Assert
      expect(result.success).toBe(true);
      expect(result.caption).toBeDefined();
      expect(mockGetSubtitles).not.toHaveBeenCalled();
      expect(mockDb.videoCaption.create).not.toHaveBeenCalled();
    });

    it('should extract captions in specified language', async () => {
      // Arrange
      const language = 'ko';
      mockDb.video.findUnique.mockResolvedValue(mockVideoRecord);
      mockDb.videoCaption.findUnique.mockResolvedValue(null);
      mockGetSubtitles.mockResolvedValue(mockCaptionData);
      mockDb.videoCaption.create.mockResolvedValue(mockCaptionRecord);

      // Act
      const result = await extractor.extractCaptions(mockVideoId, language);

      // Assert
      expect(result.success).toBe(true);
      expect(result.language).toBe(language);
      expect(mockGetSubtitles).toHaveBeenCalledWith({
        videoID: mockVideoId,
        lang: language,
      });
    });

    it('should handle empty caption data', async () => {
      // Arrange
      mockDb.video.findUnique.mockResolvedValue(mockVideoRecord);
      mockDb.videoCaption.findUnique.mockResolvedValue(null);
      mockGetSubtitles.mockResolvedValue([]);

      // Act
      const result = await extractor.extractCaptions(mockVideoId);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('No captions found for this video');
    });

    it('should handle YouTube API errors', async () => {
      // Arrange
      mockDb.video.findUnique.mockResolvedValue(mockVideoRecord);
      mockDb.videoCaption.findUnique.mockResolvedValue(null);
      mockGetSubtitles.mockRejectedValue(new Error('YouTube API error'));

      // Act
      const result = await extractor.extractCaptions(mockVideoId);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('YouTube API error');
    });

    it('should handle database errors', async () => {
      // Arrange
      mockDb.video.findUnique.mockRejectedValue(new Error('Database connection failed'));

      // Act
      const result = await extractor.extractCaptions(mockVideoId);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('Database connection failed');
    });

    it('should properly format caption segments', async () => {
      // Arrange
      mockDb.video.findUnique.mockResolvedValue(mockVideoRecord);
      mockDb.videoCaption.findUnique.mockResolvedValue(null);
      mockGetSubtitles.mockResolvedValue(mockCaptionData);
      mockDb.videoCaption.create.mockResolvedValue(mockCaptionRecord);

      // Act
      const result = await extractor.extractCaptions(mockVideoId);

      // Assert
      expect(result.caption!.segments).toEqual([
        { text: 'Hello world', start: 0, duration: 2 },
        { text: 'This is a test', start: 2, duration: 3 },
        { text: 'YouTube caption', start: 5, duration: 2.5 },
      ]);
    });

    it('should concatenate segments into full text', async () => {
      // Arrange
      mockDb.video.findUnique.mockResolvedValue(mockVideoRecord);
      mockDb.videoCaption.findUnique.mockResolvedValue(null);
      mockGetSubtitles.mockResolvedValue(mockCaptionData);
      mockDb.videoCaption.create.mockResolvedValue(mockCaptionRecord);

      // Act
      const result = await extractor.extractCaptions(mockVideoId);

      // Assert
      expect(result.caption!.fullText).toBe('Hello world This is a test YouTube caption');
    });
  });

  describe('getAvailableLanguages', () => {
    it('should detect available languages', async () => {
      // Arrange
      mockGetSubtitles
        .mockResolvedValueOnce([{ text: 'English', start: '0', dur: '1' }]) // en
        .mockResolvedValueOnce([{ text: '한국어', start: '0', dur: '1' }]) // ko
        .mockRejectedValueOnce(new Error('Not available')) // ja
        .mockResolvedValueOnce([{ text: 'Español', start: '0', dur: '1' }]) // es
        .mockRejectedValueOnce(new Error('Not available')) // fr
        .mockRejectedValueOnce(new Error('Not available')) // de
        .mockRejectedValueOnce(new Error('Not available')); // zh

      // Act
      const result = await extractor.getAvailableLanguages(mockVideoId);

      // Assert
      expect(result.videoId).toBe(mockVideoId);
      expect(result.languages).toContain('en');
      expect(result.languages).toContain('ko');
      expect(result.languages).toContain('es');
      expect(result.languages).not.toContain('ja');
      expect(result.languages).toHaveLength(3);
    });

    it('should return empty array if no captions available', async () => {
      // Arrange
      mockGetSubtitles.mockRejectedValue(new Error('Not available'));

      // Act
      const result = await extractor.getAvailableLanguages(mockVideoId);

      // Assert
      expect(result.languages).toEqual([]);
    });

    it('should handle API errors gracefully', async () => {
      // Arrange
      mockGetSubtitles.mockRejectedValue(new Error('Network error'));

      // Act
      const result = await extractor.getAvailableLanguages(mockVideoId);

      // Assert
      expect(result.videoId).toBe(mockVideoId);
      expect(result.languages).toEqual([]);
    });
  });

  describe('getCaption', () => {
    it('should retrieve caption from database', async () => {
      // Arrange
      mockDb.video.findUnique.mockResolvedValue(mockVideoRecord);
      mockDb.videoCaption.findUnique.mockResolvedValue(mockCaptionRecord);

      // Act
      const result = await extractor.getCaption(mockVideoId, 'en');

      // Assert
      expect(result).not.toBeNull();
      expect(result!.videoId).toBe(mockVideoId);
      expect(result!.language).toBe('en');
      expect(result!.fullText).toBe(mockCaptionRecord.text);
    });

    it('should return null if video not found', async () => {
      // Arrange
      mockDb.video.findUnique.mockResolvedValue(null);

      // Act
      const result = await extractor.getCaption(mockVideoId);

      // Assert
      expect(result).toBeNull();
    });

    it('should return null if caption not found', async () => {
      // Arrange
      mockDb.video.findUnique.mockResolvedValue(mockVideoRecord);
      mockDb.videoCaption.findUnique.mockResolvedValue(null);

      // Act
      const result = await extractor.getCaption(mockVideoId);

      // Assert
      expect(result).toBeNull();
    });

    it('should parse JSON segments correctly', async () => {
      // Arrange
      mockDb.video.findUnique.mockResolvedValue(mockVideoRecord);
      mockDb.videoCaption.findUnique.mockResolvedValue(mockCaptionRecord);

      // Act
      const result = await extractor.getCaption(mockVideoId);

      // Assert
      expect(result!.segments).toHaveLength(3);
      expect(result!.segments[0]).toEqual({
        text: 'Hello world',
        start: 0,
        duration: 2,
      });
    });

    it('should handle database errors', async () => {
      // Arrange
      mockDb.video.findUnique.mockRejectedValue(new Error('Database error'));

      // Act
      const result = await extractor.getCaption(mockVideoId);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('deleteCaption', () => {
    it('should delete caption successfully', async () => {
      // Arrange
      mockDb.video.findUnique.mockResolvedValue(mockVideoRecord);
      mockDb.videoCaption.delete.mockResolvedValue(mockCaptionRecord);

      // Act
      const result = await extractor.deleteCaption(mockVideoId, 'en');

      // Assert
      expect(result).toBe(true);
      expect(mockDb.videoCaption.delete).toHaveBeenCalledWith({
        where: {
          videoId_language: {
            videoId: mockVideoRecord.id,
            language: 'en',
          },
        },
      });
    });

    it('should return false if video not found', async () => {
      // Arrange
      mockDb.video.findUnique.mockResolvedValue(null);

      // Act
      const result = await extractor.deleteCaption(mockVideoId, 'en');

      // Assert
      expect(result).toBe(false);
      expect(mockDb.videoCaption.delete).not.toHaveBeenCalled();
    });

    it('should handle deletion errors', async () => {
      // Arrange
      mockDb.video.findUnique.mockResolvedValue(mockVideoRecord);
      mockDb.videoCaption.delete.mockRejectedValue(new Error('Delete failed'));

      // Act
      const result = await extractor.deleteCaption(mockVideoId, 'en');

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('extractPlaylistCaptions', () => {
    const mockPlaylistId = 'playlist-123';
    const mockPlaylistItems = [
      {
        id: 'item-1',
        playlistId: mockPlaylistId,
        position: 0,
        video: { ...mockVideoRecord, youtubeId: 'video-1' },
      },
      {
        id: 'item-2',
        playlistId: mockPlaylistId,
        position: 1,
        video: { ...mockVideoRecord, youtubeId: 'video-2' },
      },
      {
        id: 'item-3',
        playlistId: mockPlaylistId,
        position: 2,
        video: { ...mockVideoRecord, youtubeId: 'video-3' },
      },
    ];

    it('should extract captions for all videos in playlist', async () => {
      // Arrange
      mockDb.playlistItem.findMany.mockResolvedValue(mockPlaylistItems);
      mockDb.video.findUnique.mockResolvedValue(mockVideoRecord);
      mockDb.videoCaption.findUnique.mockResolvedValue(null);
      mockGetSubtitles.mockResolvedValue(mockCaptionData);
      mockDb.videoCaption.create.mockResolvedValue(mockCaptionRecord);

      // Act
      const results = await extractor.extractPlaylistCaptions(mockPlaylistId);

      // Assert
      expect(results).toHaveLength(3);
      expect(results.every(r => r.success)).toBe(true);
      expect(mockGetSubtitles).toHaveBeenCalledTimes(3);
    });

    it('should skip removed playlist items', async () => {
      // Arrange
      mockDb.playlistItem.findMany.mockResolvedValue(mockPlaylistItems);
      mockDb.video.findUnique.mockResolvedValue(mockVideoRecord);
      mockDb.videoCaption.findUnique.mockResolvedValue(null);
      mockGetSubtitles.mockResolvedValue(mockCaptionData);
      mockDb.videoCaption.create.mockResolvedValue(mockCaptionRecord);

      // Act
      await extractor.extractPlaylistCaptions(mockPlaylistId);

      // Assert
      expect(mockDb.playlistItem.findMany).toHaveBeenCalledWith({
        where: {
          playlistId: mockPlaylistId,
          removedAt: null,
        },
        include: { video: true },
        orderBy: { position: 'asc' },
      });
    });

    it('should continue on individual video failures', async () => {
      // Arrange
      mockDb.playlistItem.findMany.mockResolvedValue(mockPlaylistItems);
      mockDb.video.findUnique.mockResolvedValue(mockVideoRecord);
      mockDb.videoCaption.findUnique.mockResolvedValue(null);
      mockGetSubtitles
        .mockResolvedValueOnce(mockCaptionData) // video-1 success
        .mockRejectedValueOnce(new Error('Failed')) // video-2 fail
        .mockResolvedValueOnce(mockCaptionData); // video-3 success
      mockDb.videoCaption.create.mockResolvedValue(mockCaptionRecord);

      // Act
      const results = await extractor.extractPlaylistCaptions(mockPlaylistId);

      // Assert
      expect(results).toHaveLength(3);
      expect(results[0]!.success).toBe(true);
      expect(results[1]!.success).toBe(false);
      expect(results[2]!.success).toBe(true);
    });

    it('should respect language parameter', async () => {
      // Arrange
      const language = 'ko';
      mockDb.playlistItem.findMany.mockResolvedValue([mockPlaylistItems[0]!]);
      mockDb.video.findUnique.mockResolvedValue(mockVideoRecord);
      mockDb.videoCaption.findUnique.mockResolvedValue(null);
      mockGetSubtitles.mockResolvedValue(mockCaptionData);
      mockDb.videoCaption.create.mockResolvedValue(mockCaptionRecord);

      // Act
      await extractor.extractPlaylistCaptions(mockPlaylistId, language);

      // Assert
      expect(mockGetSubtitles).toHaveBeenCalledWith({
        videoID: 'video-1',
        lang: language,
      });
    });

    it('should handle empty playlist', async () => {
      // Arrange
      mockDb.playlistItem.findMany.mockResolvedValue([]);

      // Act
      const results = await extractor.extractPlaylistCaptions(mockPlaylistId);

      // Assert
      expect(results).toEqual([]);
    });
  });

  describe('Singleton Pattern', () => {
    it('should return same instance from getCaptionExtractor', () => {
      const { getCaptionExtractor } = require('../../../src/modules/caption/extractor');
      const instance1 = getCaptionExtractor();
      const instance2 = getCaptionExtractor();

      expect(instance1).toBe(instance2);
    });
  });
});
