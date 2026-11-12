/**
 * User context (per-user ontology "context") — every weight and threshold in one place.
 *
 * Judgment rules (James-approved 2026-11):
 *   useful (좋아): concepts WANTS += LIKE_CONCEPT_DELTA (×WATCHED_BONUS when the watched ratio
 *                  reaches WATCHED_RATIO_BONUS_MIN), branch CONTAINS += LIKE_BRANCH_DELTA,
 *                  format/channel WANTS += LIKE_FORMAT_CHANNEL_DELTA.
 *   skip   (별로): concepts WANTS −= SKIP_CONCEPT_DELTA (floor WEIGHT_FLOOR), branch −= SKIP_BRANCH_DELTA,
 *                  format/channel WANTS −= SKIP_FORMAT_CHANNEL_DELTA; a target with ≥ AVOID_MIN_SKIPS
 *                  skips and ≤ AVOID_MAX_LIKES likes gets AVOIDS (created at AVOID_INITIAL_WEIGHT,
 *                  raised by AVOID_RAISE_DELTA on every further qualifying skip).
 *   pass   (넘김): JUDGED record only; no weight changes. The video is excluded from later batches.
 *
 * Level fit (draft): fit_d = (likes_d + P·[d=declared] + S) / (likes_d + dislikes_d + P·[d=declared] + 2S),
 * score term = LEVEL_FIT_WEIGHT × (fit − LEVEL_FIT_NEUTRAL). P = PRIOR_AT_DECLARED_LEVEL, S = PRIOR_SMOOTH.
 */

import type { JudgmentVerdict } from './types';

export const USER_CONTEXT_CONFIG = Object.freeze({
  // --- useful (좋아) ---
  LIKE_CONCEPT_DELTA: 1.0,
  WATCHED_RATIO_BONUS_MIN: 0.5,
  WATCHED_BONUS: 1.5,
  LIKE_BRANCH_DELTA: 0.2,
  LIKE_FORMAT_CHANNEL_DELTA: 0.5,

  // --- skip (별로) ---
  SKIP_CONCEPT_DELTA: 1.0,
  SKIP_BRANCH_DELTA: 0.2,
  SKIP_FORMAT_CHANNEL_DELTA: 0.5,
  AVOID_MIN_SKIPS: 2,
  AVOID_MAX_LIKES: 0,
  AVOID_INITIAL_WEIGHT: 1.0,
  AVOID_RAISE_DELTA: 1.0,

  /** WANTS / CONTAINS never go below this. */
  WEIGHT_FLOOR: 0,

  // --- scoring ---
  /** A candidate is excluded when any AVOIDS on its concept/format/channel is ≥ this. */
  AVOID_EXCLUDE: 1.0,
  /** Multiplier for AVOIDS weights below AVOID_EXCLUDE (subtracted from the score). */
  AVOID_PENALTY_WEIGHT: 1.0,
  CONCEPT_SCORE_WEIGHT: 1.0,
  BRANCH_MATCH_WEIGHT: 1.0,
  FORMAT_PREF_WEIGHT: 1.0,
  CHANNEL_PREF_WEIGHT: 1.0,

  // --- level fit (draft) ---
  PRIOR_AT_DECLARED_LEVEL: 2,
  PRIOR_SMOOTH: 1,
  LEVEL_FIT_WEIGHT: 2,
  LEVEL_FIT_NEUTRAL: 0.5,

  // --- search input ---
  SEARCH_MAX_SUB_GOALS: 3,
  SEARCH_MAX_FOCUS_TAGS: 3,

  // --- defaults for new graph elements ---
  DEFAULT_BRANCH_WEIGHT: 1.0,
  DEFAULT_COVER_WEIGHT: 1.0,
  RELEVANT_TO_WEIGHT: 1.0,
  JUDGED_EDGE_WEIGHT: 1.0,
  TAGGED_WITH_WEIGHT: 1.0,
  INITIAL_VERSION: 1,
  DEFAULT_RECENCY_DAYS: 0,

  // --- numeric hygiene ---
  /** Weights are rounded to this many decimals after each update (0.1 + 0.2 drift). */
  WEIGHT_DECIMALS: 4,
  /** Decimals used in the Korean ledger reasons. */
  REASON_DECIMALS: 2,
} as const);

/** Verdicts whose videos are not offered again (pass is required by the approved rule). */
export const EXCLUDE_JUDGED_VERDICTS: readonly JudgmentVerdict[] = Object.freeze([
  'useful',
  'skip',
  'pass',
]);

/** source_ref.table for nodes this module creates (user-scoped ids; never collides with v2-bridge). */
export const USER_CONTEXT_SOURCE_TABLE = 'user_context';

/** Ontology namespace for every node/edge written here. */
export const USER_CONTEXT_DOMAIN = 'service';

export const SNAPSHOT_SCHEMA = 'user-context-graph';
export const SNAPSHOT_SCHEMA_VERSION = 1;
