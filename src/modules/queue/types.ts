/**
 * Job Queue Type Definitions
 *
 * Shared types for pg-boss job queue system.
 */

// ============================================================================
// Job Names (registry of all queue names)
// ============================================================================

export const JOB_NAMES = {
  ENRICH_VIDEO: 'enrich-video',
  BATCH_SCAN: 'batch-scan',
  /** CP462+ Issue #649 — Heart-click on-demand rich summary (direct enrichRichSummary). */
  ENRICH_RICH_SUMMARY: 'enrich-rich-summary',
  /**
   * CP489+ — fire-and-forget GHA trigger for the batch-video-collector skill.
   * The route returns 202 immediately; this worker runs the actual skill in
   * the background so prod nginx's 180s proxy_read_timeout cannot fail the
   * GitHub Actions step when limit=200 takes >180s.
   */
  BATCH_VIDEO_COLLECTOR_RUN: 'batch-video-collector-run',
  /**
   * CP494 — video_pool ToS hygiene (independent cron). Soft-expire + scrub of
   * stale YouTube metadata, decoupled from the collector success path. 0 quota.
   */
  POOL_MAINTENANCE_RUN: 'pool-maintenance-run',
  /**
   * CP498 PR3b — A-stage relevance backfill. One quick-Haiku score (0-100) per
   * user-scoped card ROW (user_video_states or user_local_cards). NOT
   * video-keyed: relevance is a relation (video × this row's centerGoal), so
   * the unit of work is the row, never the video. See
   * docs/handoffs/pr3-relevance-backfill-cp498.md.
   */
  ENRICH_RELEVANCE_QUICK: 'enrich-relevance-quick',
} as const;

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];

// ============================================================================
// Job Payloads
// ============================================================================

export interface EnrichVideoPayload {
  videoId: string;
  title: string;
  url: string;
  /** 'user' = high priority, 'batch' = normal */
  source: 'user' | 'batch';
  /**
   * CP423: opt-in rich summary generation after short summary completes.
   * Requires userId. Triggered only by createMandala card placement or
   * explicit user ADD endpoints (not by system/batch flows).
   */
  withRichSummary?: boolean;
  userId?: string;
}

export interface BatchScanPayload {
  /** Max videos to enqueue from scan */
  limit: number;
}

/**
 * CP462+ Issue #649 — payload for ENRICH_RICH_SUMMARY job.
 *
 * Triggered by the Heart click endpoint (POST /api/v1/cards/:videoId/like).
 * Calls enrichRichSummary() directly (NOT via enrichVideo wrapper) to bypass
 * the cache-hit-skip path documented in handoff §4.
 *
 * mandalaId is REQUIRED so the worker can compute mandala_relevance_pct
 * against the mandala's center_goal (v2 prompt update in Phase 2 step 3
 * will populate that column server-side).
 */
export interface EnrichRichSummaryPayload {
  videoId: string;
  userId: string;
  mandalaId: string;
  title: string;
  description?: string;
}

/**
 * CP489+ — payload for BATCH_VIDEO_COLLECTOR_RUN.
 *
 * Both fields are advisory: the executor reads
 * `BATCH_COLLECTOR_DAILY_KEYWORD_LIMIT` / `BATCH_COLLECTOR_RUN_TYPE`
 * from env. These let the GHA workflow_dispatch override per-run.
 */
export interface BatchVideoCollectorRunPayload {
  limit?: number;
  runType?: string;
  /** Source tag for logs (`gha-schedule`, `gha-dispatch`, `watchdog`, …). */
  trigger?: string;
}

/** CP494 — payload for POOL_MAINTENANCE_RUN. Source tag for logs only. */
export interface PoolMaintenanceRunPayload {
  trigger?: string;
}

/**
 * CP498 PR3b — payload for ENRICH_RELEVANCE_QUICK.
 *
 * Carries ALL scoring inputs so the worker does ZERO DB reads before its
 * single write. `rowId` is the PK of the user-scoped row
 * (UserVideoState.id for table='uvs', user_local_cards.id for table='ulc').
 * The fan-out unit is the ROW, never the video id — the same video placed in
 * two rows/cells gets two independent scores against each row's centerGoal, so
 * the score never collapses into a video attribute (= no cross-user leak).
 */
export interface RelevanceQuickPayload {
  table: 'uvs' | 'ulc';
  rowId: string;
  title: string;
  description?: string;
  centerGoal: string;
  /** CP499 — the card's cell sub-goal (`mandala.levels[0].subjects[cell_index]`).
   *  Forwarded to the SSOT `computeCardRelevance` so the score reflects cell-fit
   *  AND center contribution. Absent ⇒ centerGoal-only (back-compat). */
  cellGoal?: string;
}

// ============================================================================
// Job Options
// ============================================================================

/** Default retry config: 2 retries with exponential backoff */
export const DEFAULT_RETRY_OPTIONS = {
  retryLimit: 2,
  retryDelay: 30, // seconds
  retryBackoff: true, // exponential
} as const;

/** Enrichment-specific: longer delay, fewer retries (LLM rate limits) */
export const ENRICH_RETRY_OPTIONS = {
  retryLimit: 1,
  retryDelay: 60,
  retryBackoff: true,
  expireInMinutes: 10,
} as const;

/**
 * Heart-triggered rich summary — user is actively waiting (SSE-subscribed),
 * so fail fast: no retry, but expiry must cover the full Sonnet generation,
 * not just the quick path. CP462+ Issue #649.
 *
 * Timeout sized from prod-dev measurements (CP475+, 2026-05-20):
 *   completed jobs p95 = 87s, max = 90s
 *   pre-CP475 expireInMinutes=5 → 15% expired rate (3/20)
 *   10min = ~6.9× p95 headroom; absorbs LLM stalls / proxy hiccups
 *   without indefinitely tying up a worker slot.
 */
export const RICH_SUMMARY_RETRY_OPTIONS = {
  retryLimit: 0,
  expireInMinutes: 10,
} as const;

/** Batch scan: no retries (runs on schedule) */
export const BATCH_SCAN_OPTIONS = {
  retryLimit: 0,
  expireInMinutes: 5,
} as const;

/**
 * Batch video collector: no retries (the cron schedule itself is the retry
 * surface, plus the watchdog catches missed days). Expiry sized for prod
 * limit=200 worst-case (~6-8min observed pre-504 timeout) with generous
 * headroom for quota-key rotation stalls.
 */
export const BATCH_VIDEO_COLLECTOR_RUN_OPTIONS = {
  retryLimit: 0,
  expireInMinutes: 30,
} as const;

/**
 * Pool maintenance: no retries (daily cron is the retry surface). Two bounded
 * UPDATEs over video_pool — fast, but give headroom for a large scrub backlog.
 */
export const POOL_MAINTENANCE_RUN_OPTIONS = {
  retryLimit: 0,
  expireInMinutes: 10,
} as const;

/**
 * Relevance backfill — quick Haiku only (~1-3s), not interactive. Short expiry;
 * one retry absorbs a transient 429/5xx that slips past the OpenRouter backoff
 * (PR1 #864). A second failure (or no_title) is handled in the worker.
 */
export const RELEVANCE_QUICK_RETRY_OPTIONS = {
  retryLimit: 1,
  expireInMinutes: 5,
} as const;

// ============================================================================
// Queue Configuration
// ============================================================================

export const QUEUE_CONFIG = {
  /** Batch scan schedule: every 30 minutes (cron) */
  BATCH_SCAN_CRON: '*/30 * * * *',
  /** Max concurrent enrichment workers */
  ENRICH_CONCURRENCY: 1,
  /**
   * Concurrency ceiling for Heart-triggered rich-summary workers (CP462+
   * Issue #649). Independent pool from ENRICH_CONCURRENCY so batch backfill
   * cannot starve interactive Heart clicks.
   *
   * ⚠️ NOTE (CP498): this value is currently INERT. The worker registers with
   * `teamSize:1` and no `teamRefill`, so pg-boss fetches exactly one job per
   * poll and awaits it to completion before the next fetch — `teamConcurrency`
   * never engages (see enrich-rich-summary.ts + pg-boss manager.js fetch =
   * `teamSize - queueSize`). The CP475 "raised 5→10" change was therefore a
   * no-op. Activating real concurrency requires `teamSize:N` + `teamRefill:true`
   * at the registration site. There is NO env override despite older comments —
   * this is a plain literal.
   */
  RICH_SUMMARY_CONCURRENCY: 10,
  /** How long to keep completed jobs (days) */
  ARCHIVE_COMPLETED_AFTER_DAYS: 7,
  /** How long to keep failed jobs (days) */
  ARCHIVE_FAILED_AFTER_DAYS: 14,
} as const;
