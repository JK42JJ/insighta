/**
 * Card-experiment ("track 2") constants — replay an externally collected
 * video list through the existing engine filters. Plain constants (not
 * secrets, not per-deploy tunables); edit here when the experiment sheet changes.
 */

/** Sheet assertion: minimum duration (seconds) for a card-grade video. */
export const EXPERIMENT_MIN_DURATION_SEC = 240;

/** Starting cosine cut for the best-cell relevance gate (= SEMANTIC_MIN_CELL_COSINE). */
export const RELEVANCE_COSINE_START = 0.25;

/** Max cards per (cell, channel) kept; the rest are flagged. */
export const CELL_CHANNEL_CAP = 2;

/** Flag recorded on cards dropped by the per-cell channel cap. */
export const CELL_CHANNEL_CAP_FLAG = 'channel_cap_2_per_cell';

/** Minimum Hangul / (Hangul + Latin) ratio for the language-rescue rule. */
export const KO_HANGUL_RATIO_MIN = 0.4;

/** Minimum Hangul syllables in the title for the language-rescue rule. */
export const KO_TITLE_MIN_HANGUL = 2;

/** Characters of description included (after title) in the Hangul ratio. */
export const KO_RATIO_TEXT_CHARS = 500;

/** defaultAudioLanguage values eligible for language rescue (lowercase). */
export const RESCUE_AUDIO_LANGS: readonly string[] = ['en', 'en-us', 'zxx'];

/** Characters of description appended to the title for relevance embedding. */
export const RELEVANCE_DESC_CHARS = 200;

/** YouTube contentRating.ytRating value marking age-restricted videos. */
export const YT_AGE_RESTRICTED = 'ytAgeRestricted';

/** liveBroadcastContent value of an ordinary (non-live, non-upcoming) video. */
export const LIVE_NONE = 'none';
