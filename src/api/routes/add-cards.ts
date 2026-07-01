/**
 * Add Cards Routes (CP466 Phase 2)
 *
 * `POST /api/v1/mandalas/:mandalaId/add-cards`
 *
 * Slide-in panel candidate fetcher. Returns up to N (default 40) video
 * candidates the user can Pick into their mandala, with:
 *   - Layer 1 Coverage: Tier 1 video_pool_embeddings cosine vs centerGoal
 *   - Layer 4 Feedback bias multiplier (channel match, drift-guarded)
 *   - Echo-chamber caps (channel ≤ N, sub_goal ≤ N)
 *   - Exclude lists: own user_local_cards + own user_video_states (this
 *     mandala) + card_interactions(signal='delete', global) +
 *     card_interactions(signal='archive', this mandala) + request body
 *     excludeVideoIds.
 *
 * Spec: docs/design/add-cards-2026-05-18.md §5.
 * Decisions: CP466 C1~C11 (single source of truth in spec doc).
 *
 * Hard Rule compliance:
 *   - 하드코딩 금지 — every knob via `getAddCardsConfig()` (zod schema +
 *     env override).
 *   - 추측 전 소스 읽기 — every helper signature read before use:
 *     `matchFromVideoPoolByCenterGoal`, `embedBatch`,
 *     `getMandalaManager().getMandalaById`, `card_interactions` Prisma
 *     model. See `src/skills/plugins/video-discover/v3/cache-matcher.ts`,
 *     `src/skills/plugins/iks-scorer/embedding.ts`,
 *     `src/modules/mandala/manager.ts`,
 *     `prisma/migrations/card-interactions/001_create_table.sql`.
 */

import { FastifyPluginCallback } from 'fastify';
import { getPrismaClient } from '@/modules/database';
import { logger } from '@/utils/logger';
import { getMandalaManager } from '@/modules/mandala/manager';
import { resolveAlgorithm } from '@/modules/search/algorithm-resolver';
import { getExcludedVideoIds } from '@/modules/exclude/excluded-videos';
import { withTraceContext, recordTrace, getTraceContext } from '@/modules/discover-tracing';
import { runV5Executor } from '@/skills/plugins/video-discover/v5/executor';
import { getV5Config } from '@/skills/plugins/video-discover/v5/config';
import { getFullCellIndices } from '@/modules/mandala/cell-fill';
import { writeSearchTrace, type DropReason } from '@/modules/search-trace';
import { randomUUID } from 'node:crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

const MAX_EXTRA_KEYWORDS = 10;
const MAX_EXCLUDE_IDS = 500;
const MAX_KEYWORD_LEN = 200;
/**
 * CP489 — focusTags cap forwarded into runDiscoverEphemeral. Mandala
 * default `focus_tags` already capped at the helper site; this constant
 * covers the combined (extraKeywords + mandala defaults) merged list so
 * the downstream keyword-builder stays predictable.
 */
const MAX_FOCUS_TAGS = 10;

const log = logger.child({ module: 'add-cards-routes' });

/**
 * CP489 — merge user-provided chip keywords with mandala default
 * focus_tags for forwarding into the Tier 2 ephemeral discover path.
 *
 * Order: extraKeywords first (user intent wins), then mandala defaults.
 * Dedupe by lowercase string. Cap at MAX_FOCUS_TAGS (10).
 *
 * Exported so unit tests can verify dedupe / cap / order without
 * spinning the Fastify handler.
 */
export function buildEphemeralFocusTags(
  mandalaFocusTags: string[] | null | undefined,
  extraKeywords: string[],
  cap = MAX_FOCUS_TAGS
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...extraKeywords, ...(mandalaFocusTags ?? [])]) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= cap) break;
  }
  return out;
}

type DurationBucket = 'short' | 'medium' | 'long' | 'xlong';

interface AddCardsFilters {
  minViewCount?: number;
  durationBucket?: DurationBucket;
  publishedAfter?: string; // ISO date
}

interface AddCardsBody {
  /** T2 (CP499+) — per-request language override for the EN-only search.
   *  'en' ⇒ this search is EN-only; 'ko' ⇒ force normal ko run; absent ⇒
   *  fall back to the persisted config (DB-toggled mandalas keep working). */
  searchLanguage?: 'ko' | 'en';
  extraKeywords?: string[];
  excludeVideoIds?: string[];
  filters?: AddCardsFilters;
}

// CP466 amendment — durationBucket bounds in seconds.
const DURATION_BUCKETS: Record<DurationBucket, { min: number; max: number }> = {
  short: { min: 0, max: 600 },
  medium: { min: 600, max: 1800 },
  long: { min: 1800, max: 3600 },
  xlong: { min: 3600, max: Number.POSITIVE_INFINITY },
};

interface AddCardCandidate {
  videoId: string;
  title: string;
  channel: string | null;
  thumbnail: string | null;
  durationSec: number | null;
  viewCount: number | null;
  publishedAt: string | null;
  score: number;
  cellIndex: number;
  source: 'video_pool' | 'realtime';
}

interface AddCardsTrace {
  layer1_count: number;
  tier2_count: number;
  after_exclude: number;
  layer4_boost_applied: number;
  caps_enforced: { channel: number; subgoal: number };
  drift_guard_fired: boolean;
  duration_ms: number;
}

export const addCardsRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post<{
    Params: { mandalaId: string };
    Body: AddCardsBody;
    Querystring: { trace?: string };
  }>('/:mandalaId/add-cards', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!request.user || !('userId' in request.user)) {
      return reply
        .code(401)
        .send({ status: 'error', code: 'UNAUTHORIZED', message: 'Unauthorized' });
    }
    const userId = request.user.userId;
    const { mandalaId } = request.params;
    const body = request.body ?? {};
    const wantTrace = request.query?.trace === '1';

    if (!UUID_RE.test(mandalaId)) {
      return reply.code(400).send({
        status: 'error',
        code: 'INVALID_MANDALA_ID',
        message: 'mandalaId must be a uuid',
      });
    }

    const extraKeywords = Array.isArray(body.extraKeywords)
      ? body.extraKeywords
          .filter((s): s is string => typeof s === 'string')
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && s.length <= MAX_KEYWORD_LEN)
          .slice(0, MAX_EXTRA_KEYWORDS)
      : [];
    const excludeVideoIds = Array.isArray(body.excludeVideoIds)
      ? body.excludeVideoIds
          .filter((s): s is string => typeof s === 'string' && YOUTUBE_VIDEO_ID_RE.test(s))
          .slice(0, MAX_EXCLUDE_IDS)
      : [];

    // CP466 amendment — request filters (post-filter, in-memory).
    const rawFilters = body.filters ?? {};
    const filters: AddCardsFilters = {};
    if (
      typeof rawFilters.minViewCount === 'number' &&
      Number.isFinite(rawFilters.minViewCount) &&
      rawFilters.minViewCount > 0
    ) {
      filters.minViewCount = rawFilters.minViewCount;
    }
    if (
      rawFilters.durationBucket === 'short' ||
      rawFilters.durationBucket === 'medium' ||
      rawFilters.durationBucket === 'long' ||
      rawFilters.durationBucket === 'xlong'
    ) {
      filters.durationBucket = rawFilters.durationBucket;
    }
    if (typeof rawFilters.publishedAfter === 'string') {
      const parsed = Date.parse(rawFilters.publishedAfter);
      if (Number.isFinite(parsed)) {
        filters.publishedAfter = new Date(parsed).toISOString();
      }
    }

    const prisma = getPrismaClient();
    const t0 = Date.now();

    try {
      // CP489 Phase B-2 — Resolve algorithm version FIRST (outside the
      // trace context closure since algorithmVersion must be bound at
      // context-open time), then wrap the entire body in
      // `withTraceContext` so every nested `recordTrace` call
      // (cache-matcher Tier 1, executor ephemeral path, embedding batch)
      // writes to `video_discover_traces` with this run's `runId` +
      // `algorithm_version` stamp. Without this wrap, ALS context is
      // unbound and `fireAndForgetWrite` silently no-ops — the
      // `/admin/search-algorithms/comparison/:mandalaId` A/B rollup
      // reports NULL algorithm_version for add-cards traffic.
      // `resolveAlgorithm` never throws; DB outage falls back to env
      // defaults (see `algorithm-resolver.ts:92-100`).
      const resolved = await resolveAlgorithm({ userId, mandalaId });

      return await withTraceContext(
        { mandalaId, userId, algorithmVersion: resolved.id },
        async () => {
          recordTrace({
            step: 'add_cards.start',
            status: 'ok',
            request: {
              mandalaId,
              userId,
              extra_keyword_count: extraKeywords.length,
              exclude_count: excludeVideoIds.length,
              filters,
              algorithm_version: resolved.id,
              want_trace: wantTrace,
            },
            response: null,
          });

          // 1. resolve mandala — ownership check inside getMandalaById
          const mandala = await getMandalaManager().getMandalaById(userId, mandalaId);
          if (!mandala) {
            return reply.code(404).send({
              status: 'error',
              code: 'MANDALA_NOT_FOUND',
              message: `Mandala ${mandalaId} not found for this user`,
            });
          }
          const root = mandala.levels.find((l) => l.depth === 0);
          if (!root) {
            return reply.code(500).send({
              status: 'error',
              code: 'MANDALA_ROOT_MISSING',
              message: 'Mandala has no depth=0 level',
            });
          }
          const centerGoal = root.centerGoal;
          const subGoals = root.subjects.slice(0, 8);
          // CP466 amendment 2 — pull wizard metadata (focus_tags +
          // target_level + language + title) so the response exposes them
          // to the FE. Per user directive 2026-05-18: title is the locked
          // base (immutable, already rendered via center_goal); focus_tags
          // + target_level are EDITABLE on the FE — sent up as chips in
          // the request `extraKeywords` rather than auto-injected server-
          // side. This endpoint just surfaces them in the response so the
          // FE can prepopulate the panel state.
          const mandalaMeta = await prisma.user_mandalas.findUnique({
            where: { id: mandalaId },
            select: { focus_tags: true, target_level: true, language: true, title: true },
          });
          const language: 'ko' | 'en' = mandalaMeta?.language === 'en' ? 'en' : 'ko';

          // CP490+ — v5 path: YouTube fanout → LLM picker. No cosine, no IKS.
          // Exclude set is the only pre-filter (3 explicit-engagement signals
          // + delete/archive interactions + user_local_cards).
          const excludeSet = await resolveExcludeSet({
            prisma,
            userId,
            mandalaId,
            requestExcludeIds: excludeVideoIds,
          });

          const focusTags = buildEphemeralFocusTags(mandalaMeta?.focus_tags, extraKeywords);
          const targetLevel = mandalaMeta?.target_level ?? 'standard';

          // CP494 ④-1 full-cell skip — don't search cells the user already
          // filled (≥ threshold). flag-gated; off → undefined → search all.
          // DB error → [] (safe: no skip). fire-before to keep it off the
          // executor's hot-path measurement.
          const v5cfg = getV5Config(process.env);
          const fullCellIndices = v5cfg.cellSkip
            ? await getFullCellIndices(prisma, userId, mandalaId, v5cfg.cellSkipThreshold).catch(
                () => [] as number[]
              )
            : undefined;

          // CP499+ '영문 카드 포함' toggle — per-mandala persistent state in
          // user_skill_config(video_discover).config.includeEnCards. ko
          // mandalas only; missing row / missing key / DB error = OFF
          // (current behaviour preserved — the safe default).
          let includeEnCards = false;
          if (language === 'ko') {
            // T2 — explicit request override (한/영 chip) wins over the
            // persisted config; absent = config fallback (option (a)).
            const requested = request.body?.searchLanguage;
            if (requested === 'en' || requested === 'ko') {
              includeEnCards = requested === 'en';
            } else {
              const skillCfg = await prisma.user_skill_config
                .findUnique({
                  where: {
                    user_id_mandala_id_skill_type: {
                      user_id: userId,
                      mandala_id: mandalaId,
                      skill_type: 'video_discover',
                    },
                  },
                  select: { config: true },
                })
                .catch(() => null);
              includeEnCards =
                (skillCfg?.config as Record<string, unknown> | null)?.['includeEnCards'] === true;
            }
          }

          const v5Result = await runV5Executor({
            centerGoal,
            subGoals,
            focusTags,
            targetLevel,
            language,
            includeEnCards,
            excludeVideoIds: excludeSet,
            env: process.env,
            fullCellIndices,
            // CP491 ROI1 — push the date filter into search.list so YouTube
            // returns date-valid candidates instead of fetch-then-discard at
            // the post-pick filter below. Post-pick filter retained as a
            // safety net (no-op once search already filters).
            publishedAfter: filters.publishedAfter,
          });

          // Request-level filter pass (durationBucket / minViewCount /
          // publishedAfter). Applied post-LLM because LLM has no visibility
          // into duration/views. NULL fields fall through (kept).
          const publishedAfterTs = filters.publishedAfter
            ? Date.parse(filters.publishedAfter)
            : null;
          const durationRange = filters.durationBucket
            ? DURATION_BUCKETS[filters.durationBucket]
            : null;
          const minViews = filters.minViewCount ?? null;
          const v5Filtered = v5Result.cards.filter((c) => {
            if (minViews != null && c.viewCount != null && c.viewCount < minViews) return false;
            if (
              durationRange &&
              c.durationSec != null &&
              (c.durationSec < durationRange.min || c.durationSec >= durationRange.max)
            ) {
              return false;
            }
            if (publishedAfterTs != null && c.publishedAt) {
              const ts = Date.parse(c.publishedAt);
              if (Number.isFinite(ts) && ts < publishedAfterTs) return false;
            }
            return true;
          });

          const cards: AddCardCandidate[] = v5Filtered.map((c) => ({
            videoId: c.videoId,
            title: c.title,
            channel: c.channelTitle,
            thumbnail: c.thumbnailUrl,
            durationSec: c.durationSec,
            viewCount: c.viewCount,
            publishedAt: c.publishedAt,
            score: c.score,
            cellIndex: c.cellIndex ?? 0,
            source: 'realtime',
          }));

          // Mark surfaced fire-and-forget below (CP489 Phase 2+3 retained).
          const surfacedSet = { size: 0 } as { size: number };

          const trace: AddCardsTrace | undefined = wantTrace
            ? {
                layer1_count: 0,
                tier2_count: v5Result.diagnostics.afterTitleFilter,
                after_exclude: v5Result.diagnostics.afterExcludeFilter,
                layer4_boost_applied: 0,
                caps_enforced: { channel: 0, subgoal: 0 },
                drift_guard_fired: false,
                duration_ms: Date.now() - t0,
              }
            : undefined;

          // CP466 amendment 2 — surface wizard meta so the FE panel can
          // prepopulate editable chips (focus_tags) + level selector
          // (target_level) on first open. title is informational (locked
          // base already shown via center_goal).
          const mandalaMetaOut = {
            title: mandalaMeta?.title ?? '',
            focusTags: mandalaMeta?.focus_tags ?? [],
            targetLevel: mandalaMeta?.target_level ?? 'standard',
            language,
          };

          // CP489 Phase 4 — round_id + round_at let the FE append each
          // response as a new "round" entry in the cumulative panel state
          // (newest-first separators). round_id reuses the trace runId so
          // operators can pivot from a UI screenshot back to the trace
          // (one round = one runId = one chain of recordTrace rows).
          const roundId = getTraceContext()?.runId ?? randomUUID();
          const roundAt = new Date().toISOString();

          // Observability Phase 1 (STEP 3 stage C) — flush the full Card Journey
          // fire-and-forget. `traceCandidates` is built only when
          // SEARCH_TRACE_ENABLED, so this whole block is a no-op when off.
          // PLACED candidates cut by the display filter above are reclassified
          // to their filter reason here (the executor could not see the filter).
          if (v5Result.diagnostics.traceCandidates) {
            const shown = new Set(v5Filtered.map((c) => c.videoId));
            const journey = v5Result.diagnostics.traceCandidates.map((tc) => {
              if (tc.decision !== 'PLACED' || shown.has(tc.videoId)) return tc;
              const card = v5Result.cards.find((c) => c.videoId === tc.videoId);
              let reason: DropReason = 'filter_min_views';
              if (card) {
                if (minViews != null && card.viewCount != null && card.viewCount < minViews) {
                  reason = 'filter_min_views';
                } else if (
                  durationRange &&
                  card.durationSec != null &&
                  (card.durationSec < durationRange.min || card.durationSec >= durationRange.max)
                ) {
                  reason = 'filter_duration';
                } else if (publishedAfterTs != null && card.publishedAt) {
                  reason = 'filter_published_after';
                }
              }
              return {
                ...tc,
                decision: 'DROPPED' as const,
                dropReason: reason,
                stageReached: 'display_filter',
                finalCellIndex: null,
              };
            });
            const d = v5Result.diagnostics;
            writeSearchTrace(
              {
                traceId: roundId,
                mandalaId,
                userId,
                trigger: 'add_cards',
                startedAt: new Date(t0),
                finishedAt: new Date(),
                queriesGenerated: d.perQuery,
                quotaUnits: d.quotaUnitsApprox,
                queriesAttempted: d.queriesAttempted,
                queriesSucceeded: d.queriesSucceeded,
                queriesFailed: Math.max(0, d.queriesAttempted - d.queriesSucceeded),
                counts: {
                  raw: d.rawItemCount,
                  after_title: d.afterTitleFilter,
                  after_exclude: d.afterExcludeFilter,
                  off_lang_dropped: d.offLangDropped,
                  shorts_dropped: d.shortsDropped,
                  placed: cards.length,
                },
                outcome: { cards_count: cards.length },
                algorithmVersion: getTraceContext()?.algorithmVersion ?? null,
              },
              journey
            );
          }

          const payload = trace
            ? { cards, mandalaMeta: mandalaMetaOut, roundId, roundAt, trace }
            : { cards, mandalaMeta: mandalaMetaOut, roundId, roundAt };

          recordTrace({
            step: 'add_cards.end',
            status: 'ok',
            request: null,
            response: {
              cards_count: cards.length,
              tier1_count: 0,
              tier2_count: v5Result.diagnostics.afterTitleFilter,
              after_exclude: v5Result.diagnostics.afterExcludeFilter,
              layer4_boosted: 0,
              drift_guard_fired: false,
              caps_channel: 0,
              caps_subgoal: 0,
              surfaced_set_size: surfacedSet.size,
              v5_picker_model: v5Result.diagnostics.pickerModel,
              v5_queries_attempted: v5Result.diagnostics.queriesAttempted,
              v5_queries_succeeded: v5Result.diagnostics.queriesSucceeded,
              v5_raw_item_count: v5Result.diagnostics.rawItemCount,
              v5_picks_raw: v5Result.diagnostics.picksRaw,
              v5_llm_batches: v5Result.diagnostics.llmBatches,
              v5_quota_units: v5Result.diagnostics.quotaUnitsApprox,
              // CP491 F5 — per-stage ms + abort observability (makes the
              // "videos.list dominant" claim directly measurable in prod).
              v5_stage_ms: v5Result.diagnostics.stageMs,
              v5_aborted_batches: v5Result.diagnostics.abortedBatches,
              v5_picker_timed_out: v5Result.diagnostics.pickerTimedOut,
              // CP499+ EN query pass — prod verification surface for the
              // includeEnCards toggle (weakCells/fired/added per run).
              v5_en_pass: v5Result.diagnostics.enPass,
              // CP492 Track-1 — query-gen telemetry (mode/model/latency/llmCells/fellBack).
              // stageMs.queryGenMs already carries the latency via v5_stage_ms.
              v5_query_gen: v5Result.diagnostics.queryGen,
              // CP492 2차 gate — off-language candidates dropped (Arabic/Thai/Cyrillic/
              // CJK/Turkish). English is intentionally NOT dropped (Track 3 topic fit).
              v5_off_lang_dropped: v5Result.diagnostics.offLangDropped,
              // CP494 — pool-first backfill telemetry: quota delta (liveCells ×
              // 100 spent vs poolOnlyCells × 100 saved), poolQueryMs latency, and
              // poolOnlyCells (Fork-2(A) 100%-lexical quality tradeoff surface).
              v5_pool_backfill: v5Result.diagnostics.poolBackfill,
              // CP494 ④-1 — cell queries skipped (cell already ≥ threshold full).
              v5_skipped_full_cells: v5Result.diagnostics.skippedFullCells,
              // CP491 F5c — per-query raw count + q_ok (parity with wizard.discover.end).
              v5_per_query: v5Result.diagnostics.perQuery,
              // CP491 — Shorts dropped by the post-pick short gate (before→after observability).
              v5_shorts_dropped: v5Result.diagnostics.shortsDropped,
              // CP489 Phase 6 — emit returned videoIds so the Search Journey
              // Ledger can join per-round trace rows ↔ card_interactions
              // deterministically (no timestamp-window fuzziness). Bounded
              // by cfg.limitDefault (~40), so payload growth is trivial.
              returned_video_ids: cards.map((c) => c.videoId),
              // CP492 funnel — exclude-set size (now GLOBAL owned + rec_cache +
              // signals). Watch alongside v5_raw_item_count / after_exclude /
              // cards_count: a large exclude_set_size with low cards_count is a
              // SUPPLY signal (heavy user owns most candidates), NOT a reason to
              // re-narrow the exclusion (see excluded-videos.ts CP489 note).
              exclude_set_size: excludeSet.size,
            },
            latencyMs: Date.now() - t0,
          });

          // CP489 Phase 2+3 — fire-and-forget record of the surfaced cards
          // so the NEXT add-cards round can reuse-priority-boost them and
          // skip cold re-embed. UPSERT (latest wins) on the existing
          // unique (user_id, video_id, signal) so the row count stays
          // bounded — one row per user × video × signal regardless of
          // how many rounds have surfaced the same video.
          void recordSurfacedCards({
            prisma,
            userId,
            mandalaId,
            videoIds: cards.map((c) => c.videoId),
          }).catch((err) => {
            log.warn(
              `surfaced recording failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
            );
          });

          return reply.code(200).send({ status: 'ok', data: payload });
        }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`add-cards failed: mandalaId=${mandalaId} userId=${userId} err=${msg}`);
      return reply.code(500).send({
        status: 'error',
        code: 'ADD_CARDS_FAILED',
        message: msg.slice(0, 200),
      });
    }
  });

  done();
};

// ── Helpers ──────────────────────────────────────────────────

interface ResolveExcludeSetOpts {
  prisma: ReturnType<typeof getPrismaClient>;
  userId: string;
  mandalaId: string;
  requestExcludeIds: string[];
}

async function resolveExcludeSet(opts: ResolveExcludeSetOpts): Promise<Set<string>> {
  // CP489+ dedup-bleed fix — delegates to shared SSOT helper that applies
  // Explicit > Inferred policy (auto_added=true zero-engagement rows from
  // wizard pre-fill are no longer excluded). See modules/exclude/.
  return getExcludedVideoIds(opts);
}

// ============================================================================
// CP489 Phase 2+3 — surfaced (shown-but-not-picked) persistence + reuse boost
// ============================================================================

/**
 * Load the set of videoIds previously surfaced to this user in this mandala
 * (signal='surfaced'). Returns Set<string> for O(1) membership check during
 * the candidate boost loop. Failure-quiet: any DB error returns empty set
 * — the boost simply degrades to "no reuse priority" rather than blocking
 * the response.
 */
export async function loadSurfacedVideoIds(opts: {
  prisma: ReturnType<typeof getPrismaClient>;
  userId: string;
  mandalaId: string;
}): Promise<Set<string>> {
  try {
    const rows = await opts.prisma.card_interactions.findMany({
      where: {
        user_id: opts.userId,
        mandala_id: opts.mandalaId,
        signal: 'surfaced',
      },
      select: { video_id: true },
    });
    const out = new Set<string>();
    for (const r of rows) if (r.video_id) out.add(r.video_id);
    return out;
  } catch (err) {
    log.warn(
      `loadSurfacedVideoIds failed (non-fatal, returning empty set): ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return new Set();
  }
}

/**
 * Multiply the score of every candidate already in `surfacedSet` by
 * `1 + boost`. Pure function — no DB, no side-effects, safe to unit
 * test. Returns a new array (input unchanged).
 *
 * The score multiplier policy (small +5% by default) is deliberately
 * subtle so the reuse boost surfaces previously-seen candidates back
 * into the response without dominating fresh high-cosine matches.
 */
export function applySurfaceBoost<T extends { videoId: string; score: number }>(
  candidates: T[],
  surfacedSet: ReadonlySet<string>,
  boost: number
): T[] {
  if (surfacedSet.size === 0 || boost <= 0) return candidates;
  const multiplier = 1 + boost;
  return candidates.map((c) =>
    surfacedSet.has(c.videoId) ? { ...c, score: c.score * multiplier } : c
  );
}

/**
 * UPSERT the list of just-surfaced videoIds into card_interactions as
 * signal='surfaced'. Fire-and-forget contract — caller MUST `.catch()`
 * to keep response unblocked. Idempotent via the existing
 * (user_id, video_id, signal) unique constraint.
 *
 * Empty input is a no-op.
 */
export async function recordSurfacedCards(opts: {
  prisma: ReturnType<typeof getPrismaClient>;
  userId: string;
  mandalaId: string;
  videoIds: string[];
}): Promise<void> {
  if (opts.videoIds.length === 0) return;
  for (const videoId of opts.videoIds) {
    try {
      await opts.prisma.card_interactions.upsert({
        where: {
          user_id_video_id_signal: {
            user_id: opts.userId,
            video_id: videoId,
            signal: 'surfaced',
          },
        },
        create: {
          user_id: opts.userId,
          mandala_id: opts.mandalaId,
          video_id: videoId,
          signal: 'surfaced',
        },
        update: {
          mandala_id: opts.mandalaId,
        },
      });
    } catch (err) {
      log.warn(
        `recordSurfacedCards upsert failed (non-fatal): videoId=${videoId} err=${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
}
