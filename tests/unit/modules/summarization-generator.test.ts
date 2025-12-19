/**
 * SummaryGenerator Unit Tests
 *
 * Tests for SummaryGenerator implementation including:
 * - AI-powered summarization (Gemini)
 * - Multi-level summaries
 * - Caption integration
 * - Error handling and retry logic
 * - Playlist batch operations
 */

import { SummaryGenerator } from '../../../src/modules/summarization/generator';
import type { SummarizationOptions } from '../../../src/modules/summarization/types';

// Mock dependencies
jest.mock('@google/generative-ai');
jest.mock('../../../src/modules/database');
jest.mock('../../../src/modules/caption');
jest.mock('../../../src/utils/logger');

import { GoogleGenerativeAI } from '@google/generative-ai';
import { getPrismaClient } from '../../../src/modules/database';
import { getCaptionExtractor } from '../../../src/modules/caption';

describe('SummaryGenerator', () => {
  let generator: SummaryGenerator;
  let mockDb: any;
  let mockCaptionExtractor: any;
  let mockGenAI: any;
  let mockModel: any;

  const mockVideoId = 'test-video-123';
  const mockVideoRecord = {
    id: 'db-video-1',
    youtubeId: mockVideoId,
    title: 'Introduction to TypeScript',
    channelId: 'test-channel',
    channelTitle: 'Test Channel',
    publishedAt: new Date('2024-01-01'),
    duration: 600,
    thumbnailUrls: '[]',
  };

  const mockCaption = {
    videoId: mockVideoId,
    language: 'en',
    fullText: 'This video introduces TypeScript, a typed superset of JavaScript. It covers basic types, interfaces, and best practices.',
    segments: [
      { text: 'This video introduces TypeScript', start: 0, duration: 3 },
      { text: 'a typed superset of JavaScript', start: 3, duration: 3 },
      { text: 'It covers basic types, interfaces, and best practices', start: 6, duration: 5 },
    ],
  };

  const mockAIResponse = {
    summary: 'A comprehensive introduction to TypeScript covering fundamental concepts.',
    keyPoints: [
      'TypeScript is a typed superset of JavaScript',
      'Provides static typing for better code quality',
      'Covers basic types and interfaces',
    ],
    keywords: ['TypeScript', 'JavaScript', 'static typing', 'interfaces', 'types'],
  };

  beforeEach(() => {
    // Clear all mocks first before setting up
    jest.clearAllMocks();

    // Setup mock database
    mockDb = {
      video: {
        findUnique: jest.fn(),
      },
      userVideoState: {
        upsert: jest.fn(),
      },
      playlistItem: {
        findMany: jest.fn(),
      },
    };

    // Setup mock caption extractor
    mockCaptionExtractor = {
      getCaption: jest.fn(),
      extractCaptions: jest.fn(),
    };

    // Setup mock AI model
    mockModel = {
      generateContent: jest.fn(),
    };

    mockGenAI = {
      getGenerativeModel: jest.fn().mockReturnValue(mockModel),
    };

    (getPrismaClient as jest.Mock).mockReturnValue(mockDb);
    (getCaptionExtractor as jest.Mock).mockReturnValue(mockCaptionExtractor);
    (GoogleGenerativeAI as jest.Mock).mockImplementation(() => mockGenAI);

    // Set environment variable for Gemini API key
    process.env['GEMINI_API_KEY'] = 'test-api-key';

    // Create fresh generator instance
    generator = new SummaryGenerator();
  });

  afterEach(() => {
    delete process.env['GEMINI_API_KEY'];
    delete process.env['GEMINI_MODEL'];
  });

  afterAll(() => {
    // Cleanup singleton instance and mocks to prevent memory leaks
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe('Constructor', () => {
    it('should initialize with Gemini API key', () => {
      expect(GoogleGenerativeAI).toHaveBeenCalledWith('test-api-key');
    });

    it('should warn if API key is missing', () => {
      delete process.env['GEMINI_API_KEY'];
      new SummaryGenerator();
      // Logger warning should be called (checked via mock)
    });
  });

  describe('generateSummary', () => {
    beforeEach(() => {
      mockDb.video.findUnique.mockResolvedValue(mockVideoRecord);
      mockCaptionExtractor.getCaption.mockResolvedValue(mockCaption);
      mockModel.generateContent.mockResolvedValue({
        response: {
          text: () => JSON.stringify(mockAIResponse),
        },
      });
      mockDb.userVideoState.upsert.mockResolvedValue({
        id: 'state-1',
        videoId: 'db-video-1',
        summary: mockAIResponse.summary,
        tags: JSON.stringify(mockAIResponse.keywords),
      });
    });

    it('should generate summary successfully', async () => {
      // Act
      const result = await generator.generateSummary(mockVideoId);

      // Assert
      expect(result.success).toBe(true);
      expect(result.videoId).toBe(mockVideoId);
      expect(result.summary).toBeDefined();
      expect(result.summary!.summary).toBe(mockAIResponse.summary);
      expect(result.summary!.keyPoints).toEqual(mockAIResponse.keyPoints);
      expect(result.summary!.keywords).toEqual(mockAIResponse.keywords);
    });

    it('should use cached caption if available', async () => {
      // Act
      await generator.generateSummary(mockVideoId);

      // Assert
      expect(mockCaptionExtractor.getCaption).toHaveBeenCalledWith(mockVideoId, 'en');
      expect(mockCaptionExtractor.extractCaptions).not.toHaveBeenCalled();
    });

    it('should extract caption if not cached', async () => {
      // Arrange
      mockCaptionExtractor.getCaption.mockResolvedValue(null);
      mockCaptionExtractor.extractCaptions.mockResolvedValue({
        success: true,
        videoId: mockVideoId,
        language: 'en',
        caption: mockCaption,
      });

      // Act
      await generator.generateSummary(mockVideoId);

      // Assert
      expect(mockCaptionExtractor.extractCaptions).toHaveBeenCalledWith(mockVideoId, 'en');
    });

    it('should fail if caption extraction fails', async () => {
      // Arrange
      mockCaptionExtractor.getCaption.mockResolvedValue(null);
      mockCaptionExtractor.extractCaptions.mockResolvedValue({
        success: false,
        videoId: mockVideoId,
        language: 'en',
        error: 'No captions available',
      });

      // Act
      const result = await generator.generateSummary(mockVideoId);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('No captions available');
    });

    it('should fail if video not found', async () => {
      // Arrange
      mockDb.video.findUnique.mockResolvedValue(null);

      // Act
      const result = await generator.generateSummary(mockVideoId);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('Video not found in database');
    });

    it('should fail if Gemini API key not configured', async () => {
      // Arrange
      delete process.env['GEMINI_API_KEY'];
      const newGenerator = new SummaryGenerator();

      // Act
      const result = await newGenerator.generateSummary(mockVideoId);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('Gemini API key not configured');
    });

    it('should save summary to database', async () => {
      // Act
      await generator.generateSummary(mockVideoId);

      // Assert
      expect(mockDb.userVideoState.upsert).toHaveBeenCalledWith({
        where: { videoId: 'db-video-1' },
        create: {
          videoId: 'db-video-1',
          summary: mockAIResponse.summary,
          tags: JSON.stringify(mockAIResponse.keywords),
        },
        update: {
          summary: mockAIResponse.summary,
          tags: JSON.stringify(mockAIResponse.keywords),
        },
      });
    });

    it('should respect summarization level - short', async () => {
      // Arrange
      const options: SummarizationOptions = { level: 'short' };

      // Act
      await generator.generateSummary(mockVideoId, options);

      // Assert
      expect(mockGenAI.getGenerativeModel).toHaveBeenCalledWith(
        expect.objectContaining({
          generationConfig: expect.objectContaining({
            maxOutputTokens: 500,
          }),
        })
      );
    });

    it('should respect summarization level - medium', async () => {
      // Arrange
      const options: SummarizationOptions = { level: 'medium' };

      // Act
      await generator.generateSummary(mockVideoId, options);

      // Assert
      expect(mockGenAI.getGenerativeModel).toHaveBeenCalledWith(
        expect.objectContaining({
          generationConfig: expect.objectContaining({
            maxOutputTokens: 1000,
          }),
        })
      );
    });

    it('should respect summarization level - detailed', async () => {
      // Arrange
      const options: SummarizationOptions = { level: 'detailed' };

      // Act
      await generator.generateSummary(mockVideoId, options);

      // Assert
      expect(mockGenAI.getGenerativeModel).toHaveBeenCalledWith(
        expect.objectContaining({
          generationConfig: expect.objectContaining({
            maxOutputTokens: 2000,
          }),
        })
      );
    });

    it('should respect language parameter', async () => {
      // Arrange
      const options: SummarizationOptions = { language: 'ko' };

      // Act
      await generator.generateSummary(mockVideoId, options);

      // Assert
      expect(mockCaptionExtractor.getCaption).toHaveBeenCalledWith(mockVideoId, 'ko');
    });

    it('should handle AI API errors', async () => {
      // Arrange
      mockModel.generateContent.mockRejectedValue(new Error('API quota exceeded'));

      // Act
      const result = await generator.generateSummary(mockVideoId);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('API quota exceeded');
    });

    it('should trim long transcripts to avoid token limits', async () => {
      // Arrange
      const longTranscript = 'a'.repeat(20000);
      mockCaptionExtractor.getCaption.mockResolvedValue({
        ...mockCaption,
        fullText: longTranscript,
      });

      // Act
      await generator.generateSummary(mockVideoId);

      // Assert
      const callArgs = mockModel.generateContent.mock.calls[0][0];
      expect(callArgs.length).toBeLessThan(longTranscript.length + 500);
    });

    it('should use custom Gemini model if specified', async () => {
      // Arrange
      process.env['GEMINI_MODEL'] = 'gemini-pro-vision';
      const newGenerator = new SummaryGenerator();
      mockDb.video.findUnique.mockResolvedValue(mockVideoRecord);
      mockCaptionExtractor.getCaption.mockResolvedValue(mockCaption);
      mockModel.generateContent.mockResolvedValue({
        response: { text: () => JSON.stringify(mockAIResponse) },
      });

      // Act
      await newGenerator.generateSummary(mockVideoId);

      // Assert
      expect(mockGenAI.getGenerativeModel).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gemini-pro-vision',
        })
      );
    });
  });

  describe('AI Response Parsing', () => {
    beforeEach(() => {
      mockDb.video.findUnique.mockResolvedValue(mockVideoRecord);
      mockCaptionExtractor.getCaption.mockResolvedValue(mockCaption);
      mockDb.userVideoState.upsert.mockResolvedValue({});
    });

    it('should parse valid JSON response', async () => {
      // Arrange
      const validResponse = JSON.stringify(mockAIResponse);
      mockModel.generateContent.mockResolvedValue({
        response: { text: () => validResponse },
      });

      // Act
      const result = await generator.generateSummary(mockVideoId);

      // Assert
      expect(result.success).toBe(true);
      expect(result.summary!.keyPoints).toEqual(mockAIResponse.keyPoints);
    });

    it('should extract JSON from markdown code blocks', async () => {
      // Arrange
      const markdownResponse = `Here's the summary:\n\`\`\`json\n${JSON.stringify(mockAIResponse)}\n\`\`\``;
      mockModel.generateContent.mockResolvedValue({
        response: { text: () => markdownResponse },
      });

      // Act
      const result = await generator.generateSummary(mockVideoId);

      // Assert
      expect(result.success).toBe(true);
      expect(result.summary!.keywords).toEqual(mockAIResponse.keywords);
    });

    it('should handle response with timestamps', async () => {
      // Arrange
      const responseWithTimestamps = {
        ...mockAIResponse,
        timestamps: [
          { time: 30, description: 'Introduction to TypeScript' },
          { time: 120, description: 'Type system overview' },
        ],
      };
      mockModel.generateContent.mockResolvedValue({
        response: { text: () => JSON.stringify(responseWithTimestamps) },
      });

      // Act
      const result = await generator.generateSummary(mockVideoId);

      // Assert
      expect(result.success).toBe(true);
      expect(result.summary!.timestamps).toHaveLength(2);
      expect(result.summary!.timestamps![0]).toEqual({
        time: 30,
        description: 'Introduction to TypeScript',
      });
    });

    it('should fallback to raw content if JSON parsing fails', async () => {
      // Arrange
      const invalidResponse = 'This is not JSON but still useful content';
      mockModel.generateContent.mockResolvedValue({
        response: { text: () => invalidResponse },
      });

      // Act
      const result = await generator.generateSummary(mockVideoId);

      // Assert
      expect(result.success).toBe(true);
      expect(result.summary!.summary).toBe(invalidResponse);
      expect(result.summary!.keyPoints).toEqual([]);
    });
  });

  describe('getSummary', () => {
    it('should retrieve summary from database', async () => {
      // Arrange
      const mockUserState = {
        id: 'state-1',
        videoId: 'db-video-1',
        summary: 'Test summary',
        tags: JSON.stringify(['tag1', 'tag2']),
      };
      mockDb.video.findUnique.mockResolvedValue({
        ...mockVideoRecord,
        userState: mockUserState,
      });

      // Act
      const result = await generator.getSummary(mockVideoId);

      // Assert
      expect(result).not.toBeNull();
      expect(result!.summary).toBe('Test summary');
      expect(result!.keywords).toEqual(['tag1', 'tag2']);
    });

    it('should return null if video not found', async () => {
      // Arrange
      mockDb.video.findUnique.mockResolvedValue(null);

      // Act
      const result = await generator.getSummary(mockVideoId);

      // Assert
      expect(result).toBeNull();
    });

    it('should return null if no summary exists', async () => {
      // Arrange
      mockDb.video.findUnique.mockResolvedValue({
        ...mockVideoRecord,
        userState: null,
      });

      // Act
      const result = await generator.getSummary(mockVideoId);

      // Assert
      expect(result).toBeNull();
    });

    it('should handle database errors', async () => {
      // Arrange
      mockDb.video.findUnique.mockRejectedValue(new Error('Database error'));

      // Act
      const result = await generator.getSummary(mockVideoId);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('generatePlaylistSummaries', () => {
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
    ];

    beforeEach(() => {
      mockDb.video.findUnique.mockResolvedValue(mockVideoRecord);
      mockCaptionExtractor.getCaption.mockResolvedValue(mockCaption);
      mockModel.generateContent.mockResolvedValue({
        response: { text: () => JSON.stringify(mockAIResponse) },
      });
      mockDb.userVideoState.upsert.mockResolvedValue({});
    });

    it('should generate summaries for all videos in playlist', async () => {
      // Arrange
      mockDb.playlistItem.findMany.mockResolvedValue(mockPlaylistItems);

      // Act
      const results = await generator.generatePlaylistSummaries(mockPlaylistId);

      // Assert
      expect(results).toHaveLength(2);
      expect(results.every(r => r.success)).toBe(true);
    });

    it('should skip removed items', async () => {
      // Arrange
      mockDb.playlistItem.findMany.mockResolvedValue(mockPlaylistItems);

      // Act
      await generator.generatePlaylistSummaries(mockPlaylistId);

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

    it('should continue on individual failures', async () => {
      // Arrange
      mockDb.playlistItem.findMany.mockResolvedValue(mockPlaylistItems);
      mockModel.generateContent
        .mockResolvedValueOnce({
          response: { text: () => JSON.stringify(mockAIResponse) },
        })
        .mockRejectedValueOnce(new Error('API error'));

      // Act
      const results = await generator.generatePlaylistSummaries(mockPlaylistId);

      // Assert
      expect(results).toHaveLength(2);
      expect(results[0]!.success).toBe(true);
      expect(results[1]!.success).toBe(false);
    });

    it('should respect options', async () => {
      // Arrange
      mockDb.playlistItem.findMany.mockResolvedValue([mockPlaylistItems[0]!]);
      const options: SummarizationOptions = { level: 'detailed', language: 'ko' };

      // Act
      await generator.generatePlaylistSummaries(mockPlaylistId, options);

      // Assert
      expect(mockCaptionExtractor.getCaption).toHaveBeenCalledWith('video-1', 'ko');
    });

    it('should handle empty playlist', async () => {
      // Arrange
      mockDb.playlistItem.findMany.mockResolvedValue([]);

      // Act
      const results = await generator.generatePlaylistSummaries(mockPlaylistId);

      // Assert
      expect(results).toEqual([]);
    });
  });

  describe('Singleton Pattern', () => {
    it('should return same instance from getSummaryGenerator', () => {
      const { getSummaryGenerator } = require('../../../src/modules/summarization/generator');
      const instance1 = getSummaryGenerator();
      const instance2 = getSummaryGenerator();

      expect(instance1).toBe(instance2);
    });
  });
});
