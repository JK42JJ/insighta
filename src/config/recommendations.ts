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

import { z } from 'zod';

/** Max items returned by GET /api/v1/mandalas/:id/recommendations. */
export const RECOMMENDATION_FETCH_LIMIT = 200;

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
//
// 2026-04-18: `AUTO_ADD_PER_CELL = 3` was removed. The upstream pipeline
// (mandala-filter + V3_TARGET_PER_CELL / V3_TARGET_TOTAL) already caps the
// per-cell count on its own; layering a second hard cap here produced
// visible "cards too sparse" UX on cells that had 4–8 legit candidates.
// auto-add now inserts every fresh recommendation_cache row into
// user_video_states (minus those already linked to this user's
// youtube_videos). Preservation of user-touched rows is unchanged.

/**
 * Default value used by the wizard fallback when a mandala is created
 * without an explicit video_discover skill entry. We default to ON+auto_add
 * so the user lands on the dashboard with a populated feed.
 */
export const VIDEO_DISCOVER_DEFAULT_ENABLED = true;
export const VIDEO_DISCOVER_DEFAULT_AUTO_ADD = true;

/** skill_type string used in user_skill_config (matches mandala-post-creation.ts). */
export const VIDEO_DISCOVER_SKILL_TYPE = 'video_discover';

// ─── Auto-add chokepoint guards (CP500+, 2026-06-15) ───────────────────────
//
// Two guards applied at the single auto-add confluence
// (src/modules/mandala/auto-add-recommendations.ts) that ALL automatic inflow
// (live 'realtime' + pool-serve + wizard inline) passes through. Diagnosis
// (mandala bdc5505f): the v5 live path bypasses the pool's view-count gate and
// metadata ingest, so 13/43 recs were <1k views (a 2-view scribble scored 65%)
// and 49/49 rows had metadata_fetched_at=NULL. /check [6w] chokepoint pattern.
//
// Both default to no-op (unset = prior behaviour) per CLAUDE.md config rule —
// merging is inert; flip via env after measurement + a [GO].
//
//   AUTO_ADD_MIN_VIEW_COUNT  view floor for AUTO-added cards. 0 = off (default).
//                            Recommended initial value: 1000 (= the batch
//                            collector's existing BRONZE floor; lower later via
//                            env). NULL view (enrich failed/absent) = fail-open.
//   AUTO_ADD_META_ENRICH     when true, synchronously calls
//                            collectAndUpsertMetadata() after youtube_videos
//                            rows are created so the view gate decides on
//                            authoritative counts. Sync is forced: the gate
//                            depends on the freshly-filled view_count, and
//                            metadata-collector is UPDATE-only (rows must exist).

const boolFlag = z.preprocess((v) => {
  if (v == null || v === '') return false;
  const s = String(v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}, z.boolean());

export const autoAddEnvSchema = z.object({
  AUTO_ADD_MIN_VIEW_COUNT: z.coerce.number().int().min(0).default(0),
  AUTO_ADD_META_ENRICH: boolFlag.default(false as unknown as string),
});

export interface AutoAddGuardConfig {
  /** Minimum view_count for AUTO-added cards. 0 disables the gate. */
  minViewCount: number;
  /** When true, enrich youtube_videos metadata synchronously before gating. */
  metaEnrich: boolean;
}

const AUTO_ADD_GUARD_FALLBACK: AutoAddGuardConfig = {
  minViewCount: 0,
  metaEnrich: false,
};

/**
 * Load the auto-add guard config from env. Read per-invocation (not at module
 * load) so a runtime env flip takes effect without a process restart and so
 * tests can set process.env before calling.
 */
export function loadAutoAddGuardConfig(env: NodeJS.ProcessEnv = process.env): AutoAddGuardConfig {
  const parsed = autoAddEnvSchema.safeParse({
    AUTO_ADD_MIN_VIEW_COUNT: env['AUTO_ADD_MIN_VIEW_COUNT'],
    AUTO_ADD_META_ENRICH: env['AUTO_ADD_META_ENRICH'],
  });
  if (!parsed.success) return AUTO_ADD_GUARD_FALLBACK;
  return {
    minViewCount: parsed.data.AUTO_ADD_MIN_VIEW_COUNT,
    metaEnrich: parsed.data.AUTO_ADD_META_ENRICH,
  };
}

/**
 * Pure view-count gate predicate (chokepoint). Exported for unit testing.
 *   - minViewCount <= 0      → no-op (everything passes; default)
 *   - viewCount null/undef   → fail-open (enrich failed or absent → pass)
 *   - else                   → pass iff viewCount >= minViewCount
 */
export function passesViewCountGate(
  viewCount: number | bigint | null | undefined,
  minViewCount: number
): boolean {
  if (minViewCount <= 0) return true;
  if (viewCount == null) return true;
  return Number(viewCount) >= minViewCount;
}
