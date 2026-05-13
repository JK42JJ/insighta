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
import { getPrismaClient } from '@/modules/database/client';
import { Prisma } from '@prisma/client';

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
  /** Slots produced by mandala-filter (already cell-assigned, semantic side). */
  slots: ReadonlyArray<S>;
  /** Query text — the mandala's center_goal. Used as Cohere rerank query AND tsvector keyword search query. */
  centerGoal: string;
  /**
   * Mandala sub_goals (length 8). When non-empty AND `enableKeywordExpansion`
   * is true, candidates from `video_pool` tsvector match are added with
   * cellIndex assigned via argmax token-overlap against sub_goals.
   * Matches YT-Navigator's "similarity + keyword" hybrid pattern.
   */
  subGoals?: ReadonlyArray<string>;
  /**
   * When true, query video_pool via tsvector and concat candidates into
   * the pre-rerank pool. Disabled by default for backward compat — caller
   * opts in once subGoals are known to be meaningful.
   */
  enableKeywordExpansion?: boolean;
  /** Cap on keyword-expanded candidates added. */
  keywordExpansionLimit?: number;
  /** Top-N to keep after rerank. Default = input size (no trimming). */
  topN?: number;
  /** Used for log correlation. */
  requestId?: string;
}

export interface HybridRerankStats {
  applied: boolean;
  reason: 'flag-off' | 'no-api-key' | 'no-candidates' | 'cohere-error' | 'ok';
  inputSlots: number;
  keywordAdded: number;
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
export interface KeywordCandidate {
  videoId: string;
  title: string;
  description: string | null;
  channelName: string | null;
  channelId: string | null;
  thumbnail: string | null;
  viewCount: number | null;
  likeCount: number | null;
  durationSec: number | null;
  publishedAt: Date | null;
  cellIndex: number;
  rec_score: number;
}

export async function tsvectorKeywordCandidates(
  centerGoal: string,
  subGoals: ReadonlyArray<string>,
  excludeVideoIds: ReadonlyArray<string>,
  limit = 20
): Promise<KeywordCandidate[]> {
  if (!centerGoal.trim()) return [];

  try {
    const prisma = getPrismaClient();

    // Build an OR-tsquery from centerGoal + non-empty subGoals tokens so the
    // GIN-indexed tsvector matches any single keyword, not just full phrase.
    // Korean 'simple' tokenization splits on whitespace + punctuation; we
    // sanitize each token (strip tsquery operators) and join with ` | `.
    // Empty after sanitize → fall back to plainto_tsquery for safety.
    const allTerms = [centerGoal, ...subGoals.filter((s) => s.trim().length > 0)];
    const tokens = allTerms
      .flatMap((t) => t.split(/[\s,/.;()[\]{}!?"'`~&|<>:*+\-=]+/))
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      .map((t) => t.replace(/[':!&|()<>*]/g, ''))
      .filter((t, i, arr) => arr.indexOf(t) === i);
    const tsqueryString = tokens.length > 0 ? tokens.join(' | ') : centerGoal;

    // Query video_pool by tsvector OR-match. Pull more than we'll keep
    // (limit*2) so the cell-assignment + dedup against semantic pool can
    // still hit the requested `limit` after dedup.
    const fetchLimit = limit * 2;
    const exclude = excludeVideoIds.length > 0 ? excludeVideoIds : [''];
    const rows = await prisma.$queryRaw<
      Array<{
        video_id: string;
        title: string;
        description: string | null;
        channel_name: string | null;
        channel_id: string | null;
        thumbnail_url: string | null;
        view_count: bigint | null;
        like_count: bigint | null;
        duration_seconds: number | null;
        published_at: Date | null;
        rank: number;
      }>
    >(Prisma.sql`
      SELECT
        vp.video_id,
        vp.title,
        vp.description,
        vp.channel_name,
        vp.channel_id,
        vp.thumbnail_url,
        vp.view_count,
        vp.like_count,
        vp.duration_seconds,
        vp.published_at,
        ts_rank(
          to_tsvector('simple', coalesce(vp.title,'') || ' ' || coalesce(vp.description,'')),
          to_tsquery('simple', ${tsqueryString})
        ) AS rank
      FROM public.video_pool vp
      WHERE vp.is_active = true
        AND vp.video_id <> ALL(${exclude}::text[])
        AND to_tsvector('simple', coalesce(vp.title,'') || ' ' || coalesce(vp.description,''))
            @@ to_tsquery('simple', ${tsqueryString})
      ORDER BY rank DESC
      LIMIT ${fetchLimit}
    `);

    // Assign each candidate to the cell whose sub_goal text has the
    // highest token-overlap with the candidate title. Pure-JS scoring
    // (no extra SQL round trip per row). Empty sub_goals → cellIndex 0.
    const subTokens = subGoals.map((sg) => tokenizeLower(sg ?? ''));
    const out: KeywordCandidate[] = [];
    for (const r of rows) {
      const titleTokens = tokenizeLower(r.title);
      let bestCell = 0;
      let bestOverlap = -1;
      for (let i = 0; i < subTokens.length; i++) {
        const overlap = countTokenOverlap(titleTokens, subTokens[i] ?? []);
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          bestCell = i;
        }
      }
      out.push({
        videoId: r.video_id,
        title: r.title,
        description: r.description,
        channelName: r.channel_name,
        channelId: r.channel_id,
        thumbnail: r.thumbnail_url,
        viewCount: r.view_count != null ? Number(r.view_count) : null,
        likeCount: r.like_count != null ? Number(r.like_count) : null,
        durationSec: r.duration_seconds,
        publishedAt: r.published_at,
        cellIndex: bestCell,
        rec_score: Number(r.rank) || 0,
      });
      if (out.length >= limit) break;
    }
    return out;
  } catch (err) {
    log.warn('tsvector keyword search failed (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/** Cheap whitespace + punctuation tokenizer, lowercased. */
function tokenizeLower(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[\s.,;:!?()[\]{}'"`#~^$%&*+=\-_/\\|<>]+/u)
    .filter((t) => t.length > 0);
}

function countTokenOverlap(a: ReadonlyArray<string>, b: ReadonlyArray<string>): number {
  if (a.length === 0 || b.length === 0) return 0;
  const bSet = new Set(b);
  let n = 0;
  for (const t of a) {
    if (bSet.has(t)) n++;
  }
  return n;
}

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
    keywordAdded: 0,
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

  // YT-Navigator hybrid pattern (vector_tool.py L128-140): semantic
  // candidates + keyword candidates concatenated before rerank.
  // semantic side = input.slots (from mandala-filter / v3 executor)
  // keyword side = tsvector match on video_pool (10K row global pool)
  let semanticPool: S[] = input.slots.slice();
  let keywordAdded = 0;
  if (input.enableKeywordExpansion === true && input.subGoals && input.subGoals.length > 0) {
    const excludeIds = semanticPool.map((s) => s.videoId);
    const limit = input.keywordExpansionLimit ?? 20;
    const kw = await tsvectorKeywordCandidates(input.centerGoal, input.subGoals, excludeIds, limit);
    // Convert to RerankSlot-shape and concat. We don't have full
    // AssembledSlot fields here (description, channelName, etc.) — those
    // are filled by the executor upon receiving the rerank result and
    // round-tripping through video_pool/YouTube hydration if needed.
    // For the rerank step itself, only {videoId, title, cellIndex, rec_score}
    // is needed.
    // Attach `_keywordFullData` so caller can hydrate downstream
    // (caller checks for either `_original` from semantic side OR
    // `_keywordFullData` from keyword expansion side).
    const kwSlots = kw.map((k) => ({
      videoId: k.videoId,
      title: k.title,
      cellIndex: k.cellIndex,
      rec_score: k.rec_score,
      _keywordFullData: k,
    })) as unknown as S[];
    semanticPool = semanticPool.concat(kwSlots);
    keywordAdded = kwSlots.length;
  }
  stats.keywordAdded = keywordAdded;

  // Dedupe combined pool by (cellIndex, videoId) using the highest score.
  const cellVideoDeduped = groupByCellVideo(semanticPool);

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
