/**
 * Observability Phase 1 — search trail log writer.
 *
 * Records the full "Card Journey" for one v5 live-search request (wizard |
 * add_cards | pool_serve): the generated queries, every candidate video that
 * was considered, whether each was kept or dropped (+ reason), and the final
 * cell. One `search_trace` row per request + N `search_trace_candidate` rows.
 *
 * Design SSOT: docs/handoffs/insighta-observability-eval-system-design.md
 *
 * Discipline (design §10 read-path safety):
 *   - Flag-gated by `SEARCH_TRACE_ENABLED` (default false) → off = no-op.
 *   - Emission is ASYNC fire-and-forget: the caller never awaits, and a DB
 *     hiccup is swallowed so it can never block or fail the user-facing serve
 *     path. The pipeline's decision logic is NEVER changed — callers only
 *     accumulate observational rows and hand them here.
 *
 * gc / cosine (STEP-1 audit):
 *   - `cosine` is absent on the whole v5 serve path; the only per-candidate
 *     similarity is Postgres ts_rank (lexical) on pool candidates → `tsRank`.
 *   - `relevanceGc` is populated ONLY by async paths (pool-serve fill,
 *     inflow-gate). On the add-cards / wizard SYNC serve path it is
 *     INTENTIONALLY null — no LLM on the read-path. Live relevance distribution
 *     is measured by the golden-cohort offline harness (design §7), not here.
 */
import { config } from '@/config/index';
import { getPrismaClient } from '@/modules/database';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'search-trace' });

export type SearchTraceTrigger = 'wizard' | 'add_cards' | 'pool_serve';

export type CandidateDecision =
  | 'PLACED'
  | 'DROPPED'
  | 'DEMOTED' // channel soft-cap: demoted, NOT dropped
  | 'KEPT_FAIL_OPEN'; // inflow-gate scorer failed → kept (quality compromise)

/** Candidate-level drop reasons (enumerated from the STEP-1 v5 pipeline audit). */
export type DropReason =
  | 'excluded_owned'
  | 'blocklist'
  | 'shorts'
  | 'off_lang'
  | 'pool_no_cell'
  | 'duplicate'
  | 'hardcap_overflow'
  | 'series_dedup'
  | 'not_picked'
  | 'slice_overflow'
  | 'filter_min_views'
  | 'filter_duration'
  | 'filter_published_after'
  | 'below_relevance_min'
  | 'budget_full';

export interface SearchTraceCandidateInput {
  videoId: string;
  channelId?: string | null;
  channelTitle?: string | null;
  sourceKind: 'live' | 'pool';
  /** Cell query that produced the candidate (-1 = center-goal query). */
  sourceCellIndex?: number | null;
  /** live: the query text; pool: null (query text is request-level). */
  sourceQueryText?: string | null;
  /** pool only: v2_promoted | yt_promoted | batch_trend | user_curated. */
  sourceTier?: string | null;
  stageReached?: string | null;
  decision: CandidateDecision;
  dropReason?: DropReason | null;
  /** async paths only; null on the add-cards / wizard sync serve path. */
  relevanceGc?: number | null;
  /** pool lexical score (rec_score); null on live candidates. */
  tsRank?: number | null;
  /** reserved for offline / harness; null on the serve path. */
  cosine?: number | null;
  llmPickScore?: number | null;
  llmPickReason?: string | null;
  viewCount?: number | bigint | null;
  durationSec?: number | null;
  publishedAt?: Date | string | null;
  finalCellLevel?: number | null;
  finalCellIndex?: number | null;
}

export interface SearchTraceInput {
  /** Groups this request + all its candidates. Reuse the pipeline run id. */
  traceId: string;
  mandalaId?: string | null;
  userId?: string | null;
  trigger: SearchTraceTrigger;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  /** [{ cell_index, query_text, source }] — cell_index -1 = center-goal query. */
  queriesGenerated?: unknown;
  /** Per-request live search.list units (SSOT across all triggers). */
  quotaUnits?: number | null;
  queriesAttempted?: number | null;
  queriesSucceeded?: number | null;
  queriesFailed?: number | null;
  counts?: unknown;
  outcome?: unknown;
  /** Named config-set id (e.g. v5-baseline / v5-recency-on) — version tagging. */
  algorithmVersion?: string | null;
}

/** Slice a value to a varchar column cap; null-safe. */
function cap(v: string | null | undefined, n: number): string | null {
  if (v == null) return null;
  return v.length > n ? v.slice(0, n) : v;
}

function toBigInt(v: number | bigint | null | undefined): bigint | null {
  if (v == null) return null;
  if (typeof v === 'bigint') return v;
  return Number.isFinite(v) ? BigInt(Math.trunc(v)) : null;
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Write one request trace + its candidate rows. Fire-and-forget: returns
 * immediately, never throws, never blocks the caller. No-op when the flag is off.
 */
export function writeSearchTrace(
  trace: SearchTraceInput,
  candidates: SearchTraceCandidateInput[]
): void {
  if (!config.searchTrace.enabled) return;

  // Snapshot inputs so the async closure is not affected by later mutation.
  const traceId = trace.traceId;

  void (async () => {
    try {
      const prisma = getPrismaClient();
      await prisma.search_trace.create({
        data: {
          trace_id: traceId,
          mandala_id: trace.mandalaId ?? null,
          user_id: trace.userId ?? null,
          trigger: cap(trace.trigger, 16) as string,
          started_at: trace.startedAt ?? new Date(),
          finished_at: trace.finishedAt ?? null,
          queries_generated: (trace.queriesGenerated ?? undefined) as never,
          quota_units: trace.quotaUnits ?? null,
          queries_attempted: trace.queriesAttempted ?? null,
          queries_succeeded: trace.queriesSucceeded ?? null,
          queries_failed: trace.queriesFailed ?? null,
          counts: (trace.counts ?? undefined) as never,
          outcome: (trace.outcome ?? undefined) as never,
          algorithm_version: cap(trace.algorithmVersion, 50),
        },
      });

      if (candidates.length > 0) {
        await prisma.search_trace_candidate.createMany({
          data: candidates.map((c) => ({
            trace_id: traceId,
            video_id: cap(c.videoId, 64) as string,
            channel_id: cap(c.channelId, 64),
            channel_title: c.channelTitle ?? null,
            source_kind: cap(c.sourceKind, 8) as string,
            source_cell_index: c.sourceCellIndex ?? null,
            source_query_text: c.sourceQueryText ?? null,
            source_tier: cap(c.sourceTier, 16),
            stage_reached: cap(c.stageReached, 24),
            decision: cap(c.decision, 16) as string,
            drop_reason: cap(c.dropReason ?? null, 32),
            relevance_gc: c.relevanceGc ?? null,
            ts_rank: c.tsRank ?? null,
            cosine: c.cosine ?? null,
            llm_pick_score: c.llmPickScore ?? null,
            llm_pick_reason: c.llmPickReason ?? null,
            view_count: toBigInt(c.viewCount),
            duration_sec: c.durationSec ?? null,
            published_at: toDate(c.publishedAt),
            final_cell_level: c.finalCellLevel ?? null,
            final_cell_index: c.finalCellIndex ?? null,
          })),
        });
      }
    } catch (err) {
      // Fire-and-forget: an observability write must never surface to the
      // serve path. Log at debug for local diagnosis only.
      const msg = err instanceof Error ? err.message : String(err);
      log.debug(`search-trace write failed (swallowed) trace=${traceId}: ${msg}`);
    }
  })();
}
