/**
 * YouTube API Client
 *
 * Provides authenticated access to YouTube Data API v3 with:
 * - OAuth 2.0 authentication
 * - Rate limiting
 * - Error handling
 * - Response caching
 */

import { google, youtube_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { config } from '../config';
import { logger } from '../utils/logger';
import {
  YouTubeAPIError,
  QuotaExceededError,
  AuthenticationError,
  InvalidCredentialsError,
} from '../utils/errors';
import { retry } from '../utils/retry';
import { getCacheService, CacheService } from '../utils/cache';
import { getTokenManager, TokenManager, OAuthCredentials } from '../modules/auth/token-manager';

export type YouTube = youtube_v3.Youtube;

/**
 * Cache TTL configuration (in seconds)
 */
const CACHE_TTL = {
  PLAYLIST: 3600, // 1 hour
  PLAYLIST_ITEMS: 1800, // 30 minutes
  VIDEOS: 3600, // 1 hour
};

/**
 * YouTube API Client
 */
export class YouTubeClient {
  private youtube: YouTube | null = null;
  private oauth2Client: OAuth2Client | null = null;
  private cache: CacheService;
  private cacheEnabled: boolean;
  private tokenManager: TokenManager;

  constructor(cacheEnabled: boolean = true) {
    this.cacheEnabled = cacheEnabled;
    this.cache = getCacheService();
    this.tokenManager = getTokenManager({
      refreshBuffer: 5 * 60 * 1000, // 5 minutes
      autoRefresh: true,
    });
    this.initializeClient();
    this.initializeCache();
  }

  /**
   * Initialize cache
   */
  private async initializeCache(): Promise<void> {
    if (this.cacheEnabled) {
      await this.cache.initialize();
    }
  }

  /**
   * Initialize YouTube API client
   */
  private initializeClient(): void {
    if (config.youtube.clientId && config.youtube.clientSecret) {
      // OAuth 2.0 setup
      this.oauth2Client = new google.auth.OAuth2(
        config.youtube.clientId,
        config.youtube.clientSecret,
        config.youtube.redirectUri
      );

      this.youtube = google.youtube({
        version: 'v3',
        auth: this.oauth2Client,
      });
    } else if (config.youtube.apiKey) {
      // API Key setup
      this.youtube = google.youtube({
        version: 'v3',
        auth: config.youtube.apiKey,
      });
    } else {
      throw new AuthenticationError('YouTube API credentials not configured');
    }
  }

  /**
   * Set OAuth credentials
   */
  public setCredentials(credentials: { access_token?: string | null; refresh_token?: string | null; expiry_date?: number | null }): void {
    if (!this.oauth2Client) {
      throw new AuthenticationError('OAuth client not initialized');
    }

    const filteredCredentials: OAuthCredentials = {
      access_token: credentials.access_token ?? null,
      refresh_token: credentials.refresh_token ?? null,
      expiry_date: credentials.expiry_date ?? null,
    };

    this.oauth2Client.setCredentials(filteredCredentials);

    // Initialize TokenManager with OAuth client and credentials
    this.tokenManager.initialize(this.oauth2Client, filteredCredentials);

    logger.info('OAuth credentials set successfully', {
      hasAccessToken: !!filteredCredentials.access_token,
      hasRefreshToken: !!filteredCredentials.refresh_token,
      expiryDate: filteredCredentials.expiry_date,
    });
  }

  /**
   * Get OAuth authorization URL
   */
  public getAuthUrl(): string {
    if (!this.oauth2Client) {
      throw new AuthenticationError('OAuth client not initialized');
    }

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/youtube.readonly',
        'https://www.googleapis.com/auth/youtube.force-ssl',
      ],
    });
  }

  /**
   * Exchange authorization code for tokens
   */
  public async getTokensFromCode(code: string): Promise<{
    access_token?: string;
    refresh_token?: string;
    expiry_date?: number;
  }> {
    if (!this.oauth2Client) {
      throw new AuthenticationError('OAuth client not initialized');
    }

    try {
      const { tokens } = await this.oauth2Client.getToken(code);
      this.oauth2Client.setCredentials(tokens);

      // Initialize TokenManager with new credentials
      const credentials: OAuthCredentials = {
        access_token: tokens.access_token ?? null,
        refresh_token: tokens.refresh_token ?? null,
        expiry_date: tokens.expiry_date ?? null,
      };
      this.tokenManager.initialize(this.oauth2Client, credentials);

      logger.info('OAuth tokens obtained successfully', {
        hasAccessToken: !!tokens.access_token,
        hasRefreshToken: !!tokens.refresh_token,
        expiryDate: tokens.expiry_date,
      });

      // Filter out null values for type safety
      const filteredTokens: { access_token?: string; refresh_token?: string; expiry_date?: number } = {};
      if (tokens.access_token) filteredTokens.access_token = tokens.access_token;
      if (tokens.refresh_token) filteredTokens.refresh_token = tokens.refresh_token;
      if (tokens.expiry_date) filteredTokens.expiry_date = tokens.expiry_date;

      return filteredTokens;
    } catch (error) {
      logger.error('Failed to exchange authorization code', { error });
      throw new InvalidCredentialsError({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Refresh access token using TokenManager
   */
  public async refreshAccessToken(): Promise<void> {
    if (!this.oauth2Client) {
      throw new AuthenticationError('OAuth client not initialized');
    }

    try {
      // Use TokenManager for thread-safe refresh
      const credentials = await this.tokenManager.refreshToken();

      // Update OAuth client with new credentials
      this.oauth2Client.setCredentials(credentials);

      logger.info('Access token refreshed successfully via TokenManager', {
        expiryDate: credentials.expiry_date,
      });
    } catch (error) {
      logger.error('Failed to refresh access token', { error });
      throw error; // Re-throw TokenManager errors
    }
  }

  /**
   * Get valid access token with automatic refresh
   *
   * @returns Valid access token
   */
  public async getValidAccessToken(): Promise<string> {
    return this.tokenManager.getValidToken();
  }

  /**
   * Check if token needs refresh
   *
   * @returns true if token will expire soon
   */
  public needsTokenRefresh(): boolean {
    const validation = this.tokenManager.validateToken();
    return validation.needsRefresh;
  }

  /**
   * Ensure valid token before API call
   */
  private async ensureValidToken(): Promise<void> {
    if (!this.tokenManager.isInitialized()) {
      return; // Skip if using API key instead of OAuth
    }

    try {
      await this.tokenManager.getValidToken();
    } catch (error) {
      logger.warn('Failed to ensure valid token', { error });
      // Continue anyway - let the API call handle auth errors
    }
  }

  /**
   * Get playlist details
   */
  public async getPlaylist(playlistId: string, useCache: boolean = true): Promise<youtube_v3.Schema$Playlist> {
    const cacheKey = `playlist:${playlistId}`;

    // Check cache first
    if (this.cacheEnabled && useCache) {
      const cached = await this.cache.get<youtube_v3.Schema$Playlist>(cacheKey);
      if (cached) {
        logger.debug('Playlist fetched from cache', { playlistId });
        return cached;
      }
    }

    // Ensure valid token before API call
    await this.ensureValidToken();

    // Fetch from API
    const playlist = await retry(async () => {
      try {
        if (!this.youtube) {
          throw new AuthenticationError('YouTube client not initialized');
        }

        const response = await this.youtube.playlists.list({
          part: ['snippet', 'contentDetails', 'status'],
          id: [playlistId],
        });

        if (!response.data.items || response.data.items.length === 0) {
          throw new YouTubeAPIError(`Playlist not found: ${playlistId}`, 404);
        }

        logger.debug('Playlist fetched from API', { playlistId });
        return response.data.items[0]!;
      } catch (error) {
        // Handle 401 errors with token refresh retry
        if (this.isAuthError(error)) {
          logger.info('Auth error detected, attempting token refresh');
          await this.tokenManager.refreshToken();
          throw error; // Retry will happen via retry() wrapper
        }

        this.handleApiError(error);
        throw error; // TypeScript needs this
      }
    });

    // Cache the result
    if (this.cacheEnabled && useCache) {
      await this.cache.set(cacheKey, playlist, CACHE_TTL.PLAYLIST);
    }

    return playlist;
  }

  /**
   * Get playlist items with pagination
   */
  public async getPlaylistItems(
    playlistId: string,
    maxResults: number = 50,
    useCache: boolean = true
  ): Promise<youtube_v3.Schema$PlaylistItem[]> {
    const cacheKey = `playlist-items:${playlistId}:${maxResults}`;

    // Check cache first
    if (this.cacheEnabled && useCache) {
      const cached = await this.cache.get<youtube_v3.Schema$PlaylistItem[]>(cacheKey);
      if (cached) {
        logger.debug('Playlist items fetched from cache', { playlistId, count: cached.length });
        return cached;
      }
    }

    // Ensure valid token before API call
    await this.ensureValidToken();

    // Fetch from API
    const items: youtube_v3.Schema$PlaylistItem[] = [];
    let pageToken: string | undefined;

    do {
      const page = await retry(async () => {
        try {
          if (!this.youtube) {
            throw new AuthenticationError('YouTube client not initialized');
          }

          const response = await this.youtube.playlistItems.list({
            part: ['snippet', 'contentDetails', 'status'],
            playlistId,
            maxResults: Math.min(maxResults, 50),
            pageToken,
          });

          return response.data;
        } catch (error) {
          // Handle 401 errors with token refresh retry
          if (this.isAuthError(error)) {
            logger.info('Auth error detected, attempting token refresh');
            await this.tokenManager.refreshToken();
            throw error; // Retry will happen via retry() wrapper
          }

          this.handleApiError(error);
          throw error;
        }
      });

      if (page.items) {
        items.push(...page.items);
      }

      pageToken = page.nextPageToken ?? undefined;
    } while (pageToken && items.length < maxResults);

    const result = items.slice(0, maxResults);
    logger.debug('Playlist items fetched from API', { playlistId, count: result.length });

    // Cache the result
    if (this.cacheEnabled && useCache) {
      await this.cache.set(cacheKey, result, CACHE_TTL.PLAYLIST_ITEMS);
    }

    return result;
  }

  /**
   * Get video details in batch (up to 50 videos)
   */
  public async getVideos(videoIds: string[], useCache: boolean = true): Promise<youtube_v3.Schema$Video[]> {
    if (videoIds.length === 0) {
      return [];
    }

    const limitedIds = videoIds.slice(0, 50);
    const cacheKey = `videos:${limitedIds.sort().join(',')}`;

    // Check cache first
    if (this.cacheEnabled && useCache) {
      const cached = await this.cache.get<youtube_v3.Schema$Video[]>(cacheKey);
      if (cached) {
        logger.debug('Videos fetched from cache', { count: cached.length });
        return cached;
      }
    }

    // Ensure valid token before API call
    await this.ensureValidToken();

    // Fetch from API
    const videos = await retry(async () => {
      try {
        if (!this.youtube) {
          throw new AuthenticationError('YouTube client not initialized');
        }

        const response = await this.youtube.videos.list({
          part: ['snippet', 'contentDetails', 'statistics', 'status'],
          id: limitedIds,
        });

        logger.debug('Videos fetched from API', { count: response.data.items?.length ?? 0 });
        return response.data.items ?? [];
      } catch (error) {
        // Handle 401 errors with token refresh retry
        if (this.isAuthError(error)) {
          logger.info('Auth error detected, attempting token refresh');
          await this.tokenManager.refreshToken();
          throw error; // Retry will happen via retry() wrapper
        }

        this.handleApiError(error);
        throw error;
      }
    });

    // Cache the result
    if (this.cacheEnabled && useCache) {
      await this.cache.set(cacheKey, videos, CACHE_TTL.VIDEOS);
    }

    return videos;
  }

  /**
   * Get videos in batches
   */
  public async getVideosBatch(videoIds: string[]): Promise<youtube_v3.Schema$Video[]> {
    const batches: string[][] = [];
    for (let i = 0; i < videoIds.length; i += 50) {
      batches.push(videoIds.slice(i, i + 50));
    }

    const results = await Promise.all(batches.map(batch => this.getVideos(batch)));

    return results.flat();
  }

  /**
   * Check if error is an authentication error
   */
  private isAuthError(error: unknown): boolean {
    const err = error as any;
    const status = err?.response?.status ?? err?.code;
    return status === 401;
  }

  /**
   * Handle API errors
   */
  private handleApiError(error: unknown): never {
    if (error instanceof YouTubeAPIError) {
      throw error;
    }

    const err = error as any;
    const status = err?.response?.status ?? err?.code;
    const message = err?.message ?? 'Unknown YouTube API error';
    const errors = err?.response?.data?.error?.errors ?? [];

    logger.error('YouTube API error', {
      status,
      message,
      errors,
    });

    // Check for quota exceeded
    if (status === 403 && errors.some((e: any) => e.reason === 'quotaExceeded')) {
      throw new QuotaExceededError({ errors });
    }

    // Check for auth errors
    if (status === 401 || status === 403) {
      throw new AuthenticationError(message, { status, errors });
    }

    // Generic API error
    throw new YouTubeAPIError(message, status ?? 500, { errors });
  }
}

/**
 * Singleton instance
 */
let clientInstance: YouTubeClient | null = null;

/**
 * Get YouTube client instance
 */
export function getYouTubeClient(): YouTubeClient {
  if (!clientInstance) {
    clientInstance = new YouTubeClient();
  }
  return clientInstance;
}

export default getYouTubeClient;
