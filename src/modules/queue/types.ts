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

// ============================================================================
// Queue Configuration
// ============================================================================

export const QUEUE_CONFIG = {
  /** Batch scan schedule: every 30 minutes (cron) */
  BATCH_SCAN_CRON: '*/30 * * * *',
  /** Max concurrent enrichment workers */
  ENRICH_CONCURRENCY: 1,
  /**
   * Max concurrent Heart-triggered rich-summary workers. CP462+ Issue #649.
   * Independent pool from ENRICH_CONCURRENCY so batch backfill cannot starve
   * interactive Heart clicks. Override via BULLMQ_ENRICH_CONCURRENCY env
   * (legacy name retained for compatibility even though pg-boss replaced BullMQ).
   *
   * CP475+ — raised 5 → 10 after the 2026-05-20 user report that liking 6
   * cards in quick succession felt serial. p95 v2 job = 87s (CP475 measurement);
   * 10 workers absorb a 6-10 card burst without blocking. Sonnet/OpenRouter
   * tier headroom checked against the wizard path, which keeps its own quota.
   */
  RICH_SUMMARY_CONCURRENCY: 10,
  /** Delay between polling for new jobs (seconds) */
  POLL_INTERVAL_SECONDS: 10,
  /** How long to keep completed jobs (days) */
  ARCHIVE_COMPLETED_AFTER_DAYS: 7,
  /** How long to keep failed jobs (days) */
  ARCHIVE_FAILED_AFTER_DAYS: 14,
} as const;
