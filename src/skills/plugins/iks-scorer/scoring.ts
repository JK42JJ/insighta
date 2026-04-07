/**
 * iks-scorer — pure scoring functions (one per IKS axis)
 *
 * Each function takes a trend_signal-shaped input and returns a number in
 * [0, 1]. They are pure (no DB, no fetch, no logger) so the unit tests are
 * trivial and the executor stays a thin orchestration layer.
 *
 * Authoritative spec: docs/design/insighta-trend-recommendation-engine.md §4
 */

import { IKS_SCORER_NEUTRAL_PLACEHOLDER } from './manifest';
import { cosineSimilarity, cosineToRelevance } from './embedding';

export interface SignalForScoring {
  keyword: string;
  raw_score: number; // typically view_count
  norm_score: number; // already min-max normalized within its source batch
  velocity: number; // 0 in Phase 1 (no historical comparison)
  metadata: Record<string, unknown> | null;
}

export interface IksWeights {
  search_demand: number;
  competition: number;
  trend_velocity: number;
  goal_relevance: number;
  learning_value: number;
  content_performance: number;
}

export interface IksAxes {
  search_demand: number;
  competition: number;
  trend_velocity: number;
  goal_relevance: number;
  learning_value: number;
  content_performance: number;
}

export interface IksResult extends IksAxes {
  iks_total: number;
}

// ============================================================================
// Pure axis functions
// ============================================================================

/**
 * search_demand — how much people are searching for this keyword.
 *
 * Phase 2a: pass through trend_signals.norm_score directly. The signal is
 * already min-max normalized within its source batch by trend-collector,
 * so values are already in [0, 1].
 *
 * Phase 1.5+ (Naver DataLab) will combine multiple sources here.
 */
export function computeSearchDemand(signal: SignalForScoring): number {
  return clamp01(signal.norm_score);
}

/**
 * competition — inverse of how saturated the keyword is on YouTube.
 *
 * Phase 2a: NEUTRAL placeholder. Computing the real value requires
 * `viewCount / channelSubscribers` for the top 10 videos, but
 * trend-collector Phase 1 metadata only stores videoId/channelId without
 * channelSubscribers (would need a separate channels.list API call per row,
 * adding +1 quota unit each — deferred).
 *
 * The 0.5 placeholder means "we know nothing" rather than "low competition".
 */
export function computeCompetition(_signal: SignalForScoring): number {
  return IKS_SCORER_NEUTRAL_PLACEHOLDER;
}

/**
 * trend_velocity — this week / last week ratio.
 *
 * Phase 2a: NEUTRAL placeholder. Phase 1 has no historical batches to
 * compare against — trend-collector started populating data this session.
 * After ~2 weeks of daily runs the field becomes computable.
 *
 * Until then, signal.velocity is also 0, which would skew this axis if
 * passed through. Returning 0.5 is more honest than 0.0.
 */
export function computeTrendVelocity(_signal: SignalForScoring): number {
  return IKS_SCORER_NEUTRAL_PLACEHOLDER;
}

/**
 * goal_relevance — semantic similarity between this keyword's embedding
 * and the global mandala centroid (averaged sub_goal embeddings).
 *
 * Phase 2b: real implementation.
 *   - keywordEmbedding: Qwen3-Embedding-8B vector for the keyword text
 *   - centroid:        averaged level=1 mandala_embeddings vector
 *   - returns:         cosine similarity mapped from [-1, 1] to [0, 1]
 *
 * If either input is missing (centroid load failed, embedding call failed),
 * returns the 0.5 neutral placeholder so the IKS pipeline still completes
 * end-to-end in degraded mode.
 *
 * Per-mandala goal_relevance (truly personalized) is the job of Phase 3
 * video-discover, which reads keyword_scores.embedding directly without
 * re-calling Mac Mini Ollama.
 */
export function computeGoalRelevance(
  keywordEmbedding: number[] | null,
  centroid: number[] | null
): number {
  if (!keywordEmbedding || !centroid) return IKS_SCORER_NEUTRAL_PLACEHOLDER;
  if (keywordEmbedding.length !== centroid.length) return IKS_SCORER_NEUTRAL_PLACEHOLDER;
  const cos = cosineSimilarity(keywordEmbedding, centroid);
  return cosineToRelevance(cos);
}

/**
 * learning_value — how valuable the content is for learning.
 *
 * Phase 2a heuristic: like_ratio (likes / views).
 * - YouTube average is ~4% — we treat 4% as the 0.5 anchor
 * - 8%+ → near 1.0 (community strongly endorses)
 * - 0% (likes hidden or zero) → 0.5 fallback (neutral, not penalized)
 *
 * Phase 2b+ enhancement (when available):
 *   - video duration sweet spot 10-30 min
 *   - chapter (description timestamps) presence
 *   - channel subscriber threshold (>10k = expert signal)
 */
export function computeLearningValue(signal: SignalForScoring): number {
  const meta = signal.metadata ?? {};
  const likeCount = (meta['likeCount'] as number | null | undefined) ?? null;
  const viewCount = signal.raw_score;

  // No like data → fall back to neutral. Hiding likes is a deliberate creator
  // choice; we don't penalize for it.
  if (likeCount === null || likeCount === undefined || viewCount <= 0) {
    return IKS_SCORER_NEUTRAL_PLACEHOLDER;
  }

  const ratio = likeCount / viewCount;
  // 0% → 0.0, 4% → 0.5, 8%+ → 1.0  (linear in [0, 0.08])
  const LIKE_RATIO_TOP = 0.08;
  return clamp01(ratio / LIKE_RATIO_TOP);
}

/**
 * content_performance — outlier score (view/subs) + growth rate proxy.
 *
 * Phase 2a: NEUTRAL placeholder. Computing the real value needs:
 *   - channel_subscribers (NOT in Phase 1 metadata)
 *   - viewCount snapshots over time (NOT in Phase 1 — only "now" view)
 *
 * Phase 1.5+ enhancement: trend-collector adds channels.list to capture
 * channel_subs in metadata; IKS-scorer then computes outlier_score =
 * view_count / channel_subs.
 */
export function computeContentPerformance(_signal: SignalForScoring): number {
  return IKS_SCORER_NEUTRAL_PLACEHOLDER;
}

// ============================================================================
// Aggregate
// ============================================================================

/**
 * Compute all 6 axes for a single trend_signal.
 *
 * Phase 2b adds optional embedding context for the goal_relevance axis.
 * When `keywordEmbedding` and `centroid` are both provided, goal_relevance
 * is computed via cosine similarity. Otherwise the 0.5 neutral placeholder
 * is used (degraded mode).
 *
 * The axes are deliberately computed individually (rather than inlined) so
 * the unit tests can assert each one independently and so future axis
 * upgrades (e.g. real competition) only touch one function.
 */
export function computeAxes(
  signal: SignalForScoring,
  embeddingCtx?: { keywordEmbedding: number[] | null; centroid: number[] | null }
): IksAxes {
  return {
    search_demand: computeSearchDemand(signal),
    competition: computeCompetition(signal),
    trend_velocity: computeTrendVelocity(signal),
    goal_relevance: computeGoalRelevance(
      embeddingCtx?.keywordEmbedding ?? null,
      embeddingCtx?.centroid ?? null
    ),
    learning_value: computeLearningValue(signal),
    content_performance: computeContentPerformance(signal),
  };
}

/**
 * Weighted sum of the 6 axes using the active scoring_weights row.
 *
 * Returned as iks_total in [0, 100] to match the design doc. The keyword_scores
 * schema expects iks_total: Float — we keep two decimal places for stability.
 */
export function computeIksTotal(axes: IksAxes, weights: IksWeights): number {
  const sum =
    axes.search_demand * weights.search_demand +
    axes.competition * weights.competition +
    axes.trend_velocity * weights.trend_velocity +
    axes.goal_relevance * weights.goal_relevance +
    axes.learning_value * weights.learning_value +
    axes.content_performance * weights.content_performance;

  // Convert to 0-100 scale for design doc compatibility, round to 2 decimals
  return Math.round(sum * 100 * 100) / 100;
}

export function computeIksResult(
  signal: SignalForScoring,
  weights: IksWeights,
  embeddingCtx?: { keywordEmbedding: number[] | null; centroid: number[] | null }
): IksResult {
  const axes = computeAxes(signal, embeddingCtx);
  return {
    ...axes,
    iks_total: computeIksTotal(axes, weights),
  };
}

// ============================================================================
// Helpers
// ============================================================================

function clamp01(n: number): number {
  if (Number.isNaN(n) || !Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
