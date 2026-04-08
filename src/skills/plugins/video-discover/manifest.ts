/**
 * video-discover — manifest (Phase 3, #358 / #361)
 *
 * Layer 3 of the trend-based video recommendation engine. Reads:
 *   - keyword_scores (Phase 2 IKS, embedding cache)
 *   - mandala_embeddings (per-user sub_goal vectors)
 *   - user_mandalas + youtube_sync_settings (OAuth token)
 *
 * Writes:
 *   - recommendation_cache (per user × mandala × video, with rec_score)
 *
 * Phase 3 design (CP352 user decisions):
 *   - Q1: keyword_scores.goal_relevance kept as GLOBAL signal. Phase 3 also
 *         computes per_mandala_relevance (cosine sim between this user's
 *         sub_goal embeddings and the keyword embedding) and stores it in
 *         recommendation_cache.trend_keywords JSONB for downstream tuning.
 *   - Q2: YouTube Search via USER OAuth token (Bearer) — burns the user's
 *         daily 10k quota, NOT Insighta's. Users without a connected YouTube
 *         account → preflight FAILS with a clear "Connect YouTube" reason.
 *
 * Quota math (per mandala creation):
 *   8 cells × 1 search.list call (100 units each) + 1 batch videos.list (1 unit)
 *   = 801 units per recommendation cycle
 *   = ~8% of the user's daily 10k quota
 *
 * Trigger:
 *   - manual (via API endpoint)
 *   - event 'mandala.created' (Phase 3.5 — wiring lands separately)
 */

import type { SkillManifest } from '@/skills/_shared/types';
import { defineManifest } from '@/skills/_shared/runtime';

/** Cells per mandala (8x8 mandalart, center excluded). */
export const VIDEO_DISCOVER_CELLS_PER_MANDALA = 8;
/** Recommendations stored per cell. */
export const VIDEO_DISCOVER_RECS_PER_CELL = 3;
/** Top N keyword candidates per cell to feed YouTube Search (1 = lean). */
export const VIDEO_DISCOVER_KEYWORDS_PER_CELL = 1;
/** maxResults parameter for YouTube search.list (10 = quota-efficient). */
export const VIDEO_DISCOVER_SEARCH_RESULTS_PER_CELL = 10;
/** TTL for recommendation_cache rows. Aligns with weekly refresh cycle. */
export const VIDEO_DISCOVER_TTL_DAYS = 7;
/** How many top keyword_scores rows to load into memory for cosine matching. */
export const VIDEO_DISCOVER_KEYWORD_POOL_SIZE = 200;
/**
 * Number of LLM-generated search queries per cell. Fix 2 (CP358) — replaces
 * the previous single sub_goal+keyword string. Quota math: 8 cells × 3 queries
 * × 100 units = 2,400 units per execute() = 24% of the user's daily 10k.
 * 3 is the safe upper bound; bumping to 5 would push a 4-mandala/day power
 * user over the daily limit.
 */
export const VIDEO_DISCOVER_QUERIES_PER_CELL = 3;

export const manifest: SkillManifest = defineManifest({
  id: 'video-discover',
  version: '0.1.0',
  description:
    "Match user mandala goals with trending learning keywords and surface YouTube videos via the user's own OAuth quota.",
  layer: 'A',
  trigger: { type: 'manual' },
  tiers: ['free', 'pro', 'lifetime', 'admin'],
  inputSchema: {
    type: 'object',
    properties: {
      mandala_id: {
        type: 'string',
        description:
          'Target mandala UUID. The skill will populate recommendation_cache for its 8 sub_goal cells.',
      },
    },
    required: ['mandala_id'],
  },
  tables: {
    read: ['user_mandalas', 'mandala_embeddings', 'keyword_scores', 'youtube_sync_settings'],
    write: ['recommendation_cache'],
  },
  // No env-level dependencies. The hard external dep is the user's OAuth
  // token, which lives in youtube_sync_settings (per-user, not env). Preflight
  // checks it and returns ok=false with a "Connect YouTube" reason if missing.
  idempotent: true, // upsert by (user_id, mandala_id, video_id)
  maxConcurrentPerUser: 1,
});
