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

// Global Search (⌘K palette) — mirrors src/modules/search/global-search.ts
export interface GlobalSearchCardHit {
  kind: 'video' | 'local';
  id: string;
  title: string | null;
  channelTitle: string | null;
  thumbnailUrl: string | null;
  url: string | null;
  videoId: string | null;
  note: string | null;
  mandalaId: string | null;
  cellIndex: number | null;
  createdAt: string;
}

export interface GlobalSearchMandalaHit {
  id: string;
  title: string | null;
  centerLabel: string | null;
  createdAt: string;
}

export interface GlobalSearchNoteHit {
  id: string;
  mandalaId: string;
  mandalaTitle: string | null;
  snippet: string;
  updatedAt: string;
}

export interface GlobalSearchSummaryHit {
  videoId: string;
  oneLiner: string;
  videoTitle: string | null;
  mandalaId: string | null;
}

export interface GlobalSearchGroup<T> {
  items: T[];
  total: number;
  /** true = the group missed its server-side time budget (incomplete). */
  partial: boolean;
}

export interface GlobalSearchResponse {
  query: string;
  groups: {
    cards: GlobalSearchGroup<GlobalSearchCardHit>;
    mandalas: GlobalSearchGroup<GlobalSearchMandalaHit>;
    notes: GlobalSearchGroup<GlobalSearchNoteHit>;
    summaries: GlobalSearchGroup<GlobalSearchSummaryHit>;
  };
  tookMs: number;
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
  /**
   * CP500+ — present when the source video exceeded the v2 duration cap and
   * the summary was generated from the first `coveredSec` of `fullSec`
   * seconds. The FE renders a "first N min of M min" badge.
   */
  truncation?: { truncated: boolean; coveredSec: number; fullSec: number };
  /**
   * CP500+ PR-B — set on a terminal `quality_flag='skipped'` row (no transcript
   * / no youtube metadata). The FE renders "summary unavailable: <reason>"
   * instead of an eternal spinner.
   */
  skip_reason?: string;
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
  /** PR3 — the mandala_books.version this note was generated from. stale when
   *  the current book.version is greater (book re-filled with new content). */
  based_on_book_version?: number;
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
  /**
   * CP488+ Phase 4 — server-side quality_flag of the row ('pass' | 'low'
   * | 'qwen3_low' | 'pending' | null). Anything other than 'pass'
   * surfaces a subtle "auto-improving" indicator in the UI; the content
   * still renders (Phase 4 "detection, not blocking" policy).
   */
  qualityFlag: string | null;
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
  // §1⑤/§2 — the rich-summary time-segment this atom came from. Used to bound
  // segment playback (end = the segment's to_sec) in the note video player.
  seg_ref?: { from_sec: number; to_sec: number };
}

// CP504 loop-2-A — per-atom factcheck stored additively in section.verification.
export interface MandalaBookFactcheck {
  atom_text: string;
  verdict: 'TRUE' | 'SUBSTANTIALLY_TRUE' | 'FALSE' | 'MISLEADING' | 'UNVERIFIABLE';
  evidence_url?: string;
  correction?: string; // proposal only (prose not rewritten)
}

// [CV-NOTE-WIRE] — a targeted computer-vision figure attached to a section.
// Backend writes this additively (flag-gated) AFTER filtering to verified +
// renderable; the FE render filters defensively too.
export interface MandalaBookFigure {
  video_id: string;
  ts_sec: number;
  kind: 'chart' | 'diagram' | 'table' | 'equation' | 'keyframe';
  latex?: string;
  asset_path?: string; // legacy image pointer (no longer written by enrich job)
  struct?: Record<string, unknown>; // mode-B JSON (chart/table/diagram); struct.insight = caption
  svg?: string; // chart/diagram → server-rendered SVG (CP505 struct→SVG)
  verification_status?: string;
}

export interface MandalaBookSection {
  title: string;
  narrative?: string;
  // NOTE-DENSITY ① — 2-3 distilled take-aways per section, distinct from the
  // flowing narrative. Rendered as a "핵심 요점" callout (narrative mode only).
  keyPoints?: string[];
  atoms?: MandalaBookAtom[];
  qa?: Array<{ q: string; a: string }>;
  verification?: { status?: string; notes?: string; checks?: MandalaBookFactcheck[] }; // CP504 loop-2-A
  figures?: MandalaBookFigure[]; // [CV-NOTE-WIRE] inert until backend populates
}

export interface MandalaBookChapter {
  ch: number;
  title: string;
  intro?: string;
  sections: MandalaBookSection[];
  // CP504 loop-2-B — STORM gap-fill findings (web facts); ref_id → references[].
  research?: Array<{ perspective: string; fact: string; ref_id: number }>;
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
  // CP504 loop-2-B (B) — web references (STORM). Rendered as bottom "참고 자료".
  references?: Array<{ id: number; title: string; url: string }>;
}

export interface MandalaBookResponse {
  mandalaId: string;
  version: number;
  sourceVideos: number;
  sourceAtoms: number;
  /** §1④ coverage (PR2). v2Pending > 0 ⇒ the book is still filling. */
  coverage?: { gatePassed: number; v2Done: number; v2Pending: number };
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
  // CP499+ pool-serve — cells with an async deficit-fill in flight (W1b pulse).
  fillPendingCells?: number[];
  // CP500+ — cells whose fill run completed <60s ago (grace: invalidate once).
  fillCompletedCells?: number[];
  // P1 — per-mandala asset status for the sidebar (deck/note/v2), from the LIST
  // path only. Lets the sidebar show at-a-glance icons without per-mandala fetches.
  assetStatus?: {
    deck: string | null; // pending | building | done | failed | null=none
    note: 'fresh' | 'stale' | 'none';
    v2Done: number | null;
    v2GatePassed: number | null;
    v2Pending: number | null; // >0 ⇒ v2 still generating (drives the live spinner)
  };
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

// Admin Performance Monitor — kept in sync with src/api/routes/admin/performance.ts
export interface PerfKpiMandalaDay {
  day: string;
  mandalas: number;
  place_off_p50_s: number | null;
  place_off_p95_s: number | null;
  cards_p50: number | null;
  cells_p50: number | null;
  shorts: number;
  deboost_rate: number | null;
}

export interface PerfKpiPrecomputeDay {
  day: string;
  total: number;
  consumed: number;
  dur_p50_s: number | null;
  dur_p95_s: number | null;
}

export interface PerfKpiTraceDay {
  day: string;
  gate_pass_ratio: number | null;
  embed_p95_ms: number | null;
}

export interface PerfChangeEvent {
  id: string;
  created_at: string;
  source: string;
  git_sha: string | null;
  flags: Record<string, string> | null;
  diff: Record<string, { from: string | null; to: string | null }> | null;
  note: string | null;
  experiment: string | null;
  experiment_criteria: string | null;
}

export interface PerfViolation {
  metric: string;
  value: number;
  threshold: number;
  direction: 'above' | 'below';
}

export interface AdminPerformanceDiagnosis {
  generated_at: string;
  interpretation: { rules: readonly string[] };
  current: { git_sha: string | null; flags: Record<string, string> };
  thresholds: Record<string, number>;
  window_24h: Record<string, number | null> | null;
  violations: PerfViolation[];
  kpi_7d: {
    mandala_days: PerfKpiMandalaDay[];
    precompute_days: PerfKpiPrecomputeDay[];
    trace_days: PerfKpiTraceDay[];
  };
  events_30d: PerfChangeEvent[];
  weak_runs_7d: { mandala_id: string; created_at: string; cards: number; goal: string | null }[];
}

// Admin Pool Health — kept in sync with src/api/routes/admin/pool-health.ts
// (PoolHealthSnapshot) + src/config/pool-health.ts (POOL_HEALTH_THRESHOLDS).
export type PoolHealthStatus = 'ok' | 'warn' | 'critical' | 'na';

export interface PoolHealthMetric {
  key: string;
  label: string;
  value: number;
  unit: string;
  status: PoolHealthStatus;
  threshold: { ok: number; warn: number; direction: string };
}

export interface AdminPoolHealthResponse {
  generatedAt: string;
  fromCache: boolean;
  stale: boolean;
  metrics: PoolHealthMetric[];
  volume: {
    totals: {
      video_pool: number;
      youtube_videos: number;
      recommendation_cache: number;
    };
    daily30d: {
      video_pool: Array<{ day: string; n: number }>;
      youtube_videos: Array<{ day: string; n: number }>;
      recommendation_cache: Array<{ day: string; n: number }>;
    };
    derived: { videoPoolAvgDaily30d: number; videoPoolBlankDays30d: number };
  };
  enrich: {
    richSummaryV1: {
      total: number;
      covered: number;
      missing: number;
      pct: number;
      llmCovered: number;
      llmPct: number;
      fallbackCovered: number;
      fallbackPct: number;
    };
    richSummaryV2: {
      total: number;
      covered: number;
      missing: number;
      pct: number;
      modelBreakdown: Array<{ model: string; n: number }>;
    };
    embedding: { total: number; covered: number; missing: number; pct: number };
  };
  captionPipeline: {
    attemptedTotal: number;
    attempted7d: number;
    pass7d: number;
    fail7d: number;
    failRate7d: number;
    lastAttemptedAt: string | null;
    hoursSinceLastFire: number;
  };
  source: {
    youtube_videos: Array<{ source: string; n: number }>;
    video_pool: Array<{ source: string; n: number }>;
    derived: { userInflowPct: number; nullSourcePct: number };
  };
  reuse: {
    totalRecs30d: number;
    uniqueVideos30d: number;
    avgReusePerVideo: number;
    videosIn2PlusMandalas: number;
    videosIn2PlusUsers: number;
    reuse2PlusMandalaPct: number;
    top15: Array<{ video_id: string; mandalas: number; users: number; recs: number }>;
  };
  promote: {
    statusBreakdown: Array<{ status: string; n: number }>;
    surfacedAtPresent: number;
    surfacedAtPct: number;
    mandalasWithRecs: number;
    totalDistinctRecs: number;
    totalAutoOwned: number;
    promotePct: number;
  };
  knownIssues: ReadonlyArray<{ id: string; text: string }>;
}

export interface AdminPoolHealthDetailResponse {
  metric: string;
  generatedAt: string;
  rows: Array<Record<string, unknown>>;
  series?: Array<{ bucket: string; n: number }>;
  notes?: string;
}

/** Observability G2 — one candidate row in a search-trace Card Journey. */
export interface SearchTraceCandidateDTO {
  video_id: string;
  channel_id: string | null;
  channel_title: string | null;
  source_kind: string;
  source_cell_index: number | null;
  source_query_text: string | null;
  source_tier: string | null;
  stage_reached: string | null;
  decision: string;
  drop_reason: string | null;
  relevance_gc: number | null;
  ts_rank: number | null;
  cosine: number | null;
  llm_pick_score: number | null;
  llm_pick_reason: string | null;
  view_count: number | null;
  duration_sec: number | null;
  published_at: string | null;
  final_cell_level: number | null;
  final_cell_index: number | null;
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
  // Global Search (⌘K palette)
  // ========================================

  /**
   * Unified user-data search — cards / mandalas / notes / v2 summaries.
   * BE: GET /api/v1/search (src/api/routes/search.ts). All groups are
   * user-scoped server-side. Consumed by the ⌘K CommandPalette (PR-2).
   */
  async searchAll(q: string, limitPerGroup?: number): Promise<GlobalSearchResponse> {
    const limitParam = limitPerGroup ? `&limit=${limitPerGroup}` : '';
    return this.request<GlobalSearchResponse>(`/search?q=${encodeURIComponent(q)}${limitParam}`);
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
      // CP488+ Phase 4 — BE now returns 200 with `qualityFlag` for non-pass
      // rows (detection, not blocking). 404 means the row genuinely does
      // not exist; null lets callers show an empty state.
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

  /**
   * CP499 #3 — A-stage relevance trigger. Fired fire-and-forget by the Add Cards
   * panel on close (when ≥1 pick happened this session). Scores the mandala's
   * unscored placed cards via the SSOT (cellGoal-aware), idempotent. Errors are
   * swallowed by the caller's void pattern — never blocks the close UX.
   */
  async triggerMandalaRelevance(mandalaId: string): Promise<void> {
    await this.request<{ status: 'ok'; data: unknown }>(
      `/mandalas/${mandalaId}/relevance-trigger`,
      { method: 'POST', body: JSON.stringify({}) }
    );
  }

  /**
   * PR-T1 — v2 translations bulk trigger (card-add panel close). Enqueues one
   * debounced bulk-translate job for the mandala's off-language v2 atoms.
   * BE: POST /api/v1/mandalas/:id/translate-bulk. Fire-and-forget.
   */
  async translateMandalaBulk(mandalaId: string): Promise<void> {
    await this.request<{ status: 'ok'; data: unknown }>(`/mandalas/${mandalaId}/translate-bulk`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
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

  /**
   * Auto-save: update content_json. opts (PR3 regenerate) optionally rewrites
   * original_json + based_on_book_version in the same call — used when the note
   * is rebuilt from a newer book. Plain auto-save passes content_json only.
   */
  async updateNoteDocument(
    id: string,
    content_json: unknown,
    opts?: { original_json?: unknown; based_on_book_version?: number }
  ): Promise<NoteDocumentResponse> {
    const res = await this.request<{ success: boolean; data: { doc: NoteDocumentResponse } }>(
      `/note-documents/${id}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          content_json,
          ...(opts?.original_json !== undefined ? { original_json: opts.original_json } : {}),
          ...(opts?.based_on_book_version !== undefined
            ? { based_on_book_version: opts.based_on_book_version }
            : {}),
        }),
      }
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

  async getRichNote(
    cardId: string,
    sourceTable?: 'user_video_states' | 'user_local_cards'
  ): Promise<{ note: unknown; updatedAt: string } | null> {
    try {
      // CP501 — route read to the card's origin table (uvs vs ulc).
      const qs = sourceTable ? `?source=${sourceTable}` : '';
      return await this.request<{ note: unknown; updatedAt: string }>(`/rich-notes/${cardId}${qs}`);
    } catch {
      return null;
    }
  }

  async saveRichNote(
    cardId: string,
    note: unknown,
    sourceTable?: 'user_video_states' | 'user_local_cards'
  ): Promise<{ updatedAt: string }> {
    // CP501 — route write to the card's origin table so ulc notes persist
    // (previously uvs-only → ulc saves 404'd and were silently dropped).
    return this.request<{ updatedAt: string }>(`/rich-notes/${cardId}`, {
      method: 'PATCH',
      body: JSON.stringify({ note, sourceTable }),
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
  // ========================================
  // Closed Beta
  // ========================================

  /** Public closed-beta application (idempotent on duplicate emails). */
  async applyForBeta(email: string, goal?: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>('/beta/apply', {
      method: 'POST',
      body: JSON.stringify({ email, goal }),
    });
  }

  /** Public beta config — drives the /beta countdown and the signup gate. */
  async getBetaConfig(): Promise<{
    signupMode: 'open' | 'invite_only' | 'closed';
    phase: 'pre_launch' | 'running' | 'ended';
    window: { start: string; end: string };
  }> {
    return this.request('/beta/config', { method: 'GET' });
  }

  /** Whether an email may sign up under the current beta signup mode. */
  async checkBetaInvite(
    email: string
  ): Promise<{ allowed: boolean; mode: 'open' | 'invite_only' | 'closed' }> {
    return this.request('/beta/check-invite', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  // ── Admin: Beta campaign ──────────────────────────────

  /** Admin — list beta applications (optionally filtered by status). */
  async getBetaApplications(status?: string): Promise<{
    applications: Array<{
      id: string;
      email: string;
      goal: string | null;
      status: string;
      created_at: string;
      invited_at: string | null;
    }>;
    total: number;
  }> {
    const qs = status ? `?status=${encodeURIComponent(status)}` : '';
    return this.request(`/admin/beta-applications${qs}`, { method: 'GET' });
  }

  /** Admin — mark a beta application as invited (unlocks signup for that email). */
  async markBetaInvited(id: string): Promise<{ application: { id: string; status: string } }> {
    return this.request(`/admin/beta-applications/${encodeURIComponent(id)}/mark-invited`, {
      method: 'POST',
    });
  }

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
   * Trigger slide-deck DATA PREP for a mandala (③). Enqueues book-index +
   * segment-relevance fills (the verified #932/#933 contracts). Does NOT render
   * a deck — that is slidegen's job; this only readies the data.
   */
  async generateSlideDeck(mandalaId: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/mandalas/${mandalaId}/generate-deck`, {
      method: 'POST',
      // Empty `{}` body to satisfy the default `Content-Type: application/json`
      // — a body-less POST 400s with FST_ERR_CTP_EMPTY_JSON_BODY (see #935 prod).
      body: JSON.stringify({}),
    });
  }

  /** ③ deck lifecycle for the FE button (없음/생성중/완료+링크). */
  async getDeckStatus(mandalaId: string): Promise<{
    status: 'pending' | 'building' | 'done' | 'failed' | null;
    pptxUrl: string | null;
    generatedAt: string | null;
    error: string | null;
  }> {
    const res = await this.request<{
      success: boolean;
      data: {
        status: 'pending' | 'building' | 'done' | 'failed' | null;
        pptxUrl: string | null;
        generatedAt: string | null;
        error: string | null;
      };
    }>(`/mandalas/${mandalaId}/deck-status`);
    return res.data;
  }

  // (No openDeckPptx — pptx_url is a public Supabase Storage URL; the FE opens it
  // directly with window.open. getDeckStatus returns that URL.)

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

  async unlikeCard(
    videoId: string,
    opts: { mandalaId?: string; removeFromMandala?: boolean } = {}
  ): Promise<void> {
    // Empty `{}` body to satisfy the default `Content-Type: application/json`
    // header (request() always sets it). Fastify's JSON parser returns
    // 400 FST_ERR_CTP_EMPTY_JSON_BODY when Content-Type is application/json
    // but the body is empty — observed in dev with Bug 1 of #649 Phase 3.
    return this.request(`/cards/${videoId}/unlike`, {
      method: 'POST',
      body: JSON.stringify(opts),
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
      /** T2 (CP499+) — per-request language override for the EN-only search.
       *  'en' = this search fetches English cards only (한/영 chip).
       *  Absent = server falls back to the persisted config (DB-set mandalas). */
      searchLanguage?: 'ko' | 'en';
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
        /** CP504 — short noun-form TOC label; null on legacy/quick rows (FE falls back to oneLiner). */
        tocLabel: string | null;
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

  /** CP488+ — v2 Quality Audit admin endpoints (Phase 1 MVP). */
  async getAdminV2QualityAuditLatestRun(): Promise<{
    success: boolean;
    data: {
      run: {
        id: string;
        run_date: string;
        total_videos: number;
        pass_count: number;
        warning_count: number;
        critical_count: number;
        avg_score: number | null;
        by_model: Record<string, { count: number; avg_score: number }> | null;
        by_violation: Record<string, number> | null;
        started_at: string;
        completed_at: string | null;
        status: string;
      } | null;
    };
  }> {
    return this.request('/admin/v2-quality-audit/latest-run');
  }

  async getAdminV2QualityAuditCritical(params?: {
    page?: number;
    limit?: number;
    scoreMax?: number;
  }): Promise<{
    success: boolean;
    data: {
      run_date: string | null;
      items: Array<{
        video_id: string;
        title: string | null;
        overall_score: number;
        model: string | null;
        duration_seconds: number | null;
        violations: Array<{ metric: string; score: number; detail: string }> | null;
        created_at: string;
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
        hasPrev: boolean;
        hasNext: boolean;
      };
    };
  }> {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.scoreMax != null) query.set('scoreMax', String(params.scoreMax));
    const qs = query.toString() ? `?${query}` : '';
    return this.request(`/admin/v2-quality-audit/critical${qs}`);
  }

  async triggerAdminV2QualityAuditRun(): Promise<{
    success: boolean;
    data?: {
      summary: {
        runId: string;
        total: number;
        pass: number;
        warning: number;
        critical: number;
        avgScore: number;
        elapsedMs: number;
        enqueuedForRegen: number;
      };
    };
    error?: string;
    message?: string;
  }> {
    return this.request('/admin/v2-quality-audit/run-now', { method: 'POST' });
  }

  // ========================================
  // Admin Performance Monitor (diagnosis + manual markers)
  // ========================================

  async getAdminPerformanceDiagnosis(): Promise<AdminPerformanceDiagnosis> {
    const res = await this.request<{ success: boolean; data: AdminPerformanceDiagnosis }>(
      '/admin/performance/diagnosis',
      { timeoutMs: 30_000 }
    );
    return res.data;
  }

  async postAdminPerformanceEvent(body: {
    note: string;
    experiment?: 'candidate' | 'adopted' | 'reverted';
    experiment_criteria?: string;
  }): Promise<{ id: string; created_at: string }> {
    const res = await this.request<{ success: boolean; data: { id: string; created_at: string } }>(
      '/admin/performance/events',
      { method: 'POST', body: JSON.stringify(body) }
    );
    return res.data;
  }

  // ========================================
  // Admin Pool Health (5-section content pool dashboard)
  // ========================================

  async getAdminPoolHealth(refresh = false): Promise<AdminPoolHealthResponse> {
    return this.request<AdminPoolHealthResponse>(
      refresh ? '/admin/pool-health?refresh=1' : '/admin/pool-health'
    );
  }

  async getAdminPoolHealthDetail(metric: string): Promise<AdminPoolHealthDetailResponse> {
    return this.request<AdminPoolHealthDetailResponse>(
      `/admin/pool-health/details/${encodeURIComponent(metric)}`
    );
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

  // ========================================
  // Admin — Search Algorithm Versions (CP488)
  // ========================================
  // Observability G2 — Search-Trace Explorer (Card Journey debug view).
  // BE routes (super_admin only): src/api/routes/admin/search-trace-explorer.ts
  //   GET /admin/search-trace/recent?limit=&mandala_id=&trigger=
  //   GET /admin/search-trace/by-mandala/:mandalaId
  //   GET /admin/search-trace/journey/:traceId
  async getSearchTraceRecent(params?: {
    limit?: number;
    mandala_id?: string;
    trigger?: string;
  }): Promise<{
    count: number;
    traces: Array<{
      id: string;
      trace_id: string;
      mandala_id: string | null;
      user_id: string | null;
      trigger: string;
      started_at: string;
      finished_at: string | null;
      queries_generated: unknown;
      quota_units: number | null;
      queries_attempted: number | null;
      queries_succeeded: number | null;
      queries_failed: number | null;
      counts: Record<string, number> | null;
      outcome: Record<string, unknown> | null;
      algorithm_version: string | null;
      created_at: string;
    }>;
  }> {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.mandala_id) qs.set('mandala_id', params.mandala_id);
    if (params?.trigger) qs.set('trigger', params.trigger);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return this.request(`/admin/search-trace/recent${suffix}`);
  }

  async getSearchTraceJourney(traceId: string): Promise<{
    trace: Awaited<ReturnType<ApiClient['getSearchTraceRecent']>>['traces'][number];
    candidate_count: number;
    funnel: Array<{ decision: string; drop_reason: string | null; count: number }>;
    placed_by_cell: Array<{ cell: number; cards: SearchTraceCandidateDTO[] }>;
    candidates: SearchTraceCandidateDTO[];
    // Raw external-API request/response per step (full flow start→end).
    raw_steps: Array<{
      step: string;
      status: string;
      request: unknown;
      response: unknown;
      error_message: string | null;
      latency_ms: number | null;
      at: string;
    }>;
  }> {
    return this.request(`/admin/search-trace/journey/${encodeURIComponent(traceId)}`);
  }

  // Catalog of named search-algorithm rows (parameters as JSONB). Lets
  // super_admin flip the global default or apply a per-mandala override
  // without a code release; the v3 executor's `resolveAlgorithm` reads
  // each row fresh per run, so changes take effect on the next pipeline
  // invocation (no container restart, no env-var swap).
  //
  // BE routes (super_admin only via fastify.authenticateAdmin):
  //   GET    /admin/search-algorithms
  //   POST   /admin/search-algorithms
  //   PATCH  /admin/search-algorithms/:id
  //   PATCH  /admin/search-algorithms/mandala/:mandalaId  body {algorithm_version | null}
  //   DELETE /admin/search-algorithms/mandala/:mandalaId
  //   GET    /admin/search-algorithms/comparison/:mandalaId

  async listSearchAlgorithms(): Promise<{
    status: 'ok';
    data: {
      count: number;
      versions: Array<{
        id: string;
        display_name: string;
        description: string | null;
        parameters: Record<string, unknown>;
        is_active: boolean;
        created_at: string;
        created_by: string | null;
      }>;
    };
  }> {
    return this.request('/admin/search-algorithms');
  }

  async createSearchAlgorithm(body: {
    id: string;
    display_name: string;
    description?: string | null;
    parameters: Record<string, unknown>;
    is_active?: boolean;
  }): Promise<{ status: 'ok'; data: { id: string } }> {
    return this.request('/admin/search-algorithms', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async updateSearchAlgorithm(
    id: string,
    body: {
      display_name?: string;
      description?: string | null;
      parameters?: Record<string, unknown>;
      is_active?: boolean;
    }
  ): Promise<{ status: 'ok'; data: { id: string } }> {
    return this.request(`/admin/search-algorithms/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  /**
   * Set or clear a per-mandala override. `algorithm_version: null` falls back
   * to global active. Resolves to the matching DB row id on success.
   */
  async setMandalaAlgorithm(
    mandalaId: string,
    algorithmVersion: string | null
  ): Promise<{ status: 'ok'; data: { mandala_id: string; algorithm_version: string | null } }> {
    if (algorithmVersion === null) {
      return this.request(`/admin/search-algorithms/mandala/${encodeURIComponent(mandalaId)}`, {
        method: 'DELETE',
      });
    }
    return this.request(`/admin/search-algorithms/mandala/${encodeURIComponent(mandalaId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ algorithm_version: algorithmVersion }),
    });
  }

  async getAlgorithmComparison(mandalaId: string): Promise<{
    status: 'ok';
    data: {
      mandala_id: string;
      comparison: Array<{
        algorithm_version: string | null;
        run_count: number;
        avg_duration_ms: number | null;
        recent_run_at: string | null;
        total_cost: unknown;
      }>;
    };
  }> {
    return this.request(`/admin/search-algorithms/comparison/${encodeURIComponent(mandalaId)}`);
  }

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
