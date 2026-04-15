/**
 * batch-video-collector — manifest
 *
 * Phase 2 / PR2 scope (Source A only): pull trend keywords from
 * `trend_signals`, run YouTube search per keyword, quality-gate, embed
 * with Qwen3-Embedding-8B, upsert into `video_pool` + `video_pool_embeddings`
 * + `video_pool_domain_tags`. Log run stats to `video_pool_collection_runs`.
 *
 * Sources B (popular user goals) and C (refresh) come in PR3.
 *
 * Design: docs/design/insighta-video-cache-layer-design.md §4
 * Plan:   /Users/jeonhokim/.claude/plans/linked-beaming-mccarthy.md
 */

import type { SkillManifest } from '@/skills/_shared/types';
import { defineManifest } from '@/skills/_shared/runtime';

/**
 * Full trend keyword pool target (9 domains × ~20). Source of truth for
 * the *total* surface area we want covered across a rotation cycle.
 */
export const BATCH_COLLECTOR_KEYWORD_POOL_SIZE = 180;
/**
 * Keywords processed per daily run. 180/3 = 60 keeps each day's quota
 * under 6k units (60 × 100 search.list) + ~200 for videos.list, fitting
 * comfortably in the 10k/day limit while still refreshing the full pool
 * every 3 days.
 */
export const BATCH_COLLECTOR_DAILY_KEYWORD_LIMIT = 60;
/** Cycle length (days) — 60 × 3 covers the 180-keyword pool. */
export const BATCH_COLLECTOR_ROTATION_DAYS = 3;
/** Kept for backwards compat with existing tests / callers. */
export const BATCH_COLLECTOR_KEYWORD_LIMIT = BATCH_COLLECTOR_DAILY_KEYWORD_LIMIT;
export const BATCH_COLLECTOR_SEARCH_MAX_RESULTS = 30;
export const BATCH_COLLECTOR_SEARCH_PARALLELISM = 5;
export const BATCH_COLLECTOR_TTL_DAYS = 30;

// Quality tier thresholds (view_count)
export const QUALITY_GOLD_VIEW_COUNT = 100_000;
export const QUALITY_SILVER_VIEW_COUNT = 10_000;
export const QUALITY_BRONZE_VIEW_COUNT = 1_000;

// Duration gate (seconds)
export const MIN_DURATION_SEC = 60;
export const MAX_DURATION_SEC = 3600;

export const manifest: SkillManifest = defineManifest({
  id: 'batch-video-collector',
  version: '0.1.0',
  description:
    'Daily batch that pre-collects high-quality YouTube videos for the Tier 1 cache of video-discover v3.',
  layer: 'A',
  trigger: { type: 'cron', schedule: '0 4 * * *' }, // metadata only — GHA triggers
  tiers: ['admin'],
  inputSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 500,
        description:
          'Max trend keywords to process in this run. Defaults to 180. Dev runs use --limit=5.',
      },
      runType: {
        type: 'string',
        enum: ['daily_trend', 'popular_goals', 'refresh'],
        description: 'Source type — PR2 only supports daily_trend.',
      },
    },
    required: [],
  },
  tables: {
    read: ['trend_signals'],
    write: [
      'video_pool',
      'video_pool_embeddings',
      'video_pool_domain_tags',
      'video_pool_collection_runs',
    ],
  },
  dependencies: [
    {
      name: 'youtube-data-api-search-key',
      env: 'YOUTUBE_API_KEY_SEARCH',
      required: true,
    },
    {
      // Mac Mini Ollama for Qwen3-Embedding-8B. Optional: if unreachable we
      // still upsert video_pool + domain_tags and skip the embeddings row.
      // The collector can backfill embeddings in a future run.
      name: 'mac-mini-ollama-qwen3',
      env: 'OLLAMA_URL',
      required: false,
    },
  ],
  idempotent: true, // upsert by video_id — re-running is safe
  maxConcurrentPerUser: 1,
});
