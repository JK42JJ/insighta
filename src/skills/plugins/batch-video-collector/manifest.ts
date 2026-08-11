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
 * Full trend keyword pool target. CP489 expansion: 180 → 600 (200 keywords
 * × 3-day rotation). Probe-verified video_pool baseline 2026-05-28:
 *   - active rows: 14,551
 *   - last 14d avg videos_new/day: 464
 *   - quota/day used: 6,035 of 80,000 available (8 API keys × 10k)
 * 200/day × 100 units = 20k quota/day still safely under the headroom,
 * even when paired with the 2×/day cron schedule (40k total).
 */
export const BATCH_COLLECTOR_KEYWORD_POOL_SIZE = 600;
/**
 * Keywords processed per daily run. CP489: 60 → 200. With the 2×/day
 * cron schedule (07:30 + 19:30 UTC) net raw new ≈ 1,856/day vs prior
 * 464/day. Combined with the TTL bump below the steady-state pool size
 * targets ≥ 30,000 active rows within ~30 days.
 */
export const BATCH_COLLECTOR_DAILY_KEYWORD_LIMIT = 200;
/** Cycle length (days) — 200 × 3 covers the 600-keyword pool. */
export const BATCH_COLLECTOR_ROTATION_DAYS = 3;
/** Kept for backwards compat with existing tests / callers. */
export const BATCH_COLLECTOR_KEYWORD_LIMIT = BATCH_COLLECTOR_DAILY_KEYWORD_LIMIT;
export const BATCH_COLLECTOR_SEARCH_MAX_RESULTS = 30;
export const BATCH_COLLECTOR_SEARCH_PARALLELISM = 5;
/**
 * CP489: 30 → 60. Doubles steady-state pool size at the same raw-new
 * rate. video_pool already partitions by language + quality_tier + source,
 * so older rows continue to provide useful coverage long after the
 * trend-cron horizon. Soft-delete via is_active=false still happens
 * on expires_at, so the change does not affect retrieval correctness.
 */
export const BATCH_COLLECTOR_TTL_DAYS = 60;

/**
 * Freshness window in days for search.list `publishedAfter`.
 *
 * 0 = do not send the parameter, which is what every run before 2026-08-11
 * did. The pool shows the cost of that: of the rows still active, 94 were
 * published in the last 30 days and 316 are more than a year old, so a
 * "this week" curation deck had nothing recent to pick from and surfaced
 * videos four to nine years old. The 2026-08-04 pilot stored 121 videos and
 * not one of them was from the last 30 days.
 *
 * Set BATCH_COLLECTOR_FRESH_DAYS to a positive number to bound the window.
 * Unset keeps the old behaviour so this ships dark and rolls back by
 * clearing the variable — no code revert.
 */
export const BATCH_COLLECTOR_FRESH_DAYS_DEFAULT = 0;
/** Upper bound on the window; beyond a year "fresh" stops meaning anything. */
export const BATCH_COLLECTOR_FRESH_DAYS_MAX = 365;
/**
 * search.list `order`. YouTube defaults to relevance, and the client drops
 * the parameter when it equals 'relevance', so this default is also a no-op.
 * 'date' returns newest-first within the window.
 */
export const BATCH_COLLECTOR_SEARCH_ORDER_DEFAULT: 'relevance' | 'viewCount' | 'date' = 'relevance';

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
