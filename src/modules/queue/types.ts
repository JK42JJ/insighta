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
}

export interface BatchScanPayload {
  /** Max videos to enqueue from scan */
  limit: number;
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

/** Batch scan: no retries (runs on schedule) */
export const BATCH_SCAN_OPTIONS = {
  retryLimit: 0,
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
  /** Delay between polling for new jobs (seconds) */
  POLL_INTERVAL_SECONDS: 10,
  /** How long to keep completed jobs (days) */
  ARCHIVE_COMPLETED_AFTER_DAYS: 7,
  /** How long to keep failed jobs (days) */
  ARCHIVE_FAILED_AFTER_DAYS: 14,
} as const;
