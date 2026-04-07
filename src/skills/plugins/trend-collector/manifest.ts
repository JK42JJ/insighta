/**
 * trend-collector — manifest
 *
 * Layer 1 of the trend-based video recommendation engine (#358).
 *
 * Phase 1 scope (CP352, blocker defaults B/C/B):
 *   - YouTube Trending only (Naver deferred to Phase 1.5)
 *   - 5 educational categories × 10 videos = 50 raw signals/day
 *   - YouTube Suggest disabled (quota safety, deferred to Phase 1.5)
 *   - Layer A in-process cron (Temporal deferred per architecture doc Q1)
 *
 * Authoritative spec: docs/design/insighta-skill-plugin-architecture.md §2, §3
 */

import type { SkillManifest } from '@/skills/_shared/types';
import { defineManifest } from '@/skills/_shared/runtime';

/**
 * YouTube category IDs we treat as "learning-relevant" trending sources.
 *
 * Selected for Phase 1 lean MVP (5 categories = 5 quota units/day for Trending).
 * Justification per category:
 *   27 — Education          : direct goal-relevance signal
 *   28 — Science & Tech     : highest IKS goal_relevance for tech mandalas
 *   26 — Howto & Style      : skill-acquisition surface (DIY, tutorials)
 *   25 — News & Politics    : current-events anchor for time-sensitive goals
 *   22 — People & Blogs     : broad creator economy signal
 *
 * Reference: https://developers.google.com/youtube/v3/docs/videoCategories/list
 */
export const TREND_COLLECTOR_DEFAULT_CATEGORY_IDS: readonly string[] = Object.freeze([
  '27',
  '28',
  '26',
  '25',
  '22',
]);

export const TREND_COLLECTOR_DEFAULT_REGION_CODE = 'KR';
export const TREND_COLLECTOR_MAX_RESULTS_PER_CATEGORY = 10;
export const TREND_COLLECTOR_TTL_DAYS = 7;

/**
 * trend_signals.source values produced by Phase 1.5a redesign.
 *
 * Phase 1 (deprecated): 'youtube_trending' — wrote whole video titles as keywords.
 * Phase 1.5a: two new sources, each producing real topic keywords.
 */
export const TREND_COLLECTOR_SOURCE_LLM = 'youtube_trending_extracted'; // primary
export const TREND_COLLECTOR_SOURCE_SUGGEST = 'youtube_suggest'; // secondary

/** Learning relevance gate — drop LLM-extracted keywords below this threshold. */
export const TREND_COLLECTOR_LEARNING_THRESHOLD = 0.3;

export const manifest: SkillManifest = defineManifest({
  id: 'trend-collector',
  version: '0.1.0',
  description:
    'Collect daily YouTube trending videos as raw trend signals (Phase 1 — educational categories only).',
  layer: 'A',
  trigger: { type: 'cron', schedule: '0 3 * * *' }, // 03:00 KST nightly
  tiers: ['free', 'pro', 'lifetime', 'admin'],
  inputSchema: {
    type: 'object',
    properties: {
      categoryIds: {
        type: 'array',
        items: { type: 'string' },
        description:
          'YouTube videoCategoryId list. Defaults to TREND_COLLECTOR_DEFAULT_CATEGORY_IDS when omitted.',
      },
      regionCode: {
        type: 'string',
        description: 'ISO 3166-1 alpha-2 region code. Defaults to KR.',
      },
      maxResultsPerCategory: {
        type: 'integer',
        minimum: 1,
        maximum: 50,
        description: 'YouTube maxResults per category. Defaults to 10.',
      },
    },
    required: [],
  },
  tables: {
    read: [],
    write: ['trend_signals'],
  },
  dependencies: [
    {
      name: 'youtube-data-api',
      env: 'YOUTUBE_API_KEY',
      required: true,
    },
    {
      // Mac Mini Ollama for LLM keyword extraction (Phase 1.5a primary).
      // Marked optional: executor falls back to Suggest-only if Mac Mini unreachable.
      // (Suggest is itself secondary — if BOTH fail the run is empty and returns 'failed'.)
      name: 'mac-mini-ollama-llama31',
      env: 'OLLAMA_URL',
      required: false,
    },
  ],
  idempotent: true, // upsert by (source, keyword, language) — safe to re-run
  maxConcurrentPerUser: 1,
});
