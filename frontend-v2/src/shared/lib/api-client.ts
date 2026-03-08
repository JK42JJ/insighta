/**
 * Insighta API Client
 *
 * Uses Supabase Auth for authentication.
 * Gets access token from Supabase session for API calls.
 * Token refresh is handled automatically by Supabase SDK.
 */

import { supabase } from '@/shared/integrations/supabase/client';

// In production VITE_API_URL="/api", in dev "http://localhost:3000"
const VITE_API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
// Normalize: if base already ends with /api, don't double it in request()
const API_BASE_URL = VITE_API_URL.endsWith('/api') ? VITE_API_URL.slice(0, -4) : VITE_API_URL;

interface ApiError {
  message: string;
  statusCode: number;
  error?: string;
}

interface User {
  id: string;
  email: string;
  name?: string;
  createdAt: string;
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

interface MandalaResponse {
  id: string;
  userId: string;
  title: string;
  isDefault: boolean;
  isPublic: boolean;
  shareSlug: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  levels: Array<{
    id: string;
    levelKey: string;
    centerGoal: string;
    subjects: string[];
    position: number;
    depth: number;
    color: string | null;
    parentLevelId: string | null;
  }>;
}

interface MandalaLevelBody {
  levelKey: string;
  centerGoal: string;
  subjects: string[];
  position: number;
  depth: number;
  parentLevelKey?: string | null;
}

class ApiClient {
  private baseUrl: string;
  private accessToken: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    this.setupAuthListener();
  }

  /**
   * Listen to Supabase auth state changes and cache the access token.
   * This keeps isAuthenticated() synchronous for component usage.
   */
  private setupAuthListener(): void {
    // Load initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      this.accessToken = session?.access_token || null;
    });

    // Listen for auth state changes (login, logout, token refresh)
    supabase.auth.onAuthStateChange((_event, session) => {
      this.accessToken = session?.access_token || null;
    });
  }

  // ========================================
  // Token Management (Supabase-managed)
  // ========================================

  public isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  public getAccessToken(): string | null {
    return this.accessToken;
  }

  /**
   * Get fresh access token from Supabase session.
   * Falls back to cached token if session fetch fails.
   */
  private async getFreshToken(): Promise<string | null> {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.access_token) {
        this.accessToken = session.access_token;
        return session.access_token;
      }
    } catch {
      // Fall back to cached token
    }
    return this.accessToken;
  }

  // ========================================
  // HTTP Request Wrapper
  // ========================================

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}/api/v1${endpoint}`;
    const token = await this.getFreshToken();

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (token) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, { ...options, headers });

    // On 401, try refreshing session once
    if (response.status === 401) {
      const {
        data: { session },
      } = await supabase.auth.refreshSession();
      if (session?.access_token) {
        this.accessToken = session.access_token;
        (headers as Record<string, string>)['Authorization'] = `Bearer ${session.access_token}`;
        const retryResponse = await fetch(url, { ...options, headers });
        return this.handleResponse<T>(retryResponse);
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

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json();
  }

  // ========================================
  // Authentication (Supabase-managed)
  // ========================================

  /**
   * Sign in with Google OAuth via Supabase
   */
  async signInWithGoogle(): Promise<void> {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/`,
      },
    });
    if (error) throw new Error(error.message);
  }

  /**
   * Sign in with email/password via Supabase
   */
  async signInWithEmail(email: string, password: string): Promise<User> {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw new Error(error.message);

    this.accessToken = data.session?.access_token || null;

    return {
      id: data.user.id,
      email: data.user.email || '',
      name: (data.user.user_metadata?.['name'] as string) || '',
      createdAt: data.user.created_at,
    };
  }

  /**
   * Sign up with email/password via Supabase
   */
  async signUpWithEmail(email: string, password: string, name?: string): Promise<User> {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name },
      },
    });
    if (error) throw new Error(error.message);
    if (!data.user) throw new Error('Registration failed');

    return {
      id: data.user.id,
      email: data.user.email || '',
      name: name || '',
      createdAt: data.user.created_at,
    };
  }

  /**
   * Sign out via Supabase
   */
  async logout(): Promise<void> {
    // Notify backend (optional)
    try {
      if (this.accessToken) {
        await this.request<void>('/auth/logout', { method: 'POST' });
      }
    } catch {
      // Ignore backend logout errors
    }

    // Sign out from Supabase (clears session)
    await supabase.auth.signOut();
    this.accessToken = null;
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
      body: JSON.stringify({ playlistUrl: youtubeUrl }),
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
  // Mandala CRUD
  // ========================================

  async getDefaultMandala(): Promise<{ mandala: MandalaResponse }> {
    return this.request<{ mandala: MandalaResponse }>('/mandalas');
  }

  async upsertMandala(
    title: string,
    levels: MandalaLevelBody[],
  ): Promise<{
    mandala: MandalaResponse;
    linked: { videoStates: number; localCards: number };
  }> {
    return this.request('/mandalas', {
      method: 'PUT',
      body: JSON.stringify({ title, levels }),
    });
  }

  async updateMandalaLevel(
    levelKey: string,
    data: { centerGoal?: string; subjects?: string[]; color?: string | null },
  ): Promise<{ success: boolean }> {
    return this.request(`/mandalas/levels/${levelKey}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  // ========================================
  // Mandala List & Multi-Mandala CRUD
  // ========================================

  async listMandalas(
    page?: number,
    limit?: number,
  ): Promise<{
    mandalas: MandalaResponse[];
    total: number;
    page: number;
    limit: number;
  }> {
    const params = new URLSearchParams();
    if (page) params.set('page', String(page));
    if (limit) params.set('limit', String(limit));
    const query = params.toString() ? `?${params}` : '';
    return this.request(`/mandalas/list${query}`);
  }

  async createMandala(
    title: string,
    levels?: MandalaLevelBody[],
  ): Promise<{ mandala: MandalaResponse }> {
    return this.request('/mandalas/create', {
      method: 'POST',
      body: JSON.stringify({ title, levels }),
    });
  }

  async getMandalaById(id: string): Promise<{ mandala: MandalaResponse }> {
    return this.request<{ mandala: MandalaResponse }>(`/mandalas/${id}`);
  }

  async updateMandala(
    id: string,
    data: { title?: string; isDefault?: boolean; position?: number },
  ): Promise<{ mandala: MandalaResponse }> {
    return this.request(`/mandalas/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async updateMandalaLevels(
    id: string,
    levels: MandalaLevelBody[],
  ): Promise<{ mandala: MandalaResponse }> {
    return this.request(`/mandalas/${id}/levels`, {
      method: 'PUT',
      body: JSON.stringify({ levels }),
    });
  }

  async deleteMandala(id: string): Promise<void> {
    return this.request<void>(`/mandalas/${id}`, {
      method: 'DELETE',
    });
  }

  async getMandalaQuota(): Promise<{
    used: number;
    limit: number;
    plan: string;
  }> {
    return this.request('/mandalas/quota');
  }

  // ========================================
  // Mandala Share & Subscribe
  // ========================================

  async toggleMandalaShare(
    mandalaId: string,
    isPublic: boolean,
  ): Promise<{ mandala: MandalaResponse }> {
    return this.request<{ mandala: MandalaResponse }>(`/mandalas/${mandalaId}/share`, {
      method: 'PATCH',
      body: JSON.stringify({ isPublic }),
    });
  }

  async getPublicMandala(slug: string): Promise<{ mandala: MandalaResponse }> {
    return this.request<{ mandala: MandalaResponse }>(`/mandalas/public/${slug}`);
  }

  async listPublicMandalas(
    page?: number,
    limit?: number,
  ): Promise<{
    mandalas: MandalaResponse[];
    total: number;
    page: number;
    limit: number;
  }> {
    const params = new URLSearchParams();
    if (page) params.set('page', String(page));
    if (limit) params.set('limit', String(limit));
    const query = params.toString() ? `?${params}` : '';
    return this.request(`/mandalas/explore${query}`);
  }

  async subscribeMandala(mandalaId: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/mandalas/${mandalaId}/subscribe`, {
      method: 'POST',
    });
  }

  async unsubscribeMandala(mandalaId: string): Promise<void> {
    return this.request<void>(`/mandalas/${mandalaId}/subscribe`, {
      method: 'DELETE',
    });
  }

  async listSubscriptions(
    page?: number,
    limit?: number,
  ): Promise<{
    subscriptions: Array<{
      id: string;
      mandalaId: string;
      title: string;
      subscribedAt: string;
    }>;
    total: number;
    page: number;
    limit: number;
  }> {
    const params = new URLSearchParams();
    if (page) params.set('page', String(page));
    if (limit) params.set('limit', String(limit));
    const query = params.toString() ? `?${params}` : '';
    return this.request(`/mandalas/subscriptions${query}`);
  }

  async getMandalaActivity(
    mandalaId: string,
    page?: number,
    limit?: number,
  ): Promise<{
    activities: Array<{
      id: string;
      action: string;
      entityType: string;
      entityId: string | null;
      metadata: unknown;
      createdAt: string;
    }>;
    total: number;
    page: number;
    limit: number;
  }> {
    const params = new URLSearchParams();
    if (page) params.set('page', String(page));
    if (limit) params.set('limit', String(limit));
    const query = params.toString() ? `?${params}` : '';
    return this.request(`/mandalas/${mandalaId}/activity${query}`);
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
export type { User, Playlist, Video, Note, SyncStatus, ApiError, MandalaResponse };
