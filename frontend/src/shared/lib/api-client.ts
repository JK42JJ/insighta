/**
 * Insighta API Client
 *
 * Uses Supabase Auth for authentication.
 * Gets access token from Supabase session for API calls.
 * Token refresh is handled automatically by Supabase SDK.
 */

import { supabase } from '@/shared/integrations/supabase/client';
import { subscribeAuth } from './auth-event-bus';
import type { ExploreListResponse } from '@/shared/types/explore';

// In production VITE_API_URL="/api", in dev "http://localhost:3000"
const VITE_API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
// Normalize: if base already ends with /api, don't double it in request()
const API_BASE_URL = VITE_API_URL.endsWith('/api') ? VITE_API_URL.slice(0, -4) : VITE_API_URL;

interface ApiError {
  message: string;
  statusCode: number;
  code?: string;
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
  isPaused?: boolean;
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

interface ClawbotConfig {
  cronExpression: string;
  threshold: number;
  batchLimit: number;
  delayMs: number;
  autoStart: boolean;
}

interface ClawbotRunRecord {
  id: string;
  trigger: 'cron' | 'manual' | 'startup';
  status: 'running' | 'completed' | 'failed' | 'skipped';
  startedAt: string;
  completedAt: string | null;
  unsummarizedCount: number;
  result: {
    total: number;
    enriched: number;
    skipped: number;
    errors: { videoId: string; error: string }[];
  } | null;
  error: string | null;
}

interface ClawbotStatus {
  enabled: boolean;
  running: boolean;
  config: ClawbotConfig;
  currentRun: ClawbotRunRecord | null;
  lastRun: ClawbotRunRecord | null;
  nextRunEstimate: string | null;
  stats: { totalRuns: number; totalEnriched: number; totalErrors: number; totalSkipped: number };
}

interface EnrichSchedulerStatus {
  engine: string;
  running: boolean;
  queues: Record<string, { created: number; active: number; completed: number; failed: number }>;
}

interface SyncStatus {
  playlistId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  lastSyncedAt?: string;
  error?: string;
}

interface SkillListResponse {
  id: string;
  description: string;
  version: string;
  trigger: { type: string; schedule?: string; event?: string };
  inputSchema: Record<string, unknown>;
}

interface SkillPreviewResponse {
  subject?: string;
  preview_html?: string;
  curated_count?: number;
}

interface SkillExecuteResponse {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  metadata?: { duration_ms: number; llm_tokens_used?: number; quota_exceeded?: boolean };
}

export interface SkillOutputResponse {
  id: string;
  skill_type: string;
  title: string;
  content: string;
  cell_scope: number[] | null;
  card_count: number | null;
  model_used: string | null;
  created_at: string;
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
    centerLabel?: string | null;
    subjects: string[];
    subjectLabels?: string[];
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

export class ApiHttpError extends Error {
  public readonly statusCode: number;
  public readonly code: string | undefined;
  public readonly isTransient: boolean;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.name = 'ApiHttpError';
    this.statusCode = statusCode;
    this.code = code;
    this.isTransient = statusCode === 429 || statusCode >= 500;
  }
}

class ApiClient {
  private baseUrl: string;
  private accessToken: string | null = null;
  private tokenReadyResolve!: () => void;
  public readonly tokenReady: Promise<void>;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    this.tokenReady = new Promise<void>((resolve) => {
      this.tokenReadyResolve = resolve;
    });
    this.setupAuthListener();
  }

  /**
   * Listen to Supabase auth state changes and cache the access token.
   * Uses auth-event-bus to prevent multiple independent listeners.
   */
  private setupAuthListener(): void {
    // Load initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      this.accessToken = session?.access_token || null;
      this.tokenReadyResolve();
    });

    // Listen for auth state changes via event bus (single listener)
    subscribeAuth((_event, session) => {
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

  private isRefreshing = false;

  private async request<T>(
    endpoint: string,
    options: RequestInit & { timeoutMs?: number; externalSignal?: AbortSignal } = {}
  ): Promise<T> {
    const url = `${this.baseUrl}/api/v1${endpoint}`;
    const token = await this.getFreshToken();

    if (import.meta.env.DEV) {
      console.log(
        `[apiClient] ${options.method || 'GET'} ${endpoint} token:${token ? 'yes' : 'no'}`
      );
    }

    const { timeoutMs, externalSignal, ...fetchOptions } = options;

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...fetchOptions.headers,
    };

    if (token) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
    }

    const DEFAULT_TIMEOUT_MS = 15_000;
    const effectiveTimeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), effectiveTimeout);

    // Forward external abort (e.g., user-initiated cancel)
    const externalAbortHandler = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener('abort', externalAbortHandler, { once: true });
    }

    let response: Response;
    try {
      response = await fetch(url, { ...fetchOptions, headers, signal: controller.signal });
    } catch (err) {
      clearTimeout(timeoutId);
      if (externalSignal) externalSignal.removeEventListener('abort', externalAbortHandler);
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (externalSignal?.aborted) {
          throw new ApiHttpError('Request canceled by user', 0);
        }
        const secs = Math.round(effectiveTimeout / 1000);
        throw new ApiHttpError(`Request timeout (${secs}s)`, 408);
      }
      // Network error (Failed to fetch, QUIC timeout, etc.)
      throw new ApiHttpError(err instanceof Error ? err.message : 'Network error', 0);
    }
    clearTimeout(timeoutId);
    if (externalSignal) externalSignal.removeEventListener('abort', externalAbortHandler);

    if (import.meta.env.DEV) {
      console.log(`[apiClient] Response: ${response.status} ${endpoint}`);
    }

    // On 401, try refreshing session once (skip if already refreshing)
    if (response.status === 401 && !this.isRefreshing) {
      this.isRefreshing = true;
      try {
        const {
          data: { session },
        } = await supabase.auth.refreshSession();
        if (session?.access_token) {
          this.accessToken = session.access_token;
          (headers as Record<string, string>)['Authorization'] = `Bearer ${session.access_token}`;
          const retryResponse = await fetch(url, { ...options, headers });
          return this.handleResponse<T>(retryResponse);
        }
      } finally {
        this.isRefreshing = false;
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
      throw new ApiHttpError(
        error.message || `HTTP Error: ${response.status}`,
        error.statusCode || response.status,
        error.code
      );
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

  async updatePlaylist(id: string, data: { title?: string }): Promise<void> {
    return this.request<void>(`/playlists/${id}/title`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async pausePlaylist(id: string): Promise<void> {
    return this.request<void>(`/playlists/${id}/pause`, {
      method: 'PATCH',
    });
  }

  async resumePlaylist(id: string): Promise<void> {
    return this.request<void>(`/playlists/${id}/resume`, {
      method: 'PATCH',
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
  // Mandala Sharing Endpoints
  // ========================================

  async createShareLink(
    mandalaId: string,
    mode: 'view' | 'view_cards' | 'clone' = 'view',
    expiresInDays?: number
  ): Promise<{
    status: string;
    data: {
      id: string;
      shareCode: string;
      mode: string;
      expiresAt: string | null;
      createdAt: string;
    };
  }> {
    return this.request('/sharing/create', {
      method: 'POST',
      body: JSON.stringify({ mandalaId, mode, expiresInDays }),
    });
  }

  async getSharedMandala(code: string): Promise<{
    status: string;
    data: {
      share: { id: string; shareCode: string; mode: string; expiresAt: string | null };
      mandala: {
        title: string;
        levels: Array<{
          levelKey: string;
          centerGoal: string;
          subjects: string[];
          parentLevelId: string | null;
        }>;
        cardCount?: number;
      };
    };
  }> {
    return this.request(`/sharing/${code}`);
  }

  async cloneSharedMandala(code: string): Promise<{
    status: string;
    data: { mandalaId: string; title: string };
  }> {
    return this.request(`/sharing/${code}/clone`, { method: 'POST' });
  }

  async listShareLinks(mandalaId: string): Promise<{
    status: string;
    data: Array<{
      id: string;
      shareCode: string;
      mode: string;
      expiresAt: string | null;
      createdAt: string;
    }>;
  }> {
    return this.request(`/sharing/mandala/${mandalaId}`);
  }

  async deleteShareLink(shareId: string): Promise<{ status: string }> {
    return this.request(`/sharing/${shareId}`, { method: 'DELETE' });
  }

  // ========================================
  // YouTube Library Endpoints
  // ========================================

  async getYouTubeSubscriptions(pageToken?: string): Promise<{
    status: string;
    data: Array<{
      channelId: string;
      title: string;
      description: string;
      thumbnailUrl: string;
      publishedAt: string;
    }>;
    pagination: { nextPageToken?: string; totalResults: number };
  }> {
    const query = pageToken ? `?pageToken=${pageToken}` : '';
    return this.request(`/youtube/subscriptions${query}`);
  }

  async getYouTubePlaylists(pageToken?: string): Promise<{
    status: string;
    data: Array<{
      playlistId: string;
      title: string;
      description: string;
      thumbnailUrl: string;
      itemCount: number;
      publishedAt: string;
    }>;
    pagination: { nextPageToken?: string; totalResults: number };
  }> {
    const query = pageToken ? `?pageToken=${pageToken}` : '';
    return this.request(`/youtube/playlists${query}`);
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
    levels: MandalaLevelBody[]
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
    data: { centerGoal?: string; subjects?: string[]; color?: string | null }
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
    limit?: number
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
    levels?: MandalaLevelBody[]
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
    data: { title?: string; isDefault?: boolean; position?: number }
  ): Promise<{ mandala: MandalaResponse }> {
    return this.request(`/mandalas/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async updateMandalaLevels(
    id: string,
    levels: MandalaLevelBody[]
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
    limit: number | null;
    tier: string;
    remaining: number | null;
  }> {
    const res = await this.request<{
      quota: { used: number; limit: number | null; tier: string; remaining: number | null };
    }>('/mandalas/quota');
    return res.quota;
  }

  // ========================================
  // Mandala AI Generation
  // ========================================

  async generateMandala(
    goal: string,
    options?: { domain?: string; language?: 'ko' | 'en'; signal?: AbortSignal }
  ): Promise<{
    mandala: {
      center_goal: string;
      center_label: string;
      language: string;
      domain: string;
      sub_goals: string[];
      sub_labels?: string[];
      actions: Record<string, string[]>;
    };
    source: 'lora' | 'llm-fallback';
  }> {
    const res = await this.request<{
      data: {
        mandala: {
          center_goal: string;
          center_label: string;
          language: string;
          domain: string;
          sub_goals: string[];
          sub_labels?: string[];
          actions: Record<string, string[]>;
        };
        source: 'lora' | 'llm-fallback';
      };
    }>('/mandalas/generate', {
      method: 'POST',
      body: JSON.stringify({ goal, domain: options?.domain, language: options?.language }),
      // Mandala generation: ~120s warm on Mac Mini M4. Bumped from 180→240
      // for safety margin (cold-start is mitigated by /prewarm + keep_alive=24h
      // server-side, but variance can still push generation to ~150s).
      timeoutMs: 240_000,
      externalSignal: options?.signal,
    });
    return res.data;
  }

  /**
   * Fire-and-forget Mac Mini Ollama model warm-up.
   * Call when entering the wizard goal step so the model is loaded by the
   * time the user clicks "Start". Server-side function has its own 60s
   * ceiling and `keep_alive: 24h` so the loaded model stays resident.
   *
   * Returns the server's reported warmed status. Errors are swallowed —
   * prewarm is purely an optimization.
   */
  async prewarmMandalaModel(): Promise<boolean> {
    try {
      const res = await this.request<{ data: { warmed: boolean } }>('/mandalas/prewarm', {
        method: 'POST',
        timeoutMs: 65_000,
      });
      return res.data.warmed;
    } catch {
      return false;
    }
  }

  async generateLabels(params: {
    center_goal: string;
    sub_goals: string[];
    language?: 'ko' | 'en';
  }): Promise<{ center_label: string; sub_labels: string[] }> {
    const res = await this.request<{
      data: { center_label: string; sub_labels: string[] };
    }>('/mandalas/generate-labels', {
      method: 'POST',
      body: JSON.stringify(params),
      timeoutMs: 60_000,
    });
    return res.data;
  }

  async createMandalaWithData(params: {
    title: string;
    centerGoal: string;
    subjects: string[];
    subDetails?: Record<string, string[]>;
    skills?: Record<string, boolean>;
  }): Promise<{ mandalaId: string }> {
    const res = await this.request<{ data: { mandalaId: string } }>('/mandalas/create-with-data', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    return res.data;
  }

  async searchMandalasByGoal(
    goal: string,
    options?: { limit?: number; threshold?: number; language?: string; signal?: AbortSignal }
  ): Promise<
    Array<{
      mandala_id: string;
      center_goal: string;
      center_label: string | null;
      domain: string | null;
      language: string | null;
      similarity: number;
      sub_goals: string[];
    }>
  > {
    const res = await this.request<{
      data: {
        results: Array<{
          mandala_id: string;
          template_mandala_id: string | null;
          center_goal: string;
          center_label: string | null;
          domain: string | null;
          language: string | null;
          similarity: number;
          sub_goals: string[];
          sub_labels: string[];
          sub_actions: Record<number, string[]>;
        }>;
      };
    }>('/mandalas/search-by-goal', {
      method: 'POST',
      body: JSON.stringify({
        goal,
        limit: options?.limit,
        threshold: options?.threshold,
        language: options?.language,
      }),
      externalSignal: options?.signal,
    });
    return res.data.results;
  }

  // ========================================
  // Source-Mandala Mappings
  // ========================================

  async listSourceMappings(): Promise<{
    mappings: Array<{
      id: string;
      source_type: string;
      source_id: string;
      mandala_id: string;
      mandala: { id: string; title: string };
      created_at: string;
    }>;
  }> {
    return this.request('/mandalas/source-mappings');
  }

  async createSourceMappings(
    sourceType: string,
    sourceIds: string[],
    mandalaId: string
  ): Promise<{ created: number }> {
    return this.request('/mandalas/source-mappings', {
      method: 'POST',
      body: JSON.stringify({ sourceType, sourceIds, mandalaId }),
    });
  }

  async deleteSourceMapping(
    sourceType: string,
    sourceId: string,
    mandalaId: string
  ): Promise<{ deleted: boolean }> {
    return this.request('/mandalas/source-mappings', {
      method: 'DELETE',
      body: JSON.stringify({ sourceType, sourceId, mandalaId }),
    });
  }

  // ========================================
  // Mandala Share & Subscribe
  // ========================================

  async toggleMandalaShare(
    mandalaId: string,
    isPublic: boolean
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
    limit?: number
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

  // ─── Explore Page API ───

  async listExploreMandalas(filters: {
    q?: string;
    domain?: string;
    language?: string;
    source?: string;
    sort?: string;
    page?: number;
    limit?: number;
  }): Promise<ExploreListResponse> {
    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (filters.domain && filters.domain !== 'all') params.set('domain', filters.domain);
    if (filters.language && filters.language !== 'all') params.set('language', filters.language);
    if (filters.source && filters.source !== 'all') params.set('source', filters.source);
    if (filters.sort) params.set('sort', filters.sort);
    if (filters.page) params.set('page', String(filters.page));
    if (filters.limit) params.set('limit', String(filters.limit));
    const query = params.toString() ? `?${params}` : '';
    return this.request<ExploreListResponse>(`/mandalas/explore${query}`);
  }

  async toggleMandalaLike(
    mandalaId: string
  ): Promise<{ success: boolean; data: { liked: boolean; likeCount: number } }> {
    return this.request(`/mandalas/${mandalaId}/like`, { method: 'POST' });
  }

  async clonePublicMandala(
    mandalaId: string
  ): Promise<{ success: boolean; data: { mandalaId: string; title: string } }> {
    return this.request(`/mandalas/${mandalaId}/clone`, { method: 'POST' });
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
    limit?: number
  ): Promise<{
    subscriptions: Array<{
      id: string;
      mandalaId: string;
      title: string;
      shareSlug: string | null;
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

  async getMandalaMood(mandalaId: string): Promise<{
    state: number;
    signals: {
      weeklySessionCount: number;
      entertainmentRatio: number;
      newTopicCount: number;
      daysSinceLastActivity: number;
      totalCards: number;
    };
    updatedAt: string;
  }> {
    return this.request(`/mandalas/${mandalaId}/mood`);
  }

  async getMandalaActivity(
    mandalaId: string,
    page?: number,
    limit?: number
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
  // Admin Endpoints
  // ========================================

  async checkAdminAccess(): Promise<{ isAdmin: boolean }> {
    return this.request<{ isAdmin: boolean }>('/admin/check');
  }

  async getAdminStats(): Promise<{
    success: boolean;
    data: {
      users: { total: number; active: number };
      tiers: Array<{ tier: string; count: number }>;
      recentSignups: Array<{ date: string; count: number }>;
      content: { totalCards: number; totalMandalas: number };
      kpi: {
        totalNotes: number;
        totalSummaries: number;
        totalSyncedCards: number;
        totalSyncedPlaylists: number;
        summariesToday: number;
        summariesWeek: number;
      };
    };
  }> {
    return this.request('/admin/stats/overview');
  }

  async getAdminActivity(params: { from: string; to: string; userId?: string }): Promise<{
    success: boolean;
    data: Array<{
      date: string;
      logins: number;
      cardsCreated: number;
      notesWritten: number;
      aiSummaries: number;
      mandalaActions: number;
    }>;
  }> {
    const query = new URLSearchParams({ from: params.from, to: params.to });
    if (params.userId) query.set('user_id', params.userId);
    return this.request(`/admin/stats/activity?${query}`);
  }

  async getAdminUsers(params?: {
    page?: number;
    limit?: number;
    search?: string;
    tier?: string;
  }): Promise<{
    items: Array<Record<string, unknown>>;
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
      hasNext: boolean;
      hasPrev: boolean;
    };
  }> {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.search) query.set('search', params.search);
    if (params?.tier) query.set('tier', params.tier);
    const qs = query.toString() ? `?${query}` : '';
    return this.request(`/admin/users${qs}`);
  }

  async getAdminUser(id: string): Promise<{ success: boolean; data: Record<string, unknown> }> {
    return this.request(`/admin/users/${id}`);
  }

  async updateUserSubscription(
    id: string,
    data: { tier?: string; localCardsLimit?: number; mandalaLimit?: number; reason?: string }
  ): Promise<{ success: boolean; data: Record<string, unknown> }> {
    return this.request(`/admin/users/${id}/subscription`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async updateUserStatus(
    id: string,
    data: { banned: boolean; banReason?: string }
  ): Promise<{ success: boolean; data: Record<string, unknown> }> {
    return this.request(`/admin/users/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  // ========================================
  // Admin Promotions
  // ========================================

  async getAdminPromotions(params?: { page?: number; limit?: number; status?: string }): Promise<{
    items: Array<Record<string, unknown>>;
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
      hasNext: boolean;
      hasPrev: boolean;
    };
  }> {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.status) query.set('status', params.status);
    const qs = query.toString() ? `?${query}` : '';
    return this.request(`/admin/promotions${qs}`);
  }

  async createAdminPromotion(data: {
    code: string;
    type: string;
    value: Record<string, unknown>;
    startsAt?: string;
    endsAt?: string;
    maxRedemptions?: number;
  }): Promise<{ success: boolean; data: Record<string, unknown> }> {
    return this.request('/admin/promotions', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateAdminPromotion(
    id: string,
    data: Record<string, unknown>
  ): Promise<{ success: boolean; data: Record<string, unknown> }> {
    return this.request(`/admin/promotions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteAdminPromotion(
    id: string
  ): Promise<{ success: boolean; data: Record<string, unknown> }> {
    return this.request(`/admin/promotions/${id}`, { method: 'DELETE' });
  }

  async getAdminAuditLog(params?: {
    page?: number;
    limit?: number;
    action?: string;
    targetType?: string;
  }): Promise<{
    items: Array<Record<string, unknown>>;
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
      hasNext: boolean;
      hasPrev: boolean;
    };
  }> {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.action) query.set('action', params.action);
    if (params?.targetType) query.set('targetType', params.targetType);
    const qs = query.toString() ? `?${query}` : '';
    return this.request(`/admin/audit-log${qs}`);
  }

  async bulkUpdateUsers(
    userIds: string[],
    changes: { tier?: string; localCardsLimit?: number; mandalaLimit?: number }
  ): Promise<{ success: boolean; data: { updated: number; total: number } }> {
    return this.request('/admin/users/bulk', {
      method: 'POST',
      body: JSON.stringify({ userIds, changes }),
    });
  }

  // ========================================
  // Admin Content Moderation
  // ========================================

  async getAdminContent(params?: { page?: number; limit?: number; search?: string }): Promise<{
    items: Array<Record<string, unknown>>;
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
      hasNext: boolean;
      hasPrev: boolean;
    };
  }> {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.search) query.set('search', params.search);
    const qs = query.toString() ? `?${query}` : '';
    return this.request(`/admin/content/mandalas${qs}`);
  }

  async moderateAdminContent(
    id: string,
    data: { hidden?: boolean }
  ): Promise<{ success: boolean; data: Record<string, unknown> }> {
    return this.request(`/admin/content/mandalas/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteAdminContent(
    id: string
  ): Promise<{ success: boolean; data: Record<string, unknown> }> {
    return this.request(`/admin/content/mandalas/${id}`, { method: 'DELETE' });
  }

  async getAdminReports(params?: {
    page?: number;
    limit?: number;
    status?: string;
    targetType?: string;
  }): Promise<{
    items: Array<Record<string, unknown>>;
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
      hasNext: boolean;
      hasPrev: boolean;
    };
  }> {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.status) query.set('status', params.status);
    if (params?.targetType) query.set('targetType', params.targetType);
    const qs = query.toString() ? `?${query}` : '';
    return this.request(`/admin/reports${qs}`);
  }

  async resolveAdminReport(
    id: string,
    data: { status: string; resolutionNote?: string }
  ): Promise<{ success: boolean; data: Record<string, unknown> }> {
    return this.request(`/admin/reports/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async getAdminHealth(): Promise<{
    success: boolean;
    data: {
      api: {
        status: string;
        uptime: number;
        responseTimeMs: number;
        memory: { heapUsedMB: number; heapTotalMB: number; rssMB: number };
      };
      database: {
        status: string;
        latencyMs: number;
        activeConnections: number;
        tableSizes: Array<Record<string, unknown>>;
      };
      environment: { nodeVersion: string; platform: string };
    };
  }> {
    return this.request('/admin/health');
  }

  // ========================================
  // Admin LLM
  // ========================================

  async getAdminLlm(): Promise<{
    success: boolean;
    data: {
      config: {
        provider: string;
        openrouter_model: string;
        ollama_url: string;
        ollama_generate_model: string;
        ollama_embed_model: string;
      };
      active: {
        embedding: { provider: string; dimension: number };
        generation: { provider: string; model: string };
      };
      health: {
        ollama: boolean;
        gemini: boolean;
        openrouter:
          | boolean
          | { available: boolean; latencyMs: number; credits?: string; error?: string };
      };
      auto_priority: string[];
    };
  }> {
    return this.request('/admin/llm');
  }

  async updateAdminLlm(body: { provider: string; openrouter_model?: string }): Promise<{
    success: boolean;
    data: {
      provider: string;
      active: { embedding: { provider: string }; generation: { provider: string; model: string } };
    };
  }> {
    return this.request('/admin/llm', { method: 'PUT', body: JSON.stringify(body) });
  }

  // ========================================
  // Admin Enrichment
  // ========================================

  async runBatchEnrich(body: { limit?: number; delay_ms?: number } = {}): Promise<{
    success: boolean;
    data: { jobId: string; status: string };
  }> {
    return this.request('/admin/enrichment/batch-all', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async getEnrichJobs(limit: number = 20): Promise<{
    success: boolean;
    data: {
      jobs: Array<{
        id: string;
        status: 'running' | 'completed' | 'failed';
        limit: number;
        startedAt: string;
        completedAt: string | null;
        result: {
          total: number;
          enriched: number;
          skipped: number;
          errors: { videoId: string; error: string }[];
        } | null;
        error: string | null;
      }>;
      total: number;
    };
  }> {
    return this.request(`/admin/enrichment/jobs?limit=${limit}`);
  }

  async getEnrichJob(id: string): Promise<{
    success: boolean;
    data: {
      id: string;
      status: 'running' | 'completed' | 'failed';
      limit: number;
      startedAt: string;
      completedAt: string | null;
      result: {
        total: number;
        enriched: number;
        skipped: number;
        errors: { videoId: string; error: string }[];
      } | null;
      error: string | null;
    };
  }> {
    return this.request(`/admin/enrichment/jobs/${id}`);
  }

  // ========================================
  // Admin Clawbot
  // ========================================

  async getClawbotStatus(): Promise<{ success: boolean; data: ClawbotStatus }> {
    return this.request('/admin/clawbot/status');
  }

  async triggerClawbot(): Promise<{ success: boolean; data: { message: string } }> {
    return this.request('/admin/clawbot/trigger', { method: 'POST' });
  }

  async updateClawbotConfig(
    body: Partial<ClawbotConfig>
  ): Promise<{ success: boolean; data: { config: ClawbotConfig } }> {
    return this.request('/admin/clawbot/config', { method: 'PUT', body: JSON.stringify(body) });
  }

  async startClawbot(): Promise<{ success: boolean; data: { message: string } }> {
    return this.request('/admin/clawbot/start', { method: 'POST' });
  }

  async stopClawbot(): Promise<{ success: boolean; data: { message: string } }> {
    return this.request('/admin/clawbot/stop', { method: 'POST' });
  }

  async getClawbotHistory(
    limit: number = 20
  ): Promise<{ success: boolean; data: { runs: ClawbotRunRecord[]; total: number } }> {
    return this.request(`/admin/clawbot/history?limit=${limit}`);
  }

  // ========================================
  // Enrichment Scheduler
  // ========================================

  async getEnrichSchedulerStatus(): Promise<{ status: string; data: EnrichSchedulerStatus }> {
    return this.request('/admin/enrichment-scheduler/status');
  }

  // Enrichment scheduler history/start/stop removed — pg-boss manages lifecycle

  // ========================================
  // Admin Analytics
  // ========================================

  async getAdminAnalyticsUsers(days: number = 30): Promise<{
    success: boolean;
    data: {
      dau: Array<{ date: string; count: number }>;
      wau: Array<{ week: string; count: number }>;
      mau: Array<{ month: string; count: number }>;
    };
  }> {
    return this.request(`/admin/analytics/users?days=${days}`);
  }

  async getAdminAnalyticsGrowth(days: number = 30): Promise<{
    success: boolean;
    data: { signups: Array<{ date: string; count: number }>; totalUsers: number };
  }> {
    return this.request(`/admin/analytics/growth?days=${days}`);
  }

  async getAdminAnalyticsRevenue(): Promise<{
    success: boolean;
    data: { mrr: number; subscribers: number; monthlyBreakdown: Array<Record<string, unknown>> };
  }> {
    return this.request('/admin/analytics/revenue');
  }

  async getAdminTransactions(): Promise<{
    success: boolean;
    data: { transactions: Array<Record<string, unknown>> };
  }> {
    return this.request('/admin/payments/transactions');
  }

  // ========================================
  // Settings — LLM Keys
  // ========================================

  async getLlmKeys(): Promise<{
    status: number;
    data: Array<{ provider: string; status: string; maskedKey: string; updatedAt: string }>;
  }> {
    return this.request('/settings/llm-keys');
  }

  async saveLlmKey(
    provider: string,
    apiKey: string
  ): Promise<{ status: number; data: { provider: string; status: string; maskedKey: string } }> {
    return this.request('/settings/llm-keys', {
      method: 'POST',
      body: JSON.stringify({ provider, apiKey }),
    });
  }

  async deleteLlmKey(provider: string): Promise<{ status: number; data: { deleted: boolean } }> {
    return this.request(`/settings/llm-keys/${encodeURIComponent(provider)}`, {
      method: 'DELETE',
    });
  }

  async updateLlmKeyPriorities(
    items: { provider: string; priority: number; status: string }[]
  ): Promise<{ status: number; data: { updated: boolean } }> {
    return this.request('/settings/llm-keys/priorities', {
      method: 'PUT',
      body: JSON.stringify({ items }),
    });
  }

  async deleteAccount(): Promise<void> {
    return this.request('/settings/account', { method: 'DELETE' });
  }

  // ========================================
  // Skills
  // ========================================

  async listSkills(): Promise<{ data: SkillListResponse[] }> {
    return this.request('/skills');
  }

  async previewSkill(skillId: string, mandalaId: string): Promise<{ data: SkillPreviewResponse }> {
    return this.request(`/skills/${skillId}/preview`, {
      method: 'POST',
      body: JSON.stringify({ mandala_id: mandalaId }),
    });
  }

  async executeSkill(skillId: string, mandalaId: string): Promise<{ data: SkillExecuteResponse }> {
    return this.request(`/skills/${skillId}/execute`, {
      method: 'POST',
      body: JSON.stringify({ mandala_id: mandalaId }),
      timeoutMs: 120_000, // LLM generation can take 30-90s
    });
  }

  async listSkillOutputs(mandalaId: string, limit = 10): Promise<{ data: SkillOutputResponse[] }> {
    return this.request(`/skills/outputs?mandala_id=${mandalaId}&limit=${limit}`);
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
