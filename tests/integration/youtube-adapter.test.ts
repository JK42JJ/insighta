/**
 * YouTube Adapter Integration Test
 *
 * Tests YouTubeAdapter implementation against real YouTube API
 * to verify DataSourceAdapter interface compliance.
 *
 * @requires YOUTUBE_API_KEY environment variable
 */

import { YouTubeAdapter } from '../../src/adapters/YouTubeAdapter';
import { AdapterConfig } from '../../src/adapters/DataSourceAdapter';

describe('YouTubeAdapter Integration Tests', () => {
  let adapter: YouTubeAdapter;
  const API_KEY = process.env['YOUTUBE_API_KEY'] || process.env['GEMINI_API_KEY'];

  // Test playlist: YouTube Help channel playlist (well-known public playlist)
  const TEST_PLAYLIST_ID = 'PLBCF2DAC6FFB574DE';
  const TEST_PLAYLIST_URL = `https://www.youtube.com/playlist?list=${TEST_PLAYLIST_ID}`;

  // Test video: "YouTube API v3 Overview"
  const TEST_VIDEO_ID = 'ImtZ5yENzgE';
  const TEST_VIDEO_URL = `https://www.youtube.com/watch?v=${TEST_VIDEO_ID}`;

  beforeAll(() => {
    if (!API_KEY) {
      console.warn('⚠️  YOUTUBE_API_KEY or GEMINI_API_KEY not set. Integration tests will be skipped.');
    }
  });

  beforeEach(() => {
    adapter = new YouTubeAdapter();
  });

  afterEach(async () => {
    if (adapter) {
      await adapter.shutdown();
    }
  });

  describe('Adapter Metadata', () => {
    test('should have correct metadata', () => {
      expect(adapter.name).toBe('youtube');
      expect(adapter.version).toBe('1.0.0');
      expect(adapter.sourceType).toBe('youtube');
    });
  });

  describe('Lifecycle Management', () => {
    test('should initialize with API key', async () => {
      if (!API_KEY) {
        console.log('⏭️  Skipping: No API key');
        return;
      }

      const config: AdapterConfig = {
        sourceType: 'youtube',
        credentials: { apiKey: API_KEY },
        quotaLimit: 10000,
        cacheEnabled: true,
      };

      await expect(adapter.initialize(config)).resolves.not.toThrow();
    });

    test('should shutdown cleanly', async () => {
      await expect(adapter.shutdown()).resolves.not.toThrow();
    });
  });

  describe('URL Extraction', () => {
    test('should extract playlist ID from URL', () => {
      const id = adapter.extractCollectionId(TEST_PLAYLIST_URL);
      expect(id).toBe(TEST_PLAYLIST_ID);
    });

    test('should extract playlist ID from various URL formats', () => {
      const formats = [
        `https://youtube.com/playlist?list=${TEST_PLAYLIST_ID}`,
        `https://www.youtube.com/watch?v=xxx&list=${TEST_PLAYLIST_ID}`,
        TEST_PLAYLIST_ID, // Direct ID
      ];

      formats.forEach((url) => {
        const id = adapter.extractCollectionId(url);
        expect(id).toBe(TEST_PLAYLIST_ID);
      });
    });

    test('should extract video ID from URL', () => {
      const id = adapter.extractContentId(TEST_VIDEO_URL);
      expect(id).toBe(TEST_VIDEO_ID);
    });

    test('should extract video ID from various URL formats', () => {
      const formats = [
        `https://youtube.com/watch?v=${TEST_VIDEO_ID}`,
        `https://youtu.be/${TEST_VIDEO_ID}`,
        `https://youtube.com/embed/${TEST_VIDEO_ID}`,
        TEST_VIDEO_ID, // Direct ID
      ];

      formats.forEach((url) => {
        const id = adapter.extractContentId(url);
        expect(id).toBe(TEST_VIDEO_ID);
      });
    });

    test('should throw error for invalid playlist URL', () => {
      expect(() => adapter.extractCollectionId('invalid-url')).toThrow();
    });

    test('should throw error for invalid video URL', () => {
      expect(() => adapter.extractContentId('invalid-url')).toThrow();
    });
  });

  describe('Schema and Capabilities', () => {
    test('should return correct schema', () => {
      const schema = adapter.getSchema();

      expect(schema.sourceType).toBe('youtube');
      expect(schema.supportedContentTypes).toContain('video');
      expect(schema.supportedContentTypes).toContain('playlist');
      expect(schema.requiredFields).toContain('sourceId');
      expect(schema.requiredFields).toContain('title');
      expect(schema.optionalFields).toContain('duration');
      expect(schema.metadataFields).toHaveProperty('viewCount');
    });

    test('should return correct capabilities', () => {
      const capabilities = adapter.getCapabilities();

      expect(capabilities.supportsCollections).toBe(true);
      expect(capabilities.supportsDirectContent).toBe(true);
      expect(capabilities.hasQuotaLimit).toBe(true);
      expect(capabilities.quotaLimit).toBe(10000);
    });
  });

  describe('Collection Operations (requires API key)', () => {
    beforeEach(async () => {
      if (!API_KEY) return;

      await adapter.initialize({
        sourceType: 'youtube',
        credentials: { apiKey: API_KEY },
        quotaLimit: 10000,
      });
    });

    test('should fetch playlist metadata', async () => {
      if (!API_KEY) {
        console.log('⏭️  Skipping: No API key');
        return;
      }

      const collection = await adapter.fetchCollection(TEST_PLAYLIST_ID);

      expect(collection.sourceId).toBe(TEST_PLAYLIST_ID);
      expect(collection.sourceType).toBe('youtube');
      expect(collection.title).toBeTruthy();
      expect(collection.itemCount).toBeGreaterThan(0);
      expect(collection.sourceUrl).toContain(TEST_PLAYLIST_ID);
    });

    test('should fetch playlist items', async () => {
      if (!API_KEY) {
        console.log('⏭️  Skipping: No API key');
        return;
      }

      const result = await adapter.fetchCollectionItems(TEST_PLAYLIST_ID, { maxResults: 10 });

      expect(result.items).toBeDefined();
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items.length).toBeLessThanOrEqual(10);

      // Verify CollectionItem structure
      const firstItem = result.items[0];
      expect(firstItem?.sourceId).toBeTruthy();
      expect(firstItem?.sourceType).toBe('youtube');
      expect(firstItem?.position).toBe(0);
    });
  });

  describe('Content Operations (requires API key)', () => {
    beforeEach(async () => {
      if (!API_KEY) return;

      await adapter.initialize({
        sourceType: 'youtube',
        credentials: { apiKey: API_KEY },
        quotaLimit: 10000,
      });
    });

    test('should fetch single video', async () => {
      if (!API_KEY) {
        console.log('⏭️  Skipping: No API key');
        return;
      }

      const video = await adapter.fetchContentItem(TEST_VIDEO_ID);

      expect(video.sourceId).toBe(TEST_VIDEO_ID);
      expect(video.sourceType).toBe('youtube');
      expect(video.contentType).toBe('video');
      expect(video.title).toBeTruthy();
      expect(video.duration).toBeGreaterThan(0);
      expect(video.thumbnailUrls).toBeDefined();
      expect(video.metadata).toBeDefined();
      expect(video.metadata?.['viewCount']).toBeGreaterThan(0);
    });

    test('should fetch videos in batch', async () => {
      if (!API_KEY) {
        console.log('⏭️  Skipping: No API key');
        return;
      }

      const videoIds = [TEST_VIDEO_ID, 'jNQXAC9IVRw', 'y6120QOlsfU'];
      const videos = await adapter.fetchContentItemsBatch(videoIds);

      expect(videos).toBeDefined();
      expect(videos.length).toBeGreaterThan(0);
      expect(videos.length).toBeLessThanOrEqual(videoIds.length);

      // Verify ContentItem structure
      const firstVideo = videos[0];
      expect(firstVideo?.sourceType).toBe('youtube');
      expect(firstVideo?.contentType).toBe('video');
      expect(firstVideo?.title).toBeTruthy();
    });
  });

  describe('Health Check (requires API key)', () => {
    beforeEach(async () => {
      if (!API_KEY) return;

      await adapter.initialize({
        sourceType: 'youtube',
        credentials: { apiKey: API_KEY },
        quotaLimit: 10000,
      });
    });

    test('should return healthy status with valid credentials', async () => {
      if (!API_KEY) {
        console.log('⏭️  Skipping: No API key');
        return;
      }

      const health = await adapter.healthCheck();

      expect(health.healthy).toBe(true);
      expect(health.authenticated).toBe(true);
      expect(health.quotaRemaining).toBeLessThanOrEqual(10000);
      expect(health.lastChecked).toBeInstanceOf(Date);
    });
  });

  describe('Quota Tracking (requires API key)', () => {
    beforeEach(async () => {
      if (!API_KEY) return;

      await adapter.initialize({
        sourceType: 'youtube',
        credentials: { apiKey: API_KEY },
        quotaLimit: 10000,
      });
    });

    test('should track quota usage', async () => {
      if (!API_KEY) {
        console.log('⏭️  Skipping: No API key');
        return;
      }

      const initialQuota = await adapter.getQuotaUsage();
      expect(initialQuota.used).toBe(0);
      expect(initialQuota.limit).toBe(10000);
      expect(initialQuota.remaining).toBe(10000);

      // Perform operation that costs quota
      await adapter.fetchCollection(TEST_PLAYLIST_ID);

      const afterQuota = await adapter.getQuotaUsage();
      expect(afterQuota.used).toBeGreaterThan(0);
      expect(afterQuota.remaining).toBeLessThan(10000);
      expect(afterQuota.resetAt).toBeInstanceOf(Date);
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      if (!API_KEY) return;

      await adapter.initialize({
        sourceType: 'youtube',
        credentials: { apiKey: API_KEY },
        quotaLimit: 10000,
      });
    });

    test('should throw error when not initialized', async () => {
      const uninitializedAdapter = new YouTubeAdapter();

      await expect(uninitializedAdapter.fetchCollection(TEST_PLAYLIST_ID)).rejects.toThrow(
        'Adapter not initialized'
      );
    });

    test('should throw error for non-existent playlist', async () => {
      if (!API_KEY) {
        console.log('⏭️  Skipping: No API key');
        return;
      }

      const fakePlaylistId = 'PLxxxxxxxxxxxxxxxxx';
      await expect(adapter.fetchCollection(fakePlaylistId)).rejects.toThrow();
    });

    test('should throw error for non-existent video', async () => {
      if (!API_KEY) {
        console.log('⏭️  Skipping: No API key');
        return;
      }

      const fakeVideoId = 'xxxxxxxxxxx';
      await expect(adapter.fetchContentItem(fakeVideoId)).rejects.toThrow();
    });
  });
});
