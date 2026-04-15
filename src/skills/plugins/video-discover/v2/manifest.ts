/**
 * video-discover v2 — manifest
 *
 * Same skill family as v1 but with a distinct id so both can coexist
 * during the gradual cutover (env flag `VIDEO_DISCOVER_V2=1` in
 * pipeline-runner picks the executor).
 *
 * Differences vs v1 manifest:
 *   - id: 'video-discover-v2' (separate registry entry)
 *   - description rewritten (server API key, no OAuth)
 *   - tables.read drops `youtube_sync_settings` (no OAuth path)
 */

import type { SkillManifest } from '@/skills/_shared/types';
import { defineManifest } from '@/skills/_shared/runtime';

/** Hard targets (matches v2/cell-assigner constants). */
export const V2_TARGET_PER_CELL = 5;
export const V2_NUM_CELLS = 8;
export const V2_TARGET_TOTAL = V2_TARGET_PER_CELL * V2_NUM_CELLS; // 40

export const manifest: SkillManifest = defineManifest({
  id: 'video-discover-v2',
  version: '0.2.0',
  description:
    'v2: One-shot mandala-level search via server API key. Embedding-based cell assignment. ' +
    'Targets 40 cards (5 per cell × 8 cells). No user OAuth.',
  layer: 'A',
  trigger: { type: 'manual' },
  tiers: ['free', 'pro', 'lifetime', 'admin'],
  inputSchema: {
    type: 'object',
    properties: {
      mandala_id: {
        type: 'string',
        description:
          'Target mandala UUID. Populates recommendation_cache for its 8 sub_goal cells.',
      },
    },
    required: ['mandala_id'],
  },
  tables: {
    read: ['user_mandalas', 'mandala_embeddings'],
    write: ['recommendation_cache'],
  },
  idempotent: true,
  maxConcurrentPerUser: 1,
});
