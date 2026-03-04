/**
 * TubeArchive API Client
 *
 * Replaces Supabase integration with custom backend API.
 * Handles JWT authentication, token refresh, and all API endpoints.
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface ApiError {
  message: string;
  statusCode: number;
  error?: string;
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

interface User {
  id: string;
  email: string;
  name?: string;
  createdAt: string;
}

interface LoginResponse extends AuthTokens {
  user: User;
}

interface Playlist {
  id: string;
  youtubeId: string;
  title: string;
  description?: string;
  thumbnailUrl?: string;
  channelTitle?: string;
  itemCount: number;
  publishedAt?: string;
  lastSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface Video {
  id: string;
  youtubeId: string;
  title: string;
  description?: string;
  thumbnailUrl?: string;
  channelTitle?: string;
  duration?: number;
  publishedAt?: string;
  viewCount?: number;
  likeCount?: number;
  createdAt: string;
  updatedAt: string;
}

interface Note {
  id: string;
  videoId: string;
  content: string;
  timestamp?: number;
  createdAt: string;
  updatedAt: string;
}

interface SyncStatus {
  playlistId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  lastSyncedAt?: string;
  error?: string;
}

class ApiClient {
  private baseUrl: string;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    this.loadTokens();
  }

  // Token Management
  private loadTokens(): void {
    this.accessToken = localStorage.getItem('accessToken');
    this.refreshToken = localStorage.getItem('refreshToken');
  }

  private saveTokens(access: string, refresh: string): void {
    this.accessToken = access;
    this.refreshToken = refresh;
    localStorage.setItem('accessToken', access);
    localStorage.setItem('refreshToken', refresh);
  }

  private clearTokens(): void {
    this.accessToken = null;
    this.refreshToken = null;
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
  }

  public isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  public getAccessToken(): string | null {
    return this.accessToken;
  }

  // HTTP Request Wrapper
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}/api/v1${endpoint}`;
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.accessToken) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${this.accessToken}`;
    }

    let response = await fetch(url, { ...options, headers });

    // Handle token refresh on 401
    if (response.status === 401 && this.refreshToken) {
      const refreshed = await this.refreshAccessToken();
      if (refreshed) {
        (headers as Record<string, string>)['Authorization'] = `Bearer ${this.accessToken}`;
        response = await fetch(url, { ...options, headers });
      }
    }

    return this.handleResponse<T>(response);
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      let error: ApiError;
      try {
        error = await response.json();
      } catch {
        error = {
          message: 'An unexpected error occurred',
          statusCode: response.status,
        };
      }
      throw new Error(error.message || `HTTP Error: ${response.status}`);
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return undefined as T;
    }

    return response.json();
  }

  private async refreshAccessToken(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
      });

      if (response.ok) {
        const data: AuthTokens = await response.json();
        this.saveTokens(data.accessToken, data.refreshToken);
        return true;
      }

      this.clearTokens();
      return false;
    } catch {
      this.clearTokens();
      return false;
    }
  }

  // ========================================
  // Authentication Endpoints
  // ========================================

  async login(email: string, password: string): Promise<LoginResponse> {
    const data = await this.request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    this.saveTokens(data.accessToken, data.refreshToken);
    return data;
  }

  async register(email: string, password: string, name?: string): Promise<{ user: User }> {
    return this.request<{ user: User }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    });
  }

  async logout(): Promise<void> {
    try {
      await this.request<void>('/auth/logout', { method: 'POST' });
    } finally {
      this.clearTokens();
    }
  }

  async getCurrentUser(): Promise<User> {
    return this.request<User>('/auth/me');
  }

  // ========================================
  // Playlist Endpoints
  // ========================================

  async getPlaylists(): Promise<Playlist[]> {
    return this.request<Playlist[]>('/playlists');
  }

  async getPlaylist(id: string): Promise<Playlist> {
    return this.request<Playlist>(`/playlists/${id}`);
  }

  async importPlaylist(youtubeUrl: string): Promise<Playlist> {
    return this.request<Playlist>('/playlists/import', {
      method: 'POST',
      body: JSON.stringify({ url: youtubeUrl }),
    });
  }

  async deletePlaylist(id: string): Promise<void> {
    return this.request<void>(`/playlists/${id}`, {
      method: 'DELETE',
    });
  }

  // ========================================
  // Video Endpoints
  // ========================================

  async getVideos(playlistId?: string): Promise<Video[]> {
    const query = playlistId ? `?playlistId=${playlistId}` : '';
    return this.request<Video[]>(`/videos${query}`);
  }

  async getVideo(id: string): Promise<Video> {
    return this.request<Video>(`/videos/${id}`);
  }

  async getPlaylistVideos(playlistId: string): Promise<Video[]> {
    return this.request<Video[]>(`/playlists/${playlistId}/videos`);
  }

  // ========================================
  // Notes Endpoints
  // ========================================

  async getNotes(videoId: string): Promise<Note[]> {
    return this.request<Note[]>(`/videos/${videoId}/notes`);
  }

  async createNote(videoId: string, content: string, timestamp?: number): Promise<Note> {
    return this.request<Note>(`/videos/${videoId}/notes`, {
      method: 'POST',
      body: JSON.stringify({ content, timestamp }),
    });
  }

  async updateNote(noteId: string, content: string): Promise<Note> {
    return this.request<Note>(`/notes/${noteId}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    });
  }

  async deleteNote(noteId: string): Promise<void> {
    return this.request<void>(`/notes/${noteId}`, {
      method: 'DELETE',
    });
  }

  // ========================================
  // Sync Endpoints
  // ========================================

  async syncPlaylist(playlistId: string): Promise<SyncStatus> {
    return this.request<SyncStatus>(`/sync/playlists/${playlistId}`, {
      method: 'POST',
    });
  }

  async getSyncStatus(playlistId: string): Promise<SyncStatus> {
    return this.request<SyncStatus>(`/sync/playlists/${playlistId}/status`);
  }

  async syncAllPlaylists(): Promise<{ triggered: number }> {
    return this.request<{ triggered: number }>('/sync/all', {
      method: 'POST',
    });
  }

  // ========================================
  // Analytics Endpoints
  // ========================================

  async getAnalytics(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('/analytics');
  }

  async getWatchHistory(): Promise<Record<string, unknown>[]> {
    return this.request<Record<string, unknown>[]>('/analytics/history');
  }

  // ========================================
  // Health Check
  // ========================================

  async healthCheck(): Promise<{ status: string; timestamp: string }> {
    const response = await fetch(`${this.baseUrl}/health`);
    return response.json();
  }
}

// Export singleton instance
export const apiClient = new ApiClient(API_BASE_URL);
export default apiClient;

// Export types for use in components
export type {
  User,
  Playlist,
  Video,
  Note,
  SyncStatus,
  AuthTokens,
  LoginResponse,
  ApiError,
};
