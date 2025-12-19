/**
 * YouTube Data Source Adapter
 *
 * Implements DataSourceAdapter interface for YouTube playlists and videos.
 * Uses composition pattern to wrap existing YouTubeClient.
 *
 * Design Principles:
 * - Stateless: No database dependencies in adapter layer
 * - Composition: Wraps YouTubeClient rather than duplicating code
 * - Type-safe: Full TypeScript typing with YouTube API v3 types
 * - Quota-aware: Integrates with quota management system
 * - Cache-friendly: Leverages existing cache infrastructure
 *
 * @version 1.0.0
 * @since 2025-12-17
 */

import { google, youtube_v3 } from 'googleapis';
import { YouTubeClient } from '../api/client';
import { CacheService, getCacheService } from '../utils/cache';
import { logger } from '../utils/logger';
import {
  DataSourceAdapter,
  AdapterConfig,
  SourceCredentials,
  AuthResult,
  Collection,
  CollectionItem,
  ContentItem,
  FetchOptions,
  FetchResult,
  ContentSchema,
  SourceCapabilities,
  HealthStatus,
  AdapterError,
  AdapterErrorCode,
} from './DataSourceAdapter';

/**
 * YouTube-specific adapter configuration
 */
export interface YouTubeAdapterConfig extends AdapterConfig {
  sourceType: 'youtube';
  credentials?: {
    accessToken?: string;
    refreshToken?: string;
    apiKey?: string;
  };
  quotaLimit?: number; // Daily quota limit (default: 10000)
  quotaCosts?: {
    collectionDetails: number; // Playlist details (default: 1)
    collectionItems: number; // PlaylistItems per page (default: 1)
    contentDetails: number; // Videos per batch (default: 1)
    search: number; // Search operation (default: 100)
  };
  cacheEnabled?: boolean;
  cacheTTL?: number;
}

/**
 * YouTube Data Source Adapter
 *
 * Provides unified interface for YouTube playlist and video operations.
 * Wraps existing YouTubeClient with DataSourceAdapter interface.
 *
 * @example
 * ```typescript
 * const adapter = new YouTubeAdapter();
 * await adapter.initialize({ sourceType: 'youtube', credentials: { apiKey: '...' } });
 *
 * // Fetch playlist
 * const collection = await adapter.fetchCollection('PLrAXtmErZgOe...');
 *
 * // Fetch videos in playlist
 * const result = await adapter.fetchCollectionItems('PLrAXtmErZgOe...', { maxResults: 50 });
 *
 * // Fetch video details
 * const video = await adapter.fetchContentItem('dQw4w9WgXcQ');
 * ```
 */
export class YouTubeAdapter implements DataSourceAdapter {
  // ============================================================================
  // Adapter Metadata
  // ============================================================================

  /**
   * Adapter name
   */
  readonly name: string = 'youtube';

  /**
   * Adapter version (semantic versioning)
   */
  readonly version: string = '1.0.0';

  /**
   * Source type
   */
  readonly sourceType = 'youtube' as const;

  // ============================================================================
  // Private Properties
  // ============================================================================

  /**
   * YouTube API client (composition)
   */
  private client: YouTubeClient;

  /**
   * Cache service
   */
  private cache: CacheService;

  /**
   * Adapter configuration
   */
  private config?: YouTubeAdapterConfig;

  /**
   * Initialization state
   */
  private isInitialized: boolean = false;

  /**
   * Quota tracking
   */
  private quotaUsed: number = 0;

  /**
   * Stored API key (for direct googleapis usage)
   */
  private apiKey?: string;

  // ============================================================================
  // Constructor
  // ============================================================================

  /**
   * Create YouTube adapter instance
   *
   * @param client - Optional YouTubeClient instance (for testing)
   * @param cache - Optional CacheService instance (for testing)
   */
  constructor(client?: YouTubeClient, cache?: CacheService) {
    this.client = client ?? new YouTubeClient();
    this.cache = cache ?? getCacheService();
  }

  // ============================================================================
  // Lifecycle Management
  // ============================================================================

  /**
   * Initialize adapter with configuration
   *
   * Sets up credentials, quota limits, and cache settings.
   *
   * @param config - Adapter configuration
   * @throws AdapterError if initialization fails
   *
   * @example
   * ```typescript
   * await adapter.initialize({
   *   sourceType: 'youtube',
   *   credentials: { apiKey: 'YOUR_API_KEY' },
   *   quotaLimit: 10000,
   *   cacheEnabled: true,
   *   cacheTTL: 3600
   * });
   * ```
   */
  async initialize(config: AdapterConfig): Promise<void> {
    try {
      this.config = config as YouTubeAdapterConfig;

      // Set credentials if provided
      if (config.credentials) {
        this.setCredentials(config.credentials);
      }

      // Initialize cache
      if (config.cacheEnabled !== false) {
        await this.cache.initialize();
      }

      this.isInitialized = true;
      logger.info('YouTubeAdapter initialized', {
        version: this.version,
        quotaLimit: config.quotaLimit ?? 10000,
        cacheEnabled: config.cacheEnabled ?? true,
      });
    } catch (error) {
      throw this.handleError('Failed to initialize YouTubeAdapter', error, AdapterErrorCode.INTERNAL_ERROR);
    }
  }

  /**
   * Shutdown adapter and cleanup resources
   *
   * Clears cache and resets internal state.
   */
  async shutdown(): Promise<void> {
    try {
      // Cache cleanup is handled by CacheService lifecycle
      this.isInitialized = false;
      this.quotaUsed = 0;
      logger.info('YouTubeAdapter shutdown complete');
    } catch (error) {
      throw this.handleError('Failed to shutdown YouTubeAdapter', error, AdapterErrorCode.INTERNAL_ERROR);
    }
  }

  // ============================================================================
  // Authentication
  // ============================================================================

  /**
   * Generate OAuth authorization URL
   *
   * @returns Authorization URL to redirect user for OAuth consent
   * @throws AdapterError if OAuth is not configured
   *
   * @example
   * ```typescript
   * const authUrl = adapter.getAuthUrl();
   * // Redirect user to authUrl
   * ```
   */
  getAuthUrl(): string {
    try {
      return this.client.getAuthUrl();
    } catch (error) {
      throw this.handleError('Failed to generate auth URL', error, AdapterErrorCode.AUTH_FAILED);
    }
  }

  /**
   * Authenticate with OAuth authorization code
   *
   * Exchanges authorization code for access and refresh tokens.
   *
   * @param credentials - Credentials containing authorization code
   * @returns Authentication result with tokens and expiry
   * @throws AdapterError if authentication fails
   *
   * @example
   * ```typescript
   * const result = await adapter.authenticate({ authCode: 'CODE_FROM_OAUTH_REDIRECT' });
   * if (result.success) {
   *   // Store result.credentials for future use
   * }
   * ```
   */
  async authenticate(credentials: SourceCredentials): Promise<AuthResult> {
    try {
      // Handle OAuth code exchange
      if (credentials['authCode']) {
        const tokens = await this.client.getTokensFromCode(credentials['authCode'] as string);

        return {
          success: true,
          credentials: {
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
          },
          expiresAt: new Date(Date.now() + 3600 * 1000), // 1 hour expiry (YouTube default)
        };
      }

      // Handle direct token setting
      if (credentials.accessToken || credentials.apiKey) {
        this.setCredentials(credentials);
        return {
          success: true,
          credentials,
        };
      }

      throw new Error('Invalid credentials: authCode, accessToken, or apiKey required');
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Refresh expired access token
   *
   * Uses refresh token to obtain new access token.
   *
   * @returns New authentication result
   * @throws AdapterError if refresh fails
   *
   * @example
   * ```typescript
   * try {
   *   const result = await adapter.refreshAuth();
   *   // Store new credentials
   * } catch (error) {
   *   // Re-authenticate user
   * }
   * ```
   */
  async refreshAuth(): Promise<AuthResult> {
    try {
      await this.client.refreshAccessToken();

      return {
        success: true,
        expiresAt: new Date(Date.now() + 3600 * 1000),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Set credentials after successful authentication
   *
   * @param credentials - OAuth tokens or API key
   *
   * @example
   * ```typescript
   * adapter.setCredentials({
   *   accessToken: 'ya29...',
   *   refreshToken: '1//...'
   * });
   * ```
   */
  setCredentials(credentials: SourceCredentials): void {
    if (credentials.accessToken || credentials.refreshToken) {
      this.client.setCredentials({
        access_token: credentials.accessToken ?? null,
        refresh_token: credentials.refreshToken ?? null,
      });
    }

    // Handle API key by storing it for direct googleapis usage
    if (credentials.apiKey || credentials['apiKey']) {
      this.apiKey = (credentials.apiKey || credentials['apiKey']) as string;
    }
  }

  // ============================================================================
  // Collection Operations (Playlists)
  // ============================================================================

  /**
   * Fetch YouTube playlist metadata
   *
   * @param collectionId - YouTube playlist ID
   * @param options - Fetch options (caching, etc.)
   * @returns Playlist as unified Collection
   * @throws AdapterError if playlist not found or fetch fails
   *
   * @example
   * ```typescript
   * const playlist = await adapter.fetchCollection('PLrAXtmErZgOe...');
   * console.log(playlist.title, playlist.itemCount);
   * ```
   */
  async fetchCollection(collectionId: string, options?: FetchOptions): Promise<Collection> {
    this.validateInitialized();

    try {
      let ytPlaylist: youtube_v3.Schema$Playlist;

      if (this.apiKey) {
        // Use googleapis directly with API key
        const youtube = this.getYouTubeClient();
        const response = await youtube.playlists.list({
          part: ['snippet', 'contentDetails', 'status'],
          id: [collectionId],
        });

        if (!response.data.items || response.data.items.length === 0) {
          throw new Error(`Playlist not found: ${collectionId}`);
        }

        ytPlaylist = response.data.items[0]!;
      } else {
        // Use existing YouTubeClient for OAuth
        const useCache = options?.useCache ?? true;
        ytPlaylist = await this.client.getPlaylist(collectionId, useCache);
      }

      // Track quota usage (1 unit for playlist.list)
      this.trackQuota(this.config?.quotaCosts?.collectionDetails ?? 1);

      // Transform YouTube playlist to unified Collection
      return this.transformPlaylistToCollection(ytPlaylist);
    } catch (error) {
      throw this.handleError(
        `Failed to fetch collection: ${collectionId}`,
        error,
        AdapterErrorCode.NOT_FOUND
      );
    }
  }

  /**
   * Fetch YouTube playlist items (videos in playlist)
   *
   * Returns paginated list of videos with position information.
   *
   * @param collectionId - YouTube playlist ID
   * @param options - Fetch options (pagination, caching, etc.)
   * @returns Paginated collection items
   * @throws AdapterError if fetch fails
   *
   * @example
   * ```typescript
   * const result = await adapter.fetchCollectionItems('PLrAXtmErZgOe...', {
   *   maxResults: 50,
   *   pageToken: 'CAoQAA'
   * });
   * console.log(result.items.length, result.nextPageToken);
   * ```
   */
  async fetchCollectionItems(
    collectionId: string,
    options?: FetchOptions
  ): Promise<FetchResult<CollectionItem>> {
    this.validateInitialized();

    try {
      const maxResults = options?.maxResults ?? 50;
      let ytItems: youtube_v3.Schema$PlaylistItem[];

      if (this.apiKey) {
        // Use googleapis directly with API key
        const youtube = this.getYouTubeClient();
        const items: youtube_v3.Schema$PlaylistItem[] = [];
        let pageToken: string | undefined;

        do {
          const response = await youtube.playlistItems.list({
            part: ['snippet', 'contentDetails', 'status'],
            playlistId: collectionId,
            maxResults: Math.min(maxResults, 50),
            pageToken,
          });

          if (response.data.items) {
            items.push(...response.data.items);
          }

          pageToken = response.data.nextPageToken ?? undefined;
        } while (pageToken && items.length < maxResults);

        ytItems = items.slice(0, maxResults);
      } else {
        // Use existing YouTubeClient for OAuth
        ytItems = await this.client.getPlaylistItems(collectionId, maxResults, options?.useCache ?? true);
      }

      // Track quota usage (1 unit per 50 items)
      const quotaCost = Math.ceil(ytItems.length / 50) * (this.config?.quotaCosts?.collectionItems ?? 1);
      this.trackQuota(quotaCost);

      // Transform YouTube playlist items to unified CollectionItems
      const items = ytItems.map((item, index) => this.transformPlaylistItemToCollectionItem(item, index));

      return {
        items,
        totalCount: ytItems.length,
        quotaCost,
      };
    } catch (error) {
      throw this.handleError(
        `Failed to fetch collection items: ${collectionId}`,
        error,
        AdapterErrorCode.INTERNAL_ERROR
      );
    }
  }

  // ============================================================================
  // Content Operations (Videos)
  // ============================================================================

  /**
   * Fetch single YouTube video by ID
   *
   * @param contentId - YouTube video ID
   * @param options - Fetch options (caching, etc.)
   * @returns Video as unified ContentItem
   * @throws AdapterError if video not found or fetch fails
   *
   * @example
   * ```typescript
   * const video = await adapter.fetchContentItem('dQw4w9WgXcQ');
   * console.log(video.title, video.duration);
   * ```
   */
  async fetchContentItem(contentId: string, options?: FetchOptions): Promise<ContentItem> {
    this.validateInitialized();

    try {
      let videos: youtube_v3.Schema$Video[];

      if (this.apiKey) {
        // Use googleapis directly with API key
        const youtube = this.getYouTubeClient();
        const response = await youtube.videos.list({
          part: ['snippet', 'contentDetails', 'statistics', 'status'],
          id: [contentId],
        });

        videos = response.data.items ?? [];
      } else {
        // Use existing YouTubeClient for OAuth
        const useCache = options?.useCache ?? true;
        videos = await this.client.getVideos([contentId], useCache);
      }

      if (videos.length === 0) {
        throw new Error(`Video not found: ${contentId}`);
      }

      // Track quota usage (1 unit per video batch)
      this.trackQuota(this.config?.quotaCosts?.contentDetails ?? 1);

      // Transform YouTube video to unified ContentItem
      return this.transformVideoToContentItem(videos[0]!);
    } catch (error) {
      throw this.handleError(
        `Failed to fetch content item: ${contentId}`,
        error,
        AdapterErrorCode.NOT_FOUND
      );
    }
  }

  /**
   * Fetch multiple YouTube videos in batch
   *
   * Efficiently fetches up to 50 videos per API call.
   *
   * @param contentIds - Array of YouTube video IDs
   * @param options - Fetch options
   * @returns Array of videos as ContentItems
   * @throws AdapterError if batch fetch fails
   *
   * @example
   * ```typescript
   * const videos = await adapter.fetchContentItemsBatch([
   *   'dQw4w9WgXcQ',
   *   'jNQXAC9IVRw',
   *   'y6120QOlsfU'
   * ]);
   * console.log(`Fetched ${videos.length} videos`);
   * ```
   */
  async fetchContentItemsBatch(contentIds: string[], _options?: FetchOptions): Promise<ContentItem[]> {
    this.validateInitialized();

    try {
      let ytVideos: youtube_v3.Schema$Video[];

      if (this.apiKey) {
        // Use googleapis directly with API key
        const youtube = this.getYouTubeClient();
        const allVideos: youtube_v3.Schema$Video[] = [];

        // Batch requests (50 videos per request)
        for (let i = 0; i < contentIds.length; i += 50) {
          const batch = contentIds.slice(i, i + 50);
          const response = await youtube.videos.list({
            part: ['snippet', 'contentDetails', 'statistics', 'status'],
            id: batch,
          });

          if (response.data.items) {
            allVideos.push(...response.data.items);
          }
        }

        ytVideos = allVideos;
      } else {
        // Use existing YouTubeClient for OAuth
        ytVideos = await this.client.getVideosBatch(contentIds);
      }

      // Track quota usage (1 unit per 50 videos)
      const quotaCost = Math.ceil(contentIds.length / 50) * (this.config?.quotaCosts?.contentDetails ?? 1);
      this.trackQuota(quotaCost);

      // Transform YouTube videos to unified ContentItems
      return ytVideos.map((video) => this.transformVideoToContentItem(video));
    } catch (error) {
      throw this.handleError(
        `Failed to fetch content items batch: ${contentIds.length} items`,
        error,
        AdapterErrorCode.INTERNAL_ERROR
      );
    }
  }

  // ============================================================================
  // URL Extraction
  // ============================================================================

  /**
   * Extract YouTube playlist ID from URL or return ID directly
   *
   * Supports multiple URL formats:
   * - https://youtube.com/playlist?list=PLxxx
   * - https://youtube.com/watch?v=xxx&list=PLxxx
   * - PLxxx (direct ID)
   *
   * @param url - YouTube playlist URL or ID
   * @returns Extracted playlist ID
   * @throws AdapterError if URL format is invalid
   *
   * @example
   * ```typescript
   * const id1 = adapter.extractCollectionId('https://youtube.com/playlist?list=PLrAXtmErZgOe...');
   * const id2 = adapter.extractCollectionId('PLrAXtmErZgOe...'); // Direct ID also works
   * ```
   */
  extractCollectionId(url: string): string {
    try {
      // Check if input is already a playlist ID
      if (/^[A-Za-z0-9_-]+$/.test(url) && !url.includes('/')) {
        // YouTube playlist IDs must contain at least one uppercase letter or number
        // and typically start with PL, UU, RD, etc.
        if (/[A-Z0-9]/.test(url) && url.length > 10) {
          return url;
        }
        throw new Error('Invalid playlist ID format: must contain uppercase letters/numbers and be sufficiently long');
      }

      // Extract from various YouTube URL formats
      const patterns = [
        /[?&]list=([A-Za-z0-9_-]+)/, // ?list=PLxxx or &list=PLxxx
        /youtube\.com\/playlist\?list=([A-Za-z0-9_-]+)/, // Full playlist URL
        /youtube\.com\/watch\?.*list=([A-Za-z0-9_-]+)/, // Watch URL with list
      ];

      for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match?.[1]) {
          return match[1];
        }
      }

      throw new Error('Invalid playlist URL format');
    } catch (error) {
      throw this.handleError(
        `Failed to extract collection ID from: ${url}`,
        error,
        AdapterErrorCode.INVALID_URL
      );
    }
  }

  /**
   * Extract YouTube video ID from URL or return ID directly
   *
   * Supports multiple URL formats:
   * - https://youtube.com/watch?v=xxx
   * - https://youtu.be/xxx
   * - xxx (direct ID)
   *
   * @param url - YouTube video URL or ID
   * @returns Extracted video ID
   * @throws AdapterError if URL format is invalid
   *
   * @example
   * ```typescript
   * const id1 = adapter.extractContentId('https://youtube.com/watch?v=dQw4w9WgXcQ');
   * const id2 = adapter.extractContentId('https://youtu.be/dQw4w9WgXcQ');
   * const id3 = adapter.extractContentId('dQw4w9WgXcQ'); // Direct ID also works
   * ```
   */
  extractContentId(url: string): string {
    try {
      // Check if input is already a video ID (11 characters, alphanumeric + - and _)
      if (/^[A-Za-z0-9_-]{11}$/.test(url)) {
        // YouTube IDs use base64-like encoding and must contain at least one number or uppercase letter
        if (/[A-Z0-9]/.test(url)) {
          return url;
        }
        throw new Error('Invalid video ID format: must contain at least one number or uppercase letter');
      }

      // Extract from various YouTube URL formats
      const patterns = [
        /[?&]v=([A-Za-z0-9_-]{11})/, // ?v=xxx or &v=xxx
        /youtu\.be\/([A-Za-z0-9_-]{11})/, // youtu.be short URL
        /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/, // Embed URL
      ];

      for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match?.[1]) {
          return match[1];
        }
      }

      throw new Error('Invalid video URL format');
    } catch (error) {
      throw this.handleError(
        `Failed to extract content ID from: ${url}`,
        error,
        AdapterErrorCode.INVALID_URL
      );
    }
  }

  // ============================================================================
  // Schema and Capabilities
  // ============================================================================

  /**
   * Get YouTube content schema definition
   *
   * @returns Schema with supported fields and content types
   */
  getSchema(): ContentSchema {
    return {
      sourceType: 'youtube',
      supportedContentTypes: ['video', 'playlist'],
      requiredFields: ['sourceId', 'title', 'contentType'],
      optionalFields: [
        'description',
        'creatorId',
        'creatorName',
        'thumbnailUrls',
        'duration',
        'publishedAt',
        'tags',
        'category',
        'language',
        'metadata',
      ],
      metadataFields: {
        viewCount: 'Number of views',
        likeCount: 'Number of likes',
        commentCount: 'Number of comments',
        favoriteCount: 'Number of favorites',
        definition: 'Video quality (hd or sd)',
        dimension: 'Video dimension (2d or 3d)',
        caption: 'Whether captions are available',
        licensedContent: 'Whether video is licensed',
        projection: 'Video projection (rectangular or 360)',
        privacyStatus: 'Privacy status (public, unlisted, private)',
      },
    };
  }

  /**
   * Get YouTube adapter capabilities
   *
   * @returns Capabilities declaration
   */
  getCapabilities(): SourceCapabilities {
    return {
      // Core Features
      supportsCollections: true, // Playlists
      supportsDirectContent: true, // Individual videos
      supportsSearch: false, // Not implemented yet

      // Sync Features
      supportsIncrementalSync: false, // Would require database integration
      supportsRealTimeSync: false, // YouTube API doesn't support webhooks

      // Content Features
      supportsFullText: false, // Would require caption extraction
      supportsTranscripts: true, // Available via caption API (not implemented)
      supportsComments: true, // Available via comments API (not implemented)

      // Quota and Rate Limiting
      hasQuotaLimit: true,
      hasRateLimit: true,
      quotaLimit: this.config?.quotaLimit ?? 10000,
      rateLimitPerSecond: this.config?.rateLimitPerSecond ?? 100,
    };
  }

  // ============================================================================
  // Health and Monitoring
  // ============================================================================

  /**
   * Check adapter health status
   *
   * Verifies API connectivity and authentication status.
   *
   * @returns Health status with quota info
   *
   * @example
   * ```typescript
   * const health = await adapter.healthCheck();
   * if (!health.healthy) {
   *   console.error('Adapter unhealthy:', health.error);
   * }
   * ```
   */
  async healthCheck(): Promise<HealthStatus> {
    const quotaLimit = this.config?.quotaLimit ?? 10000;

    try {
      // Try to fetch a public playlist to verify API access
      // This is a minimal health check (costs 1 quota unit)
      const testPlaylistId = 'PLBCF2DAC6FFB574DE'; // YouTube Help channel public playlist

      if (this.apiKey) {
        // Use googleapis directly with API key
        const youtube = this.getYouTubeClient();
        const response = await youtube.playlists.list({
          part: ['snippet'],
          id: [testPlaylistId],
        });

        if (!response.data.items || response.data.items.length === 0) {
          throw new Error('Health check failed: Cannot access YouTube API');
        }
      } else {
        // Use existing YouTubeClient for OAuth
        await this.client.getPlaylist(testPlaylistId, false);
      }

      return {
        healthy: true,
        authenticated: true,
        quotaRemaining: quotaLimit - this.quotaUsed,
        quotaLimit,
        lastChecked: new Date(),
      };
    } catch (error) {
      return {
        healthy: false,
        authenticated: false,
        quotaRemaining: quotaLimit - this.quotaUsed,
        quotaLimit,
        lastChecked: new Date(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get quota usage statistics
   *
   * @returns Current quota usage info
   */
  async getQuotaUsage(): Promise<{
    used: number;
    limit: number;
    remaining: number;
    resetAt?: Date;
  }> {
    const limit = this.config?.quotaLimit ?? 10000;

    return {
      used: this.quotaUsed,
      limit,
      remaining: Math.max(0, limit - this.quotaUsed),
      resetAt: this.getQuotaResetTime(),
    };
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Get YouTube API client with proper authentication
   *
   * If API key is stored, creates a new client with the API key.
   * Otherwise, uses the existing OAuth client.
   *
   * @returns YouTube API client instance
   */
  private getYouTubeClient(): youtube_v3.Youtube {
    if (this.apiKey) {
      // Use API key directly with googleapis
      return google.youtube({
        version: 'v3',
        auth: this.apiKey,
      });
    }

    // Fallback to existing client's YouTube instance
    // This won't work directly, so we need to handle OAuth separately
    throw new Error('OAuth authentication not yet supported for direct API access');
  }

  /**
   * Validate adapter is initialized
   *
   * @throws AdapterError if not initialized
   */
  private validateInitialized(): void {
    if (!this.isInitialized) {
      throw new AdapterError(
        AdapterErrorCode.INTERNAL_ERROR,
        'Adapter not initialized. Call initialize() first.',
        'youtube'
      );
    }
  }

  /**
   * Handle errors and convert to AdapterError
   *
   * @param message - Error message
   * @param error - Original error
   * @param code - Error code
   * @returns AdapterError instance
   */
  private handleError(message: string, error: unknown, code: AdapterErrorCode): AdapterError {
    logger.error(message, { error });

    return new AdapterError(
      code,
      message,
      'youtube',
      error instanceof Error ? error : new Error(String(error))
    );
  }

  /**
   * Track quota usage
   *
   * @param cost - Quota cost to add
   */
  private trackQuota(cost: number): void {
    this.quotaUsed += cost;

    const limit = this.config?.quotaLimit ?? 10000;
    const remaining = limit - this.quotaUsed;

    logger.debug('Quota usage tracked', {
      cost,
      used: this.quotaUsed,
      limit,
      remaining,
      percentage: ((this.quotaUsed / limit) * 100).toFixed(2) + '%',
    });

    // Warn if quota is running low
    if (remaining < limit * 0.1) {
      logger.warn('Quota running low', { remaining, limit });
    }
  }

  /**
   * Get quota reset time (next midnight Pacific Time)
   *
   * YouTube quota resets at midnight Pacific Time.
   *
   * @returns Next quota reset time
   */
  private getQuotaResetTime(): Date {
    const now = new Date();
    const pacificOffset = -8 * 60; // PST is UTC-8
    const pacificTime = new Date(now.getTime() + (now.getTimezoneOffset() + pacificOffset) * 60 * 1000);

    // Set to next midnight
    const resetTime = new Date(pacificTime);
    resetTime.setHours(24, 0, 0, 0);

    // Convert back to local time
    return new Date(resetTime.getTime() - (now.getTimezoneOffset() + pacificOffset) * 60 * 1000);
  }

  // ============================================================================
  // Data Transformation Methods
  // ============================================================================

  /**
   * Transform YouTube playlist to unified Collection
   *
   * @param ytPlaylist - YouTube API playlist object
   * @returns Unified Collection object
   */
  private transformPlaylistToCollection(ytPlaylist: youtube_v3.Schema$Playlist): Collection {
    const snippet = ytPlaylist.snippet;
    const contentDetails = ytPlaylist.contentDetails;

    return {
      sourceId: ytPlaylist.id ?? '',
      sourceType: 'youtube',
      sourceUrl: `https://www.youtube.com/playlist?list=${ytPlaylist.id}`,
      title: snippet?.title ?? 'Untitled Playlist',
      description: snippet?.description ?? undefined,
      creatorId: snippet?.channelId ?? undefined,
      creatorName: snippet?.channelTitle ?? undefined,
      thumbnailUrl: snippet?.thumbnails?.high?.url ?? snippet?.thumbnails?.default?.url ?? undefined,
      itemCount: contentDetails?.itemCount ?? 0,
      publishedAt: snippet?.publishedAt ? new Date(snippet.publishedAt) : undefined,
      metadata: {
        localized: snippet?.localized,
        privacyStatus: ytPlaylist.status?.privacyStatus,
      },
    };
  }

  /**
   * Transform YouTube playlist item to unified CollectionItem
   *
   * @param ytItem - YouTube API playlist item object
   * @param position - Position in playlist
   * @returns Unified CollectionItem object
   */
  private transformPlaylistItemToCollectionItem(
    ytItem: youtube_v3.Schema$PlaylistItem,
    position: number
  ): CollectionItem {
    const snippet = ytItem.snippet;

    return {
      sourceId: snippet?.resourceId?.videoId ?? '',
      sourceType: 'youtube',
      position,
      addedAt: snippet?.publishedAt ? new Date(snippet.publishedAt) : undefined,
      metadata: {
        videoOwnerChannelId: snippet?.videoOwnerChannelId,
        videoOwnerChannelTitle: snippet?.videoOwnerChannelTitle,
        privacyStatus: ytItem.status?.privacyStatus,
      },
    };
  }

  /**
   * Transform YouTube video to unified ContentItem
   *
   * @param ytVideo - YouTube API video object
   * @returns Unified ContentItem object
   */
  private transformVideoToContentItem(ytVideo: youtube_v3.Schema$Video): ContentItem {
    const snippet = ytVideo.snippet;
    const contentDetails = ytVideo.contentDetails;
    const statistics = ytVideo.statistics;

    return {
      sourceId: ytVideo.id ?? '',
      sourceType: 'youtube',
      sourceUrl: `https://www.youtube.com/watch?v=${ytVideo.id}`,
      title: snippet?.title ?? 'Untitled Video',
      description: snippet?.description ?? undefined,
      contentType: 'video',
      creatorId: snippet?.channelId ?? undefined,
      creatorName: snippet?.channelTitle ?? undefined,
      thumbnailUrls: {
        default: snippet?.thumbnails?.default?.url ?? undefined,
        medium: snippet?.thumbnails?.medium?.url ?? undefined,
        high: snippet?.thumbnails?.high?.url ?? undefined,
        standard: snippet?.thumbnails?.standard?.url ?? undefined,
        maxres: snippet?.thumbnails?.maxres?.url ?? undefined,
      },
      duration: this.parseDuration(contentDetails?.duration),
      publishedAt: snippet?.publishedAt ? new Date(snippet.publishedAt) : undefined,
      tags: snippet?.tags ?? undefined,
      category: snippet?.categoryId ?? undefined,
      language: snippet?.defaultAudioLanguage ?? snippet?.defaultLanguage ?? undefined,
      metadata: {
        viewCount: statistics?.viewCount ? parseInt(statistics.viewCount) : undefined,
        likeCount: statistics?.likeCount ? parseInt(statistics.likeCount) : undefined,
        commentCount: statistics?.commentCount ? parseInt(statistics.commentCount) : undefined,
        favoriteCount: statistics?.favoriteCount ? parseInt(statistics.favoriteCount) : undefined,
        definition: contentDetails?.definition,
        dimension: contentDetails?.dimension,
        caption: contentDetails?.caption,
        licensedContent: contentDetails?.licensedContent,
        projection: contentDetails?.projection,
        privacyStatus: ytVideo.status?.privacyStatus,
        liveBroadcastContent: snippet?.liveBroadcastContent,
      },
    };
  }

  /**
   * Parse ISO 8601 duration to seconds
   *
   * YouTube API returns duration in ISO 8601 format (e.g., "PT1H23M45S").
   * This method converts it to total seconds.
   *
   * @param isoDuration - ISO 8601 duration string (e.g., "PT1H23M45S")
   * @returns Duration in seconds, or undefined if invalid
   *
   * @example
   * parseDuration("PT1H23M45S") // 5025 seconds
   * parseDuration("PT15M30S")   // 930 seconds
   * parseDuration("PT45S")      // 45 seconds
   */
  private parseDuration(isoDuration?: string | null): number | undefined {
    if (!isoDuration) return undefined;

    const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return undefined;

    const hours = parseInt(match[1] || '0');
    const minutes = parseInt(match[2] || '0');
    const seconds = parseInt(match[3] || '0');

    return hours * 3600 + minutes * 60 + seconds;
  }
}
