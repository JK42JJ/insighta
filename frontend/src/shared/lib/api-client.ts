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
  details?: Record<string, unknown>;
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

// ─── CP456 Billing (Lemon Squeezy) types ───────────────────────────────────

export type BillingPlanCode = 'pro_monthly' | 'pro_yearly' | 'pro_lifetime';
export type BillingTier = 'free' | 'pro' | 'lifetime' | 'admin';
export type BillingSubscriptionStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'PAUSED';

export interface BillingSubscriptionSummary {
  id: string;
  planCode: string;
  status: BillingSubscriptionStatus;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  amountCents: number;
  currency: string;
}

export interface BillingSubscriptionMeResponse {
  tier: BillingTier;
  subscription: BillingSubscriptionSummary | null;
}

export interface VideoRichSummaryChapter {
  start_sec: number;
  title: string;
}

export interface VideoRichSummaryQuote {
  timestamp_sec: number;
  text: string;
}

export interface VideoRichSummaryStructured {
  core_argument?: string;
  key_points?: string[];
  evidence?: string[];
  actionables?: string[];
  prerequisites?: string[];
  bias_signals?: string[];
  content_type?: string;
  depth_level?: string;
  chapters?: VideoRichSummaryChapter[];
  quotes?: VideoRichSummaryQuote[];
  tl_dr_ko?: string;
  tl_dr_en?: string;
  // Legacy v2 (CP425) schema kept for backwards compat. New v2 (CP437+)
  // uses the layered jsonb fields below.
  sections?: Array<{
    from_sec: number;
    to_sec: number;
    title: string;
    summary?: string;
    relevance_pct: number;
    key_points?: Array<{ text: string; timestamp_sec?: number }>;
  }>;
  entities?: Array<{ name: string }>;
}

/**
 * CP438+1: v2 layered jsonb schema (CP437 generator). Each is null for
 * v1 rows or when the v2 author has not run yet.
 */
export interface VideoRichSummaryCore {
  one_liner?: string;
  domain?: string;
  depth_level?: string;
  content_type?: string;
  target_audience?: string;
}

export interface VideoRichSummaryKeyConcept {
  term: string;
  definition: string;
}

/** CP474 — typed entity emitted by the v2 prompt (5-type vocabulary). */
export interface VideoRichSummaryEntity {
  name: string;
  type: 'concept' | 'person' | 'tool' | 'framework' | 'organization' | string;
}

export interface VideoRichSummaryAnalysis {
  core_argument?: string;
  key_concepts?: VideoRichSummaryKeyConcept[];
  /** CP474 — KG bridge nodes (concept/person/tool/framework/organization). */
  entities?: VideoRichSummaryEntity[];
  actionables?: string[];
  mandala_fit?: {
    suggested_goals?: string[];
    relevance_rationale?: string;
    /** CP462+ — 0-100 whole-video score against the user's mandala center. */
    mandala_relevance_pct?: number;
  };
  bias_signals?: {
    has_ad?: boolean;
    is_sponsored?: boolean;
    subjectivity_level?: string;
    notes?: string;
  };
  prerequisites?: string;
}

export interface VideoRichSummarySection {
  idx?: number;
  title: string;
  from_sec: number;
  to_sec: number;
  summary?: string;
  /** CP474 — intra-video relevance for this section vs the user's mandala
   *  center goal (0-100 integer). Distinct from
   *  `analysis.mandala_fit.mandala_relevance_pct` (whole-video score). */
  relevance_pct?: number;
  key_points?: Array<{ text: string; timestamp_sec?: number }>;
}

export interface VideoRichSummaryAtom {
  idx?: number;
  type?: 'fact' | 'tip' | 'argument' | string;
  text: string;
  timestamp_sec?: number;
  /** CP474 — links back to analysis.entities[].name (KG bridge). */
  entity_refs?: string[];
}

export interface VideoRichSummarySegments {
  sections?: VideoRichSummarySection[];
  atoms?: VideoRichSummaryAtom[];
}

export interface VideoRichSummaryQAPair {
  level?: number;
  q: string;
  a: string;
  context?: string;
}

export interface VideoRichSummaryLora {
  qa_pairs?: VideoRichSummaryQAPair[];
}

/** CP445 — note mode per-mandala TipTap doc. */
export interface NoteDocumentResponse {
  id: string;
  mandala_id: string;
  content_json: unknown;
  original_json: unknown;
  created_at: string;
  updated_at: string;
}

export interface VideoRichSummaryResponse {
  videoId: string;
  oneLiner: string | null;
  structured: VideoRichSummaryStructured | null;
  // CP438+1: layered v2 jsonb fields. Present when template_version='v2' AND
  // CP437 generator authored the row. NULL on v1 rows.
  templateVersion?: string | null;
  completeness?: number | null;
  core?: VideoRichSummaryCore | null;
  analysis?: VideoRichSummaryAnalysis | null;
  segments?: VideoRichSummarySegments | null;
  lora?: VideoRichSummaryLora | null;
  qualityScore: number | null;
  model: string | null;
  updatedAt: string;
}

/**
 * YouTube captions (transcript) response shape.
 * Transcript text is fetched on demand and never persisted server-side;
 * only `fullText` is consumed by the chatbot's summary fallback.
 */
export interface VideoCaptionResponse {
  videoId: string;
  language: string;
  fullText: string;
  segments: { text: string; start: number; duration: number }[];
}

/**
 * CP438+1 PoC — Mandala book index response shape.
 * Server stores the entire generated book as a single jsonb blob keyed
 * by mandala_id. PoC schema; will split into normalized tables in P5.
 */
export interface MandalaBookAtom {
  vid: string;
  ts: number;
  text: string;
  type?: string;
}

export interface MandalaBookSection {
  title: string;
  narrative?: string;
  atoms?: MandalaBookAtom[];
  qa?: Array<{ q: string; a: string }>;
}

export interface MandalaBookChapter {
  ch: number;
  title: string;
  intro?: string;
  sections: MandalaBookSection[];
}

export interface MandalaBookData {
  mandala_id: string;
  mandala_title: string;
  generated_at: string;
  source_videos: number;
  source_atoms: number;
  estimated_pages?: number;
  chapters: MandalaBookChapter[];
  stats?: Record<string, unknown>;
}

export interface MandalaBookResponse {
  mandalaId: string;
  version: number;
  sourceVideos: number;
  sourceAtoms: number;
  generatedAt: string;
  updatedAt: string;
  book: MandalaBookData;
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

/**
 * Result row returned by the wizard step-1 typeahead endpoint.
 * Backend contract: `{ results: TemplateTypeaheadResult[] }`.
 */
export interface TemplateTypeaheadResult {
  mandala_id: string;
  center_goal: string;
  domain: string | null;
}

/** CP475+3 — per-provider chatbot model overrides + context for admin UI. */
export interface AdminChatbotModelsResponse {
  qwenRunpodModel: string | null;
  openrouterModel: string | null;
  updatedAt: string;
  updatedBy: string | null;
  /** Hardcoded fallbacks (when no env / DB override). */
  defaults: { openrouter: string; local: string; qwenRunpod: string };
  /** Explicit `CHATBOT_MODEL` env value, if set — wins over DB. */
  envExplicit: string | null;
}

export interface AdminChatbotModelsUpdateResponse {
  qwenRunpodModel: string | null;
  openrouterModel: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

interface MandalaResponse {
  id: string;
  userId: string;
  title: string;
  isDefault: boolean;
  isPublic: boolean;
  shareSlug: string | null;
  position: number;
  // CP467 — wizard meta exposed on every mandala fetch (Add Cards
  // panel chip seed + future filter consumers).
  focusTags?: string[];
  targetLevel?: string;
  language?: string;
  // CP467b — server-truth card count for grid layout commitment.
  cardCount?: number;
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
  public readonly details: Record<string, unknown> | undefined;
  public readonly isTransient: boolean;

  constructor(
    message: string,
    statusCode: number,
    code?: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiHttpError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
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

  // Shared promise so concurrent 401s coalesce into a single refreshSession()
  // call. Cleared via queueMicrotask after resolution so the next round of
  // 401s can start a fresh refresh.
  private refreshPromise: Promise<string | null> | null = null;

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

    // On 401, refresh session and retry once. Concurrent 401s share the same
    // refresh promise so we only call refreshSession() once even when many
    // queries fire in parallel (e.g., mandala list + detail + cards on mount).
    if (response.status === 401) {
      if (!this.refreshPromise) {
        this.refreshPromise = supabase.auth
          .refreshSession()
          .then(({ data: { session } }) => {
            const token = session?.access_token ?? null;
            if (token) this.accessToken = token;
            return token;
          })
          .catch(() => null)
          .finally(() => {
            queueMicrotask(() => {
              this.refreshPromise = null;
            });
          });
      }
      const newToken = await this.refreshPromise;
      if (newToken) {
        (headers as Record<string, string>)['Authorization'] = `Bearer ${newToken}`;
        const retryResponse = await fetch(url, { ...options, headers });
        return this.handleResponse<T>(retryResponse);
      }
    }

    return this.handleResponse<T>(response);
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        raw = {
          message: 'An unexpected error occurred',
          statusCode: response.status,
        } as ApiError;
      }
      // BE returns standardized errors as `{ error: { code, message, details, ... } }`
      // (see common.schema.ts createErrorResponse). Unwrap when present so the
      // client surfaces the BE-provided message/code/details rather than the
      // outer envelope's undefined fields.
      const flat: ApiError =
        raw &&
        typeof raw === 'object' &&
        'error' in raw &&
        typeof (raw as { error: unknown }).error === 'object' &&
        (raw as { error: unknown }).error !== null
          ? ((raw as { error: ApiError }).error as ApiError)
          : (raw as ApiError);
      throw new ApiHttpError(
        flat.message || `HTTP Error: ${response.status}`,
        flat.statusCode || response.status,
        flat.code,
        flat.details
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

  /**
   * CP425 — read cached AI rich summary for a YouTube video.
   *
   * Returns null on 404 (no passing row) so callers can show an empty-state
   * instead of throwing. Other errors (401/5xx) propagate.
   */
  async getVideoRichSummary(videoId: string): Promise<VideoRichSummaryResponse | null> {
    try {
      const res = await this.request<{ data: VideoRichSummaryResponse }>(
        `/videos/${videoId}/rich-summary`
      );
      return res.data;
    } catch (err) {
      if (err instanceof ApiHttpError && err.statusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Fetch the same OG meta the BE serves at `/api/v1/og/learning/:m/:v` —
   * single source of truth for the FE share-menu preview card so what the
   * user sees matches the SNS-rendered card byte-for-byte. CP454+.
   */
  async getLearningShareOgMeta(
    mandalaId: string,
    videoId: string
  ): Promise<{ title: string; description: string; thumbnail: string; spaPath: string }> {
    return this.request<{ title: string; description: string; thumbnail: string; spaPath: string }>(
      `/og/learning/${mandalaId}/${videoId}?format=json`
    );
  }

  /**
   * Fetch publicly available YouTube captions (transcript) for a video.
   *
   * Used as the chatbot's video-summary fallback when no rich summary
   * exists yet. Returns null on 404 (no public captions / extraction
   * failed) so callers can degrade gracefully. Other errors propagate.
   */
  async getVideoCaptions(videoId: string, language?: string): Promise<VideoCaptionResponse | null> {
    const query = language ? `?language=${encodeURIComponent(language)}` : '';
    try {
      const res = await this.request<{ caption: VideoCaptionResponse }>(
        `/videos/${videoId}/captions${query}`
      );
      return res.caption;
    } catch (err) {
      if (err instanceof ApiHttpError && err.statusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  /**
   * CP438+1 PoC — fetch the generated book index for a mandala.
   * Returns null on 404 (book has not been generated yet — sidebar
   * fallback to "보고서 작성 준비중...").
   */
  async getMandalaBook(mandalaId: string): Promise<MandalaBookResponse | null> {
    try {
      const res = await this.request<{ data: MandalaBookResponse }>(`/mandalas/${mandalaId}/book`);
      return res.data;
    } catch (err) {
      if (err instanceof ApiHttpError && err.statusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  /**
   * CP425 Trigger 1 — fire-and-forget rich-summary enqueue for all videos
   * in a newly-created mandala. Server enqueues one enrich-video job per
   * unique video_id with withRichSummary=true. Respects per-tier quota.
   *
   * Idempotent: repeated calls are safe (server cache-hits on existing
   * passing rows and does not consume quota for cache hits).
   *
   * Errors (quota / auth / 5xx) are swallowed by the caller's void
   * pattern — this never blocks the wizard save UX.
   */
  async triggerMandalaRichSummary(mandalaId: string): Promise<void> {
    await this.request<{ status: 'ok'; data: unknown }>(
      `/mandalas/${mandalaId}/rich-summary-trigger`,
      { method: 'POST', body: JSON.stringify({}) }
    );
  }

  // ─── CP456 Billing (Lemon Squeezy, MoR subscription) ──────────────────────

  /**
   * Create a Lemon Squeezy hosted checkout URL for the current user.
   * BE: POST /api/v1/billing/checkout.
   * 503 when billing not configured (LEMONSQUEEZY_* env unset).
   */
  async createBillingCheckout(input: {
    planCode: BillingPlanCode;
    successUrl?: string;
    /** When true, LS overlay renders in dark theme (matches user's site theme). */
    dark?: boolean;
    /** ISO locale ('ko' / 'en') for LS hosted checkout — matches i18n.language. */
    locale?: string;
  }): Promise<{ checkoutUrl: string; expiresAt: string | null; planCode: string }> {
    const res = await this.request<{
      success: boolean;
      data: { checkoutUrl: string; expiresAt: string | null; planCode: string };
    }>('/billing/checkout', { method: 'POST', body: JSON.stringify(input) });
    return res.data;
  }

  /**
   * Current user's billing subscription state.
   * BE: GET /api/v1/billing/subscriptions/me.
   * Returns `subscription: null` when no active row — distinguishes "no plan yet" from error.
   */
  async getMyBillingSubscription(): Promise<BillingSubscriptionMeResponse> {
    const res = await this.request<{ success: boolean; data: BillingSubscriptionMeResponse }>(
      '/billing/subscriptions/me'
    );
    return res.data;
  }

  /**
   * LS customer portal URL (signed, ~24h validity). 404 when no active subscription.
   * BE: GET /api/v1/billing/portal.
   */
  async getBillingPortalUrl(): Promise<{ portalUrl: string }> {
    const res = await this.request<{ success: boolean; data: { portalUrl: string } }>(
      '/billing/portal'
    );
    return res.data;
  }

  /**
   * Public billing feature flag (CP456 Phase 5).
   * BE: GET /api/v1/billing/feature-flag (no auth).
   * `enabled=false` → general users see "coming soon" CTA; admins bypass at FE/BE.
   */
  async getBillingFeatureFlag(): Promise<{ enabled: boolean }> {
    const res = await this.request<{ success: boolean; data: { enabled: boolean } }>(
      '/billing/feature-flag'
    );
    return res.data;
  }

  /**
   * Update a system_settings key (admin only). CP456 Phase 5.
   * BE: PUT /api/v1/admin/settings/:key.
   */
  async setSystemSetting(key: string, value: unknown): Promise<{ key: string; value: unknown }> {
    const res = await this.request<{
      success: boolean;
      data: { key: string; value: unknown };
    }>(`/admin/settings/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    });
    return res.data;
  }

  /** Read a system_settings key (admin only). */
  async getSystemSetting(key: string): Promise<{ key: string; value: unknown }> {
    const res = await this.request<{
      success: boolean;
      data: { key: string; value: unknown };
    }>(`/admin/settings/${encodeURIComponent(key)}`);
    return res.data;
  }

  // ─── CP475+3 Chatbot model overrides (admin only) ─────────────────────────

  /**
   * Read per-provider model overrides + their hardcoded defaults so the admin
   * UI can show "currently using X, default Y".
   */
  async getAdminChatbotModels(): Promise<AdminChatbotModelsResponse> {
    const res = await this.request<{ success: boolean; data: AdminChatbotModelsResponse }>(
      '/admin/chatbot/models'
    );
    return res.data;
  }

  /**
   * Update per-provider chatbot model overrides. `null` clears an override;
   * `undefined` (omitted field) leaves it unchanged.
   *
   * The next /api/v1/chat request will pick up the new value (BE invalidates
   * its in-memory cache + rebuilds the CopilotRuntime).
   */
  async setAdminChatbotModels(input: {
    qwenRunpodModel?: string | null;
    openrouterModel?: string | null;
  }): Promise<AdminChatbotModelsUpdateResponse> {
    const res = await this.request<{ success: boolean; data: AdminChatbotModelsUpdateResponse }>(
      '/admin/chatbot/models',
      {
        method: 'PUT',
        body: JSON.stringify(input),
      }
    );
    return res.data;
  }

  // ─── CP445 Note Documents (note mode TipTap doc per-mandala) ──────────────

  /** Fetch the current user's note document for a mandala. 404 → null. */
  async getNoteDocument(mandalaId: string): Promise<NoteDocumentResponse | null> {
    try {
      const res = await this.request<{
        success: boolean;
        data: { doc: NoteDocumentResponse | null };
      }>(`/note-documents/${mandalaId}`);
      return res.data.doc;
    } catch (err) {
      if (err instanceof ApiHttpError && err.statusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  /** First-create a note document. Idempotent (server upserts on (user, mandala) unique). */
  async createNoteDocument(input: {
    mandalaId: string;
    content_json: unknown;
    original_json: unknown;
  }): Promise<NoteDocumentResponse> {
    const res = await this.request<{ success: boolean; data: { doc: NoteDocumentResponse } }>(
      '/note-documents',
      { method: 'POST', body: JSON.stringify(input) }
    );
    return res.data.doc;
  }

  /** Auto-save: update content_json only (original_json immutable). */
  async updateNoteDocument(id: string, content_json: unknown): Promise<NoteDocumentResponse> {
    const res = await this.request<{ success: boolean; data: { doc: NoteDocumentResponse } }>(
      `/note-documents/${id}`,
      { method: 'PUT', body: JSON.stringify({ content_json }) }
    );
    return res.data.doc;
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

  async getRichNote(cardId: string): Promise<{ note: unknown; updatedAt: string } | null> {
    try {
      return await this.request<{ note: unknown; updatedAt: string }>(`/rich-notes/${cardId}`);
    } catch {
      return null;
    }
  }

  async saveRichNote(cardId: string, note: unknown): Promise<{ updatedAt: string }> {
    return this.request<{ updatedAt: string }>(`/rich-notes/${cardId}`, {
      method: 'PATCH',
      body: JSON.stringify({ note }),
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

  // Replace the mandala's focus_tags array. Called when the user X-removes
  // a chip in the Add Cards panel so the change persists across reload
  // (FE-only veto was getting clobbered by the wizard-meta seed).
  async updateMandalaFocusTags(id: string, focusTags: string[]): Promise<{ focusTags: string[] }> {
    return this.request(`/mandalas/${id}/focus-tags`, {
      method: 'PATCH',
      body: JSON.stringify({ focusTags }),
    });
  }

  async deleteMandala(id: string): Promise<void> {
    return this.request<void>(`/mandalas/${id}`, {
      method: 'DELETE',
    });
  }

  /**
   * Toggle pin/bookmark state on a grid view card (CP457+).
   *
   * `source` must match `InsightCard.sourceTable` — the FE-only discriminator
   * that tells us which DB table holds the row (user_local_cards or
   * user_video_states). BE updates `pinned_at` (NULL = unpinned, NOW = pinned).
   *
   * Returns the new state; caller invalidates the cards query for optimistic UI.
   */
  async setCardPin(
    id: string,
    pinned: boolean,
    source: 'user_local_cards' | 'user_video_states'
  ): Promise<{
    status: string;
    data: { id: string; pinned: boolean; pinnedAt: string | null; source: string };
  }> {
    return this.request(`/cards/${id}/pin`, {
      method: 'PATCH',
      body: JSON.stringify({ pinned, source }),
    });
  }

  // ========================================
  // Card Interactions (Heart / Archive)
  // CP462+ Issue #649 Phase 3
  // ========================================

  /**
   * Heart-click a video. BE records signal='like' in card_interactions,
   * sets pinned_at=now() on every matching source row (auto-eviction
   * guard), and — when mandalaId is supplied — enqueues a pg-boss
   * enrich-rich-summary job whose progress can be streamed via
   * GET /cards/:videoId/enrich-stream.
   */
  async likeCard(
    videoId: string,
    body: {
      mandalaId?: string;
      title?: string;
      description?: string;
      cellIndex?: number;
      // CP467 — Add Cards panel Pick of a Tier 2 (fresh-from-YouTube)
      // candidate. youtube_videos has no row yet; sending the metadata
      // we already have on the client lets BE INSERT the row and place
      // the card in the mandala grid.
      videoCacheHint?: {
        title?: string | null;
        description?: string | null;
        channelTitle?: string | null;
        thumbnailUrl?: string | null;
        durationSec?: number | null;
        viewCount?: number | null;
        publishedAt?: string | null;
      };
    }
  ): Promise<{
    status: string;
    data: {
      signalRecorded: boolean;
      jobId: string | null;
      pinnedRows: { user_local_cards: number; user_video_states: number };
    };
  }> {
    return this.request(`/cards/${videoId}/like`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async unlikeCard(videoId: string): Promise<void> {
    // Empty `{}` body to satisfy the default `Content-Type: application/json`
    // header (request() always sets it). Fastify's JSON parser returns
    // 400 FST_ERR_CTP_EMPTY_JSON_BODY when Content-Type is application/json
    // but the body is empty — observed in dev with Bug 1 of #649 Phase 3.
    return this.request(`/cards/${videoId}/unlike`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  /**
   * Idempotent background enrich trigger (CP475+). Fired by Learning Page
   * when the v2 row exists but its `segments` are empty. BE either starts
   * a fresh enrich job, returns the in-flight one, or noops if already
   * complete. Subscribe to GET /cards/:videoId/enrich-stream for progress.
   */
  async enrichCardBackground(
    videoId: string,
    mandalaId: string
  ): Promise<{
    status: string;
    data: {
      jobId: string | null;
      reason: 'enqueued' | 'in_progress' | 'already_complete';
    };
  }> {
    return this.request(`/cards/${videoId}/enrich-bg`, {
      method: 'POST',
      body: JSON.stringify({ mandalaId }),
    });
  }

  async archiveCard(videoId: string, mandalaId: string): Promise<void> {
    return this.request(`/cards/${videoId}/archive`, {
      method: 'POST',
      body: JSON.stringify({ mandalaId }),
    });
  }

  async unarchiveCard(videoId: string): Promise<void> {
    // Same empty-body workaround as unlikeCard (see comment above).
    return this.request(`/cards/${videoId}/unarchive`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  /**
   * Add Cards panel candidate fetcher (CP466). Returns up to N (default
   * 40) Pick-able candidates with Layer 1 (Coverage) + Layer 4 (Feedback
   * bias multiplier) + caps applied per
   * docs/design/add-cards-2026-05-18.md §5.
   */
  async addCards(
    mandalaId: string,
    body: {
      extraKeywords: string[];
      excludeVideoIds: string[];
      filters?: {
        minViewCount?: number;
        durationBucket?: 'short' | 'medium' | 'long' | 'xlong';
        publishedAfter?: string;
      };
    }
  ): Promise<{
    status: string;
    data: {
      cards: Array<{
        videoId: string;
        title: string;
        channel: string | null;
        thumbnail: string | null;
        durationSec: number | null;
        viewCount: number | null;
        publishedAt: string | null;
        score: number;
        cellIndex: number;
        source: 'video_pool' | 'realtime';
      }>;
      mandalaMeta: {
        title: string;
        focusTags: string[];
        targetLevel: string;
        language: 'ko' | 'en';
      };
      trace?: {
        layer1_count: number;
        tier2_count: number;
        after_exclude: number;
        layer4_boost_applied: number;
        caps_enforced: { channel: number; subgoal: number };
        drift_guard_fired: boolean;
        duration_ms: number;
      };
    };
  }> {
    return this.request(`/mandalas/${mandalaId}/add-cards`, {
      method: 'POST',
      body: JSON.stringify(body),
      // BE runs Tier 1 (video_pool KNN) + Tier 2 (runDiscoverEphemeral
      // → YouTube API, 9 cells × 60 buffer with 6-key rotation) in
      // parallel. Default 15s client timeout aborts before BE can
      // assemble + filter the cohort on mandalas with a cold video_pool
      // (prod incident 2026-05-18 — "Request timeout (15s)"). Match the
      // wizard 60s budget; BE remains the source of truth for actual
      // upper bound.
      timeoutMs: 60_000,
    });
  }

  /**
   * Batch lookup of v2 rich-summary fields for the card grid. Returns
   * only rows that have a video_rich_summaries row; videoIds without a
   * row simply do not appear in `items` (FE renders no badge / no
   * one_liner for them). Cap is 128 ids per request.
   */
  async getV2Summaries(videoIds: string[]): Promise<{
    status: string;
    data: {
      items: Array<{
        videoId: string;
        oneLiner: string | null;
        /** CP474 — `analysis.core_argument`, the v2 essence (2-3 sentences). */
        coreArgument: string | null;
        /** Top `analysis.key_concepts[].term` values (≤ 3). */
        keyConcepts: string[];
        /** Fallback keywords from `video_summaries.tags` (≤ 3) when v2 absent. */
        fallbackTags: string[];
        mandalaRelevancePct: number | null;
        qualityFlag: string | null;
        templateVersion: string;
        /** CP475+ — true when v2 full path landed (segments.atoms > 0). */
        v2FullLanded: boolean;
      }>;
    };
  }> {
    const ids = videoIds.filter((id) => id && id.length > 0).join(',');
    return this.request(`/cards/v2-summaries?videoIds=${encodeURIComponent(ids)}`);
  }

  async getMandalaQuota(): Promise<{
    used: number;
    limit: number | null;
    tier: string;
    remaining: number | null;
    daily: { limit: number; used: number; remaining: number; isAdmin: boolean };
  }> {
    const res = await this.request<{
      quota: { used: number; limit: number | null; tier: string; remaining: number | null };
      daily: { limit: number; used: number; remaining: number; isAdmin: boolean };
    }>('/mandalas/quota');
    return { ...res.quota, daily: res.daily };
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
    centerLabel?: string;
    subLabels?: string[];
    focusTags?: string[];
    targetLevel?: string;
    /**
     * CP416 Phase C: ask the server to mark the new mandala as the
     * user's default inside the create transaction. Eliminates the
     * earlier "silent demotion race" where a fire-and-forget
     * updateMandala({isDefault:true}) could fail and leave the user
     * on the old default mandala.
     */
    setAsDefault?: boolean;
    /**
     * CP424.2 wizard precompute: the same UUID sent to streamWizardPreview
     * at Step 1. Server looks up the precomputed discover result and copies
     * it into recommendation_cache under the new mandala_id. Miss → server
     * falls back to the legacy post-creation pipeline. Flag-gated on the
     * server (WIZARD_PRECOMPUTE_ENABLED, default false).
     */
    session_id?: string;
  }): Promise<{ mandalaId: string }> {
    // CP358: prod create writes ~73 INSERTs through pgbouncer (us-west-2 ↔
    // Korea RTT ~250ms × 73 ≈ 18s). BE Prisma transaction timeout is 30s
    // (manager.ts CP358 fix). FE default 15s aborts before BE finishes.
    // 60s budget covers worst-case wall time + safety margin.
    const res = await this.request<{ data: { mandalaId: string } }>('/mandalas/create-with-data', {
      method: 'POST',
      body: JSON.stringify(params),
      timeoutMs: 60_000,
    });
    return res.data;
  }

  /**
   * Phase 1 (2026-04-22) — wizard-stream preview.
   *
   * Calls `POST /api/v1/mandalas/wizard-stream` with `previewOnly: true`
   * and streams the SSE response until `structure_ready` or `complete`
   * fires. Returns a shape drop-in compatible with `generateMandala` so
   * the legacy `useWizard` hook can replace its `generateMutation`
   * mutationFn without any UI component change.
   *
   * Key differences vs `generateMandala`:
   * - Backend uses `generateMandalaStructure` (structure-only ~3s) not
   *   the one-shot Haiku path (~21-28s).
   * - `actions` come back empty. The legacy wizard has its own "actions
   *   arrive from post-creation pipeline after save" fallback, so empty
   *   actions here are valid.
   * - `source` is always `'wizard-stream'`.
   *
   * On SSE parse / HTTP / structure_error, throws — the legacy hook's
   * existing error handling (soft-slow + failed flags) engages the
   * same way it did with the one-shot path.
   */
  async streamWizardPreview(
    goal: string,
    options?: {
      language?: 'ko' | 'en';
      focusTags?: string[];
      targetLevel?: string;
      signal?: AbortSignal;
      /**
       * CP424.2 wizard precompute: client-generated UUID that correlates this
       * preview request with the subsequent `/create-with-data` save. When
       * provided AND WIZARD_PRECOMPUTE_ENABLED on server, server kicks off a
       * background `runDiscoverEphemeral` whose result is consumed at save
       * time. Omit → precompute skipped (backward-compat, legacy behavior).
       */
      sessionId?: string;
      onTemplateFound?: (
        templates: Array<{
          mandala_id: string;
          center_goal: string;
          center_label: string | null;
          domain: string | null;
          language: string | null;
          similarity: number;
          sub_goals: string[];
          sub_labels: string[];
          sub_actions: Record<number, string[]>;
        }>
      ) => void;
    }
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
    source: 'wizard-stream';
    template_duration_ms?: number;
    structure_duration_ms?: number;
  }> {
    const token = await this.getFreshToken();
    if (!token) throw new Error('Not authenticated');

    const res = await fetch(`${this.baseUrl}/api/v1/mandalas/wizard-stream`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        goal,
        language: options?.language,
        previewOnly: true,
        focus_tags: options?.focusTags,
        target_level: options?.targetLevel,
        session_id: options?.sessionId,
      }),
      signal: options?.signal,
    });

    if (!res.ok || !res.body) {
      throw new Error(`wizard-stream HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let structure: Awaited<ReturnType<ApiClient['streamWizardPreview']>>['mandala'] | null = null;
    let templateDurationMs: number | undefined;
    let structureDurationMs: number | undefined;

    const parseBlock = (block: string): { event: string; data: string } | null => {
      const lines = block.split('\n');
      let event = '';
      let data = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) event = line.slice(7).trim();
        else if (line.startsWith('data: ')) data += line.slice(6);
      }
      if (!event) return null;
      return { event, data };
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() ?? '';
        for (const block of blocks) {
          if (!block || block.startsWith(':')) continue;
          const parsed = parseBlock(block);
          if (!parsed) continue;
          const payload = parsed.data ? JSON.parse(parsed.data) : {};
          if (parsed.event === 'template_found') {
            templateDurationMs = payload.duration_ms;
            if (Array.isArray(payload.templates) && options?.onTemplateFound) {
              options.onTemplateFound(payload.templates);
            }
          } else if (parsed.event === 'structure_ready') {
            structureDurationMs = payload.duration_ms;
            structure = payload.structure;
          } else if (
            parsed.event === 'error' ||
            parsed.event === 'structure_error' ||
            parsed.event === 'save_error'
          ) {
            throw new Error(payload.message || `wizard-stream ${parsed.event}`);
          } else if (parsed.event === 'complete') {
            // terminal — exit outer loop
            return finalize();
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return finalize();

    function finalize(): {
      mandala: NonNullable<typeof structure>;
      source: 'wizard-stream';
      template_duration_ms?: number;
      structure_duration_ms?: number;
    } {
      if (!structure) {
        throw new Error('wizard-stream closed without structure_ready');
      }
      return {
        mandala: structure,
        source: 'wizard-stream',
        template_duration_ms: templateDurationMs,
        structure_duration_ms: structureDurationMs,
      };
    }
  }

  /**
   * Lightweight typeahead for the wizard step-1 search bar.
   *
   * Backend contract (BE agent owned). Endpoint resolves to:
   *   GET <baseUrl>/api/v1 + the relative path passed to request() below.
   *   q.length < 2 → returns { results: [] } (no DB query)
   *   limit 5
   *
   * Returns an empty array on short query (< 2 chars) without hitting the
   * network — saves a roundtrip per keystroke during initial typing.
   */
  async searchTemplatesTypeahead(
    q: string,
    options?: { signal?: AbortSignal; lang?: string }
  ): Promise<TemplateTypeaheadResult[]> {
    const trimmed = q.trim();
    if (trimmed.length < 2) return [];
    const params = new URLSearchParams({ q: trimmed });
    // Language filter: only forward 'ko' / 'en' (BE ignores anything else).
    if (options?.lang === 'ko' || options?.lang === 'en') {
      params.set('lang', options.lang);
    }
    const res = await this.request<{ results: TemplateTypeaheadResult[] }>(
      `/mandalas/templates/typeahead?${params}`,
      { externalSignal: options?.signal }
    );
    return res.results ?? [];
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

  async getPipelineStatus(mandalaId: string): Promise<{
    status: string;
    cardCount: number;
    steps: Record<string, { status: string }>;
    retryCount?: number;
  }> {
    return this.request(`/mandalas/${mandalaId}/pipeline-status`);
  }

  async triggerPipeline(mandalaId: string): Promise<{ status: number; message: string }> {
    return this.request(`/mandalas/${mandalaId}/trigger-pipeline`, { method: 'POST' });
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

  /**
   * List public templates for the marketing /templates landing page.
   * No auth token is sent — anonymous access.
   * source is always 'all' (BE ignores any source param).
   */
  async listPublicTemplates(filters: {
    q?: string;
    domain?: string;
    language?: string;
    sort?: string;
    page?: number;
    limit?: number;
  }): Promise<ExploreListResponse> {
    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (filters.domain && filters.domain !== 'all') params.set('domain', filters.domain);
    if (filters.language && filters.language !== 'all') params.set('language', filters.language);
    if (filters.sort) params.set('sort', filters.sort);
    if (filters.page) params.set('page', String(filters.page));
    if (filters.limit) params.set('limit', String(filters.limit));
    const query = params.toString() ? `?${params}` : '';
    return this.request<ExploreListResponse>(`/mandalas/templates-public${query}`);
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

  async createMandalaFromTemplate(params: {
    templateId: string;
    skills: Record<string, boolean>;
    focusTags?: string[];
    targetLevel?: string;
  }): Promise<{ mandalaId: string; title?: string }> {
    return this.request(`/mandalas/create-from-template`, {
      method: 'POST',
      body: JSON.stringify(params),
    });
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

  async getMandalaRecommendations(
    mandalaId: string,
    cellIndex?: number
  ): Promise<{
    mandalaId: string;
    mode: 'auto' | 'manual';
    items: Array<{
      id: string;
      videoId: string;
      title: string;
      channel: string | null;
      thumbnail: string | null;
      durationSec: number | null;
      recScore: number;
      cellIndex: number | null;
      cellLabel: string | null;
      keyword: string;
      source: 'auto_recommend' | 'manual';
      recReason: string | null;
      pinnedAt?: string | null;
    }>;
    lastRefreshed: string | null;
  }> {
    const params = new URLSearchParams();
    if (cellIndex !== undefined) params.set('cell_index', String(cellIndex));
    const query = params.toString() ? `?${params}` : '';
    return this.request(`/mandalas/${mandalaId}/recommendations${query}`);
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
