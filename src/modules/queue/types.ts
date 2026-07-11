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
  /** CP499+ pool-serve — async deficit-cell fill from the ko pool through the
   *  semantic relevance gate (video_mandala_relevance cache). One job per cell. */
  POOL_SERVE_FILL: 'pool-serve-fill',
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
  /**
   * W1' (CP499+) — guaranteed actions fill. Replaces the in-memory
   * fire-and-forget IIFE in mandala-post-creation (lost on restart, gone
   * after its single inline attempt). pg-boss persistence + retries keep the
   * absolute rule "missing actions ⇒ LLM-generate and store in DB" alive
   * across crashes/restarts. Worker = fillMissingActionsIfNeeded (idempotent:
   * 'skipped-full' on a no-op re-run).
   */
  MANDALA_ACTIONS_FILL: 'mandala-actions-fill',
  /**
   * Book-index fill (§2-D #1) — assemble a mandala's book_json from its placed
   * videos' v2 rich summaries (LLM-free, mechanical). Idempotent: re-run
   * overwrites book_json + bumps version. Worker = fillMandalaBook.
   */
  MANDALA_BOOK_FILL: 'mandala-book-fill',
  /**
   * v2 translations (PR-T1) — bulk-translate a mandala's off-language v2 atoms
   * into the mandala language. Triggered on card-add panel CLOSE (one job per
   * mandala, debounced). Dedup + global translations cache; OpenRouter Haiku.
   */
  TRANSLATE_MANDALA_BULK: 'translate-mandala-bulk',
  /**
   * Deck build (③ e2e) — assemble book_json + figures, call slidegen
   * /slides/build (job poll), store the returned presigned pptx_url in
   * slide_decks. Worker = handleDeckBuild.
   */
  DECK_BUILD: 'deck-build',
  /**
   * Segment-level relevance fill (§2-D #2) — score each rich-summary time
   * segment of a placed video against the mandala centerGoal (computeCardRelevance
   * reuse, mandala-keyed) and upsert video_mandala_segment_relevance. One job
   * per segment. relevance_pct comes ONLY from the scorer (no interpolation).
   */
  SEGMENT_RELEVANCE_FILL: 'segment-relevance-fill',
  /**
   * CP505 [CV-NOTE-WIRE] — note targeted visual CV enrich. Haiku detects figure
   * targets in the book's sections → /numerize extraction (cached) → filter
   * chart/table/diagram/equation → attach to section.figures (additive). Flag-gated
   * (VISUAL_CV_ENABLED=true) and inert when SNAPSHOT_SERVICE_TOKEN is unset (graceful []).
   */
  NOTE_CV_ENRICH: 'note-cv-enrich',
  /**
   * Observability Phase 2-A — daily 🔴 alarm when the active YouTube SEARCH key
   * pool exceeds the threshold (multi-key = ToS ban risk, M4: 8 keys). Counts
   * only; emails the operator when OBSERVABILITY_ALERT_EMAIL is set.
   */
  KEY_ALARM_SCAN: 'key-alarm-scan',
  /**
   * Observability Phase 2-B — daily rollup of the 5 quality axes + pool + quota
   * + funnel from the Phase 1 trail log into search_metrics_daily (one row/day).
   */
  SEARCH_METRICS_ROLLUP: 'search-metrics-rollup',
  /**
   * P0 (2026-07-10) — durable mandala post-creation VIDEO pipeline (embeddings
   * → discover → auto-add). Replaces the fire-and-forget setImmediate path that
   * died on container restart (deploy/redeploy/crash) → 0-card orphan runs.
   */
  MANDALA_PIPELINE: 'mandala-pipeline',
  /** Re-enqueues pipeline runs stuck at status=running (orphaned by restart). */
  MANDALA_PIPELINE_WATCHDOG: 'mandala-pipeline-watchdog',
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

/**
 * Segment-relevance fill (§2-D #2). Carries all scoring inputs + the table key
 * so the worker does one scorer call + one upsert, ZERO extra DB reads. Keyed
 * by (videoId, mandalaId, segmentIdx) → video_mandala_segment_relevance.
 * mandala-keyed = leak-safe (a mandala is single-user-owned, scored vs its own
 * centerGoal — the video-global segments[].relevance_pct cannot serve N mandalas).
 */
export interface SegmentRelevanceFillPayload {
  videoId: string;
  mandalaId: string;
  segmentIdx: number;
  fromSec: number;
  toSec: number;
  title: string;
  summary?: string;
  centerGoal: string;
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

/**
 * Segment-relevance fill: one Haiku scorer call + one upsert per segment.
 * Mirror the relevance-quick retry shape (transient provider errors retry once;
 * a missing title is a terminal skip, not a retry).
 */
export const SEGMENT_RELEVANCE_FILL_OPTIONS = {
  retryLimit: 1,
  expireInMinutes: 5,
} as const;

/** CP499+ pool-serve fill payload — one DEFICIT CELL per job. */
export interface PoolServeFillPayload {
  userId: string;
  mandalaId: string;
  cellIndex: number;
  /** The cell sub-goal (relevance judged cell-fit AND center contribution). */
  cellGoal: string;
  centerGoal: string;
  language: 'ko' | 'en';
  /** Pool tsquery for candidate recruitment (cell query from merged-gen / fanout). */
  cellQuery: string;
  /** How many cards this cell still needs (placed < minPerCell). */
  deficit: number;
  /** skill_runs row id recording this fill batch (FE fill-pending signal). */
  runId: string;
}

/**
 * Pool-serve fill — per-cell batch of gate-scored pool candidates. Worst case
 * ~12 Haiku calls in bursts; generous expiry, single retry (idempotent: the
 * uvs upsert keys on (user_id, videoId) and vmr caching makes a retry cheap).
 */
export const POOL_SERVE_FILL_RETRY_OPTIONS = {
  retryLimit: 1,
  expireInMinutes: 10,
} as const;

/**
 * Actions fill — one Haiku batch call (~20s observed worst case). 3 retries
 * with backoff: the job is the GUARANTEE layer for the absolute rule
 * "missing actions ⇒ generate and store", so transient LLM failures must not
 * leave a mandala permanently actions-less (the old inline IIFE did exactly
 * that after its single attempt).
 */
export const MANDALA_ACTIONS_FILL_OPTIONS = {
  retryLimit: 3,
  retryDelay: 30,
  retryBackoff: true,
  expireInMinutes: 10,
} as const;

export interface MandalaActionsFillPayload {
  mandalaId: string;
  userId?: string;
  trigger?: string;
}

/**
 * Mandala post-creation VIDEO pipeline — embeddings → discover → auto-add
 * (drives recommendation_cache). ~55s observed worst case (embeddings on Mac
 * Mini + discover + Haiku keyword gen). 2 retries with backoff so a transient
 * embedding/discover failure OR a container restart mid-run does not leave the
 * mandala at 0 cards — the exact durability guarantee the fire-and-forget
 * setImmediate path lacked (P0 incident 2026-07-10: restart 12s into a run →
 * orphaned status=running, no retry, 0 cards).
 */
export const MANDALA_PIPELINE_OPTIONS = {
  retryLimit: 2,
  retryDelay: 60,
  retryBackoff: true,
  expireInMinutes: 10,
} as const;

export interface MandalaPipelinePayload {
  mandalaId: string;
  userId: string;
  trigger?: string;
}

/**
 * Book-index fill — pure DB+assembly, no LLM. Retry on transient DB errors so a
 * triggered fill is not lost; the work is idempotent (version bump + overwrite).
 */
export const MANDALA_BOOK_FILL_OPTIONS = {
  retryLimit: 3,
  retryDelay: 30,
  retryBackoff: true,
  expireInMinutes: 10,
} as const;

export interface MandalaBookFillPayload {
  userId: string;
  mandalaId: string;
  trigger?: string;
}

/** PR-T1 — bulk-translate options. singletonKey is set per-mandala at enqueue. */
export const TRANSLATE_MANDALA_BULK_OPTIONS = {
  retryLimit: 2,
  retryDelay: 30,
  retryBackoff: true,
  expireInMinutes: 15,
} as const;

export interface TranslateMandalaBulkPayload {
  userId: string;
  mandalaId: string;
  trigger?: string;
}

// Deck build runs the full slidegen pipeline (minutes); allow a long expiry so
// pg-boss doesn't reap an in-flight build. Retry once — a failed build is more
// likely a real error (missing book / slidegen down) than a transient blip.
export const DECK_BUILD_OPTIONS = {
  retryLimit: 1,
  retryDelay: 30,
  retryBackoff: true,
  expireInMinutes: 15,
} as const;

export interface DeckBuildPayload {
  userId: string;
  mandalaId: string;
}

/**
 * CP505 [CV-NOTE-WIRE] — figure detection + extraction + section attachment.
 * Runs asynchronously after a successful book fill (VISUAL_CV_ENABLED gate).
 * Extraction is ~148s/ts; up to 8 targets (hard cap) per book run worst case.
 */
export interface NoteCvEnrichPayload {
  mandalaId: string;
  userId: string;
}

// Extraction can take ~148s per timestamp (up to 8 targets hard cap); generous
// expiry absorbs worst-case fan-out. Retry once for transient DB/network errors.
export const NOTE_CV_ENRICH_OPTIONS = {
  retryLimit: 1,
  retryDelay: 30,
  retryBackoff: true,
  expireInMinutes: 30,
} as const;

// ============================================================================
// Queue Configuration
// ============================================================================

export const QUEUE_CONFIG = {
  /** Batch scan schedule: every 30 minutes (cron) */
  BATCH_SCAN_CRON: '*/30 * * * *',
  /** Observability Phase 2-A key-count alarm: daily at 08:07 (off-hour). */
  KEY_ALARM_CRON: '7 8 * * *',
  /** Observability Phase 2-B daily metrics rollup: daily at 08:13 (off-hour). */
  SEARCH_METRICS_ROLLUP_CRON: '13 8 * * *',
  /** Orphaned-pipeline-run watchdog: every 10 minutes. */
  MANDALA_PIPELINE_WATCHDOG_CRON: '*/10 * * * *',
  /** A pipeline run stuck at status=running past this age is treated orphaned. */
  MANDALA_PIPELINE_STALE_MINUTES: 10,
  /**
   * Watchdog re-enqueue cap per mandala per 24h. #1149's supersede closes the
   * SAME-row loop, but a re-run that itself orphans (crash/restart mid-run)
   * creates a fresh 'running' row each cycle — an unbounded per-MANDALA chain
   * at one re-run per tick (the 7/10 dawn shape: new run every ~10min while
   * search.list 429'd). Watchdog re-enqueues carry trigger='watchdog'; once
   * that count reaches this cap in 24h the stale row is still closed out but
   * no new job is sent.
   */
  MANDALA_PIPELINE_WATCHDOG_MAX_RETRIES: 2,
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
