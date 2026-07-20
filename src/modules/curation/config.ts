/**
 * Curation personalization constants (Growth Hub, 2026-07-20).
 * Design: docs/design/growth-hub-curation-personalized-2026-07-20.md (§4).
 *
 * Initial values are DOCUMENTED ASSUMPTIONS, not tuned. P1 exposes these via
 * admin/URL for measured tuning (no-hardcoding hard rule: named consts, single
 * source, flag-off = current behavior). Do NOT sprinkle these literals across
 * modules — import from here.
 */

/** Interest-signal weights (§4). Saved playlist videos = explicit intent → outrank subs. */
export const INTEREST_WEIGHTS = Object.freeze({
  /** subscribed channel = passive interest */
  sub: 0.4,
  /** playlist-saved video = explicit intent (higher) */
  save: 0.6,
});

/** Account-collection page caps (§2) — bound quota for power users. */
export const COLLECT_CAPS = Object.freeze({
  /** max subscription pages fetched (50 items/page) */
  subscriptionPages: 4,
  /** max playlist pages fetched */
  playlistPages: 2,
  /** max playlists whose items are read */
  playlists: 15,
  /** max item pages per playlist */
  playlistItemPages: 1,
  /** max saved videos whose titles are resolved via getVideosMetadata */
  savedVideos: 100,
});

/** 3-proposal scoring weights (§4). affinity dominates so cold-start reflects the account. */
export const PROPOSAL_WEIGHTS = Object.freeze({
  affinity: 0.45,
  rising: 0.3,
  reinforce: 0.2,
  redundancy: 0.15,
});

/** rising-signal half-life (days) for the recency component. */
export const RISING_HALFLIFE_DAYS = 14;

/** reinforcement increments derived from the proposal log (§5). α = selected, β = proposed-but-unselected. */
export const REINFORCE = Object.freeze({
  alpha: 0.2,
  beta: 0.05,
});

/** number of topics proposed to the user. */
export const PROPOSAL_COUNT = 3;

/** max proposals sharing one domain (filter-bubble guard, §4). */
export const MAX_PER_DOMAIN = 2;

/** min learning_score for an extracted keyword to enter the interest profile. */
export const KEYWORD_LEARNING_FLOOR = 0.3;

/** min relevance_pct for a discovered video to enter a curation feed (off-topic drop). */
export const CURATION_RELEVANCE_FLOOR = 40;

/** recency window (days) for the discovery leg's publishedAfter — the rising bias (§4-B5). */
export const CURATION_PUBLISHED_AFTER_DAYS = 365;
