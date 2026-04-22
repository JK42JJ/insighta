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
 * fill to this cap (mainstream sub_goal).
 *
 * History:
 *   - 5 (initial)
 *   - 5 → 8 (2026-04-16 PR #400): larger cap lets popular cells reflect
 *     their natural distribution instead of being truncated.
 *   - 8 → 12 (2026-04-18, recall-expansion PR): user report on niche
 *     domain mandala ("GraphDB 전문가") had only 17 total slots because
 *     the upstream query count (MAX_QUERIES = 12) produced a pool too
 *     small for popular cells to reach 8. Raising this in tandem with
 *     MAX_QUERIES 12→20 gives cells room to absorb the wider pool.
 */
export const V3_TARGET_PER_CELL = 12;
export const V3_NUM_CELLS = 8;
/**
 * Upper bound on total slots across the mandala. Used by the executor
 * to decide when to skip Tier 2 (if Tier 1 alone hit this count). With
 * Tier 1 disabled, total filling is driven entirely by what the filter
 * admits from Tier 2, bounded per-cell by V3_TARGET_PER_CELL.
 */
export const V3_TARGET_TOTAL = V3_TARGET_PER_CELL * V3_NUM_CELLS; // 96

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
