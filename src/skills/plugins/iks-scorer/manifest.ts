/**
 * iks-scorer — manifest
 *
 * Layer 2 of the trend-based video recommendation engine (#358).
 *
 * Reads `trend_signals` (Layer 1, populated by trend-collector) and writes
 * the 6-axis Insighta Keyword Score into `keyword_scores`. The active
 * weight vector is read from `scoring_weights.active=true` so future
 * Layer 5 (recommendation-tuner) updates take effect without code changes.
 *
 * Phase 2a scope (CP352, blocker C = option A — Mac Mini Ollama):
 *   - search_demand        : computed from trend_signals.norm_score
 *   - learning_value       : computed from metadata.likeCount / view_count
 *   - competition          : 0.5 neutral placeholder (no channel_subs in Phase 1 metadata)
 *   - trend_velocity       : 0.5 neutral placeholder (Phase 1 has no historical batches)
 *   - content_performance  : 0.5 neutral placeholder (no growth-rate data)
 *   - goal_relevance       : 0.5 neutral placeholder (Phase 2b — requires keyword_embedding storage)
 *
 * Phase 2b (next unit) will:
 *   - decide keyword_embedding storage (new column on keyword_scores OR
 *     new table keyword_embeddings)
 *   - call Mac Mini Ollama nomic-embed-text via OllamaEmbeddingProvider
 *     (config.ollama.url = http://100.91.173.17:11434)
 *   - compute goal_relevance from cosine similarity to mandala sub_goal centroids
 *
 * Authoritative spec: docs/design/insighta-trend-recommendation-engine.md §4 (IKS 6-axis)
 *                     docs/design/insighta-skill-plugin-architecture.md §2, §3
 */

import type { SkillManifest } from '@/skills/_shared/types';
import { defineManifest } from '@/skills/_shared/runtime';

export const IKS_SCORER_TTL_DAYS = 7;
export const IKS_SCORER_NEUTRAL_PLACEHOLDER = 0.5;
/**
 * Default trend_signals.source filter.
 * Phase 1.5a: LLM extracted (primary) + Suggest (secondary). Both write to
 * trend_signals with different source values.
 */
export const IKS_SCORER_DEFAULT_SOURCES: readonly string[] = Object.freeze([
  'youtube_trending_extracted',
  'youtube_suggest',
]);

export const manifest: SkillManifest = defineManifest({
  id: 'iks-scorer',
  version: '0.1.0',
  description:
    'Compute Insighta Keyword Score (IKS) 6-axis from trend_signals and upsert into keyword_scores.',
  layer: 'A',
  // 15 min after trend-collector (which runs at 03:00 KST per trend-collector manifest).
  // Cron is metadata only at Phase 2 — actual scheduling lands in pg_cron later.
  trigger: { type: 'cron', schedule: '15 3 * * *' },
  tiers: ['free', 'pro', 'lifetime', 'admin'],
  inputSchema: {
    type: 'object',
    properties: {
      sources: {
        type: 'array',
        items: { type: 'string' },
        description:
          'trend_signals.source values to score. Defaults to IKS_SCORER_DEFAULT_SOURCES.',
      },
      language: {
        type: 'string',
        description:
          'Target language for trend_signals filter and keyword_scores write. Defaults ko.',
      },
    },
    required: [],
  },
  tables: {
    // Phase 2b adds mandala_embeddings for global centroid computation
    read: ['trend_signals', 'scoring_weights', 'mandala_embeddings'],
    write: ['keyword_scores'],
  },
  // Phase 2b: optional Mac Mini Ollama for goal_relevance.
  // Marked required=false → executor falls back to placeholder (0.5) if unreachable.
  // The default URL is hard-coded in embedding.ts (MAC_MINI_OLLAMA_DEFAULT_URL).
  dependencies: [
    {
      name: 'mac-mini-ollama-qwen3-embedding',
      env: 'OLLAMA_URL',
      required: false,
    },
  ],
  idempotent: true, // upsert by (keyword, language) — safe to re-run
  maxConcurrentPerUser: 1,
});
