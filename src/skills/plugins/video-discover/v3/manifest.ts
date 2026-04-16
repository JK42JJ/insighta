/**
 * video-discover v3 — manifest
 *
 * Hybrid: Tier 1 (video_pool cache match) → Tier 2 (v2-style realtime
 * fallback for deficit cells only) → unified upsert to recommendation_cache.
 *
 * Coexists with v1 and v2 under different ids. Pipeline-runner selects
 * which version to call based on env flags (VIDEO_DISCOVER_V3 > V2 > v1).
 *
 * Design: docs/design/insighta-video-discover-3tier-handoff.md §6
 */

import type { SkillManifest } from '@/skills/_shared/types';
import { defineManifest } from '@/skills/_shared/runtime';

/**
 * Per-cell cap (not a target floor). With the 9-axis mandala filter,
 * the per-cell distribution is determined by how many relevant videos
 * actually exist for that sub_goal — it is not forced equal across
 * cells. Some cells may come up empty (niche sub_goal), others may
 * fill to this cap (mainstream sub_goal). 5 → 8 (2026-04-16): a larger
 * cap gives the filter room to reflect the natural distribution
 * instead of truncating popular cells.
 */
export const V3_TARGET_PER_CELL = 8;
export const V3_NUM_CELLS = 8;
/**
 * Upper bound on total slots across the mandala. Used by the executor
 * to decide when to skip Tier 2 (if Tier 1 alone hit this count). With
 * Tier 1 disabled, total filling is driven entirely by what the filter
 * admits from Tier 2, bounded per-cell by V3_TARGET_PER_CELL.
 */
export const V3_TARGET_TOTAL = V3_TARGET_PER_CELL * V3_NUM_CELLS; // 64

export const manifest: SkillManifest = defineManifest({
  id: 'video-discover-v3',
  version: '0.1.0',
  description:
    'Video recommendations via pre-collected cache (Tier 1) with realtime fallback for deficit cells (Tier 2).',
  layer: 'A',
  trigger: { type: 'event', event: 'mandala.created' },
  tiers: ['free', 'pro', 'lifetime', 'admin'],
  inputSchema: {
    type: 'object',
    properties: {
      mandalaId: { type: 'string' },
    },
    required: ['mandalaId'],
  },
  tables: {
    read: ['mandala_embeddings', 'user_mandalas', 'video_pool', 'video_pool_embeddings'],
    write: ['recommendation_cache'],
  },
  dependencies: [
    {
      name: 'youtube-data-api-search-key',
      env: 'YOUTUBE_API_KEY_SEARCH',
      required: true,
    },
  ],
  idempotent: true,
  maxConcurrentPerUser: 1,
});
