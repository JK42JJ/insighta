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

export const V3_TARGET_PER_CELL = 5;
export const V3_NUM_CELLS = 8;
export const V3_TARGET_TOTAL = V3_TARGET_PER_CELL * V3_NUM_CELLS; // 40

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
