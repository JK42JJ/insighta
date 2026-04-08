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
