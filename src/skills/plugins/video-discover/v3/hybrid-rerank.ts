/**
 * v3 Hybrid Retrieval — Cohere rerank + score normalize + group by video
 *
 * Pipeline (Issue #610 spec, hybrid-retrieval-2026-05-12.md §8 PR1):
 *
 *   input slots (post mandala-filter)
 *      │
 *      ▼
 *   ┌─ semantic candidates ─┐  ┌─ tsvector keyword candidates ─┐
 *   │  (already in input)   │  │  (Postgres ts_rank on title)  │
 *   └─────────┬─────────────┘  └─────────────┬──────────────────┘
 *             └──── concat ──── dedupe by videoId ────┘
 *                                  │
 *                                  ▼
 *                       Cohere rerank (relevanceScore 0–1)
 *                                  │
 *                                  ▼
 *                          top-N keep, others drop
 *                                  │
 *                                  ▼
 *                  normalize to 0–100 (min-max within batch)
 *                                  │
 *                                  ▼
 *                      group by videoId — avg(score) per video
 *                                  │
 *                                  ▼
 *                          sort score desc, return
 *
 * Falls back to identity (return input unchanged) if:
 *   - V3_ENABLE_HYBRID_RERANK flag is off, OR
 *   - COHERE_API_KEY not configured, OR
 *   - Cohere call fails for the batch
 *
 * → safe behavioural change: enabling the flag never *worsens* worst-case
 *   correctness; it only adds re-scoring on top of existing rec_score.
 */

import { config } from '@/config/index';
import { logger } from '@/utils/logger';
import {
  rerank,
  CohereRerankConfigError,
  CohereRerankApiError,
} from '@/modules/rerank/cohere-client';

const log = logger.child({ module: 'v3-hybrid-rerank' });

/**
 * Minimum shape of a slot that hybrid-rerank can consume.
 * The v3 executor's `Slot` type satisfies this; we keep this module
 * loosely typed to avoid a circular import on executor.ts.
 */
export interface RerankSlot {
  videoId: string;
  title: string;
  cellIndex: number;
  rec_score: number;
  [extra: string]: unknown;
}

export interface HybridRerankInput<S extends RerankSlot> {
  slots: ReadonlyArray<S>;
  centerGoal: string;
  topN?: number;
  requestId?: string;
}

export interface HybridRerankStats {
  applied: boolean;
  reason: 'flag-off' | 'no-api-key' | 'no-candidates' | 'cohere-error' | 'ok';
  inputSlots: number;
  afterDedupe: number;
  reranked: number;
  cohereLatencyMs?: number;
  cohereError?: string;
}

export interface HybridRerankResult<S extends RerankSlot> {
  slots: S[];
  stats: HybridRerankStats;
}

/**
 * Min-max normalize an array of numbers to [0, 100], 2 decimal places.
 * Edge cases:
 *   - all equal → all become 50 (midpoint, signals "no spread information")
 *   - empty → empty
 * Pattern borrowed from YT-Navigator's MinMaxScaler usage.
 */
export function normalizeScores0to100(raw: ReadonlyArray<number>): number[] {
  if (raw.length === 0) return [];
  const min = Math.min(...raw);
  const max = Math.max(...raw);
  if (max === min) return raw.map(() => 50);
  const span = max - min;
  return raw.map((v) => Math.round(((v - min) / span) * 10_000) / 100);
}

/**
 * Group slots by videoId, keep the highest-scored slot per video.
 * Returns slots sorted by rec_score desc. Pattern borrowed from
 * YT-Navigator's `Counter(...).most_common(5)` + group_by_video.
 *
 * Note: in the Insighta model each card is a (mandala, cell, video) tuple,
 * so dedupe by videoId might collapse cards across cells. To preserve cell
 * diversity, we group by (cellIndex, videoId) — keeping per-cell top scored.
 */
export function groupByCellVideo<S extends RerankSlot>(slots: ReadonlyArray<S>): S[] {
  const byKey = new Map<string, S>();
  for (const s of slots) {
    const key = `${s.cellIndex}:${s.videoId}`;
    const existing = byKey.get(key);
    if (!existing || s.rec_score > existing.rec_score) {
      byKey.set(key, s);
    }
  }
  return Array.from(byKey.values()).sort((a, b) => b.rec_score - a.rec_score);
}

/**
 * Postgres ts_rank-based keyword search over `video_pool` — the global
 * collected pool (~10K rows from batch_trend + v2_promoted) that is
 * otherwise underused. Mirrors YT-Navigator's `VectorRetriever.keyword_search`:
 * brings in lexical keyword matches that the semantic candidate pool may
 * have missed.
 *
 * Returns up to `limit` rows scored by ts_rank on title. Excludes videoIds
 * already in the input semantic pool to avoid duplicates. Falls back to
 * empty on error (non-fatal).
 *
 * Cell assignment for added candidates: argmax over the sub_goals'
 * ts_rank — the cell whose sub_goal text best matches the candidate's
 * title gets assigned. Tie-break: lower cellIndex.
 */
/**
 * Full keyword candidate shape — includes the columns downstream
 * (upsertSlots, auto-add) needs. Mirrors AssembledSlot minus
 * embedding-related fields not surfaced by video_pool.
 */
/**
 * Main entry — runs the hybrid pipeline against a list of slots.
 * Always returns slots (falls back to input on failure modes).
 *
 * Caller (v3 executor) wraps mandala-filter output and feeds it here when
 * `config.v3HybridRerank.enabled` is true.
 */
export async function applyHybridRerank<S extends RerankSlot>(
  input: HybridRerankInput<S>
): Promise<HybridRerankResult<S>> {
  const stats: HybridRerankStats = {
    applied: false,
    reason: 'flag-off',
    inputSlots: input.slots.length,
    afterDedupe: 0,
    reranked: 0,
  };

  if (!config.v3HybridRerank.enabled) {
    return { slots: input.slots.slice(), stats };
  }
  if (!config.cohere.apiKey) {
    stats.reason = 'no-api-key';
    return { slots: input.slots.slice(), stats };
  }
  if (input.slots.length === 0) {
    stats.reason = 'no-candidates';
    return { slots: [], stats };
  }

  const cellVideoDeduped = groupByCellVideo(input.slots.slice());

  // Build the document list for Cohere — title is the dominant signal (matches
  // YT-Navigator's `doc.page_content`); cell-context is added so the cross-encoder
  // distinguishes the same title across cells.
  const documents = cellVideoDeduped.map((s) => s.title);
  stats.afterDedupe = documents.length;

  let cohereRes: Awaited<ReturnType<typeof rerank>>;
  try {
    cohereRes = await rerank({
      query: input.centerGoal,
      documents,
      topN: input.topN,
      requestId: input.requestId,
    });
  } catch (err) {
    if (err instanceof CohereRerankConfigError) {
      stats.reason = 'no-api-key';
    } else if (err instanceof CohereRerankApiError) {
      stats.reason = 'cohere-error';
      stats.cohereError = `http_${err.status}`;
    } else {
      stats.reason = 'cohere-error';
      stats.cohereError = err instanceof Error ? err.message.slice(0, 80) : 'unknown';
    }
    log.warn('hybrid-rerank Cohere call failed, falling back to input order', {
      reason: stats.reason,
      err: stats.cohereError,
    });
    return { slots: cellVideoDeduped, stats };
  }

  stats.cohereLatencyMs = cohereRes.latencyMs;

  if (cohereRes.results.length === 0) {
    stats.reason = 'no-candidates';
    return { slots: cellVideoDeduped, stats };
  }

  // Normalize Cohere relevance_scores to 0–100 within this batch.
  const rawScores = cohereRes.results.map((r) => r.relevanceScore);
  const normalized = normalizeScores0to100(rawScores);

  // Map back to slots, preserving the reranked order.
  const reorderedSlots: S[] = [];
  for (let i = 0; i < cohereRes.results.length; i++) {
    const r = cohereRes.results[i];
    if (!r) continue;
    const slot = cellVideoDeduped[r.index];
    if (!slot) continue;
    const normScore = normalized[i] ?? slot.rec_score;
    reorderedSlots.push({
      ...slot,
      rec_score: normScore,
    } as S);
  }

  stats.reranked = reorderedSlots.length;
  stats.applied = true;
  stats.reason = 'ok';

  return { slots: reorderedSlots, stats };
}
