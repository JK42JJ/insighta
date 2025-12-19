/**
 * CLI API Client
 *
 * HTTP client for communicating with the REST API server
 */

export interface ApiClientConfig {
  baseUrl: string;
  accessToken?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface ImportPlaylistRequest {
  playlistUrl: string;
}

export interface ListPlaylistsQuery {
  filter?: string;
  sortBy?: 'title' | 'lastSyncedAt' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface PlaylistResponse {
  id: string;
  youtubeId: string;
  title: string;
  description: string | null;
  channelId: string;
  channelTitle: string;
  thumbnailUrl: string | null;
  itemCount: number;
  syncStatus: string;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistWithItemsResponse extends PlaylistResponse {
  items: Array<{
    id: string;
    position: number;
    addedAt: string;
    video: {
      id: string;
      youtubeId: string;
      title: string;
      description: string | null;
      channelTitle: string;
      duration: number;
      thumbnailUrls: string;
      viewCount: number;
      publishedAt: string;
    };
  }>;
}

export interface ListPlaylistsResponse {
  playlists: PlaylistResponse[];
  total: number;
  limit?: number;
  offset?: number;
}

export interface SyncResultResponse {
  playlistId: string;
  status: string;
  itemsAdded: number;
  itemsRemoved: number;
  itemsReordered: number;
  duration: number;
  quotaUsed: number;
  error?: string;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    timestamp: string;
    path: string;
    details?: Record<string, unknown>;
  };
}

export class ApiClient {
  private config: ApiClientConfig;

  constructor(config: ApiClientConfig) {
    this.config = config;
  }

  /**
   * Set access token for authenticated requests
   */
  setAccessToken(token: string): void {
    this.config.accessToken = token;
  }

  /**
   * Clear access token
   */
  clearAccessToken(): void {
    this.config.accessToken = undefined;
  }

  /**
   * Make HTTP request to API
   */
  private async request<T>(
    method: string,
    path: string,
    options?: {
      body?: unknown;
      query?: Record<string, string | number | undefined>;
      headers?: Record<string, string>;
    }
  ): Promise<T> {
    const url = new URL(path, this.config.baseUrl);

    // Add query parameters
    if (options?.query) {
      Object.entries(options.query).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    // Prepare headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options?.headers,
    };

    // Add authorization header if token is available
    if (this.config.accessToken) {
      headers['Authorization'] = `Bearer ${this.config.accessToken}`;
    }

    // Make request
    const response = await fetch(url.toString(), {
      method,
      headers,
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    // Parse response
    const data = await response.json();

    // Handle errors
    if (!response.ok) {
      const apiError = data as ApiError;
      throw new ApiClientError(
        apiError.error.message,
        apiError.error.code,
        response.status,
        apiError.error.details
      );
    }

    return data as T;
  }

  // ============================================================================
  // Authentication API
  // ============================================================================

  /**
   * Register a new user
   */
  async register(data: RegisterRequest): Promise<{ user: { id: string; email: string; name: string }; tokens: AuthTokens }> {
    return this.request('POST', '/api/v1/auth/register', { body: data });
  }

  /**
   * Login user
   */
  async login(data: LoginRequest): Promise<{ user: { id: string; email: string; name: string }; tokens: AuthTokens }> {
    return this.request('POST', '/api/v1/auth/login', { body: data });
  }

  /**
   * Logout user (invalidate refresh token)
   */
  async logout(refreshToken: string): Promise<{ message: string }> {
    return this.request('POST', '/api/v1/auth/logout', { body: { refreshToken } });
  }

  /**
   * Refresh access token
   */
  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    return this.request('POST', '/api/v1/auth/refresh', { body: { refreshToken } });
  }

  /**
   * Get current user profile
   */
  async getProfile(): Promise<{ user: { id: string; email: string; name: string; createdAt: string } }> {
    return this.request('GET', '/api/v1/auth/me');
  }

  // ============================================================================
  // Playlist API
  // ============================================================================

  /**
   * Import a playlist
   */
  async importPlaylist(data: ImportPlaylistRequest): Promise<{ playlist: PlaylistResponse }> {
    return this.request('POST', '/api/v1/playlists/import', { body: data });
  }

  /**
   * List playlists
   */
  async listPlaylists(query?: ListPlaylistsQuery): Promise<ListPlaylistsResponse> {
    return this.request('GET', '/api/v1/playlists', { query: query as Record<string, string | number | undefined> });
  }

  /**
   * Get playlist details
   */
  async getPlaylist(id: string): Promise<{ playlist: PlaylistWithItemsResponse }> {
    return this.request('GET', `/api/v1/playlists/${id}`);
  }

  /**
   * Sync playlist
   */
  async syncPlaylist(id: string): Promise<{ result: SyncResultResponse }> {
    return this.request('POST', `/api/v1/playlists/${id}/sync`);
  }

  /**
   * Delete playlist
   */
  async deletePlaylist(id: string): Promise<{ message: string }> {
    return this.request('DELETE', `/api/v1/playlists/${id}`);
  }
}

/**
 * API Client Error
 */
export class ApiClientError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

/**
 * Create API client instance
 */
export function createApiClient(accessToken?: string): ApiClient {
  const baseUrl = process.env['API_BASE_URL'] || 'http://localhost:3000';

  return new ApiClient({
    baseUrl,
    accessToken,
  });
}
