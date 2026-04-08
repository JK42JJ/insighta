/**
 * Recommendation feed configuration constants.
 *
 * Sourced by:
 *  - src/api/routes/mandalas.ts (GET /:id/recommendations)
 *  - features/recommendation-feed (frontend mirrors limit via own config)
 *
 * recommendation_cache rows are produced by the video-discover skill plugin
 * (Phase 3, see src/skills/plugins/video-discover/executor.ts).
 */

/** Max items returned by GET /api/v1/mandalas/:id/recommendations. */
export const RECOMMENDATION_FETCH_LIMIT = 80;

/** Default cache row status considered "active" (not yet acted on or expired). */
export const RECOMMENDATION_DEFAULT_STATUS = 'pending' as const;

/**
 * Mode hint for the feed UI. user_mandalas does not yet persist auto/manual,
 * so we always emit 'auto' for Phase 4 — see CP356 plan, "auto_add 옵션 UI" carry-over.
 */
export const RECOMMENDATION_DEFAULT_MODE = 'auto' as const;

// ─── Auto-add (CP357) ─────────────────────────────────────────────────────
//
// CP357 lands the recommendation_cache → user_video_states selective-replace
// pipeline. Auto-add is opt-in via user_skill_config.config.auto_add (default
// true for new mandalas via the wizard fallback in src/api/routes/mandalas.ts).

/** Number of auto-recommended videos placed per cell on each refresh. */
export const AUTO_ADD_PER_CELL = 3;

/**
 * Default value used by the wizard fallback when a mandala is created
 * without an explicit video_discover skill entry. We default to ON+auto_add
 * so the user lands on the dashboard with a populated feed.
 */
export const VIDEO_DISCOVER_DEFAULT_ENABLED = true;
export const VIDEO_DISCOVER_DEFAULT_AUTO_ADD = true;

/** skill_type string used in user_skill_config (matches mandala-post-creation.ts). */
export const VIDEO_DISCOVER_SKILL_TYPE = 'video_discover';
