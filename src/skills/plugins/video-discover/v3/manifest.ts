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
// CP416 (2026-04-22) — product target revised 96 → **24 cards total**.
// User directive during live latency measurement: 템플릿 7s / AI custom
// 21s / dashboard 60s+ → "서비스 불가" 진단. 96-card target was the
// quadruple of what the first viewport (dashboard CardList PAGE_SIZE=24)
// actually renders, and the over-collection was amplifying downstream
// latency (more queries, more filter work, more upserts). 3/cell × 8
// cells = 24 aligns the pipeline target with actual UX consumption.
//
// Rollback: restore 12 and the matching V3_MAX_QUERIES=20 — both were
// the pre-CP416 post-CP391 tuning, no schema change required.
export const V3_TARGET_PER_CELL = 3;
export const V3_NUM_CELLS = 8;
/**
 * Upper bound on total slots across the mandala. Used by the executor
 * to decide when to skip Tier 2 (if Tier 1 alone hit this count). With
 * Tier 1 disabled, total filling is driven entirely by what the filter
 * admits from Tier 2, bounded per-cell by V3_TARGET_PER_CELL.
 */
export const V3_TARGET_TOTAL = V3_TARGET_PER_CELL * V3_NUM_CELLS; // 24

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
