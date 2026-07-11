import { z } from 'zod';

import { DEFAULT_SEMANTIC_ALPHA, DEFAULT_SEMANTIC_BETA } from '@/modules/video-dictionary';

import {
  DEFAULT_RECENCY_HALF_LIFE_MONTHS,
  DEFAULT_RECENCY_WEIGHT,
  SEMANTIC_MIN_COSINE,
} from './mandala-filter';

export const DEFAULT_PUBLISHED_AFTER_DAYS = 0;

/**
 * Per-call timeout for YouTube search.list in v3 discovery.
 *
 * 1000ms is empirically below the p95 of normal YouTube Data API
 * latency from our EC2 region → any call exceeding this is on the
 * tail and would otherwise bottleneck the entire Promise.allSettled
 * fan-out (`v3/executor.ts:755`). Tail calls are cut and treated as
 * `partial` results (missing items, not a pipeline failure). See
 * Phase 1 slice 1 rationale in the PR description.
 */
export const DEFAULT_YOUTUBE_SEARCH_TIMEOUT_MS = 1000;

/**
 * Runtime ceiling for YouTube search queries issued per video-discover
 * call (rule-based + LLM combined). CP416 Phase 3 direction: with the
 * semantic center gate doing recall, 3-5 broad queries replace the
 * 20 narrow queries of the lexical-gate era. Default stays at 20 for
 * safety; flip `V3_MAX_QUERIES=5` in prod once semantic mode telemetry
 * looks healthy. Hard upper bound remains `MAX_QUERIES = 20` in
 * `v2/keyword-builder.ts` (this value is clamped to that ceiling).
 */
export const DEFAULT_MAX_QUERIES = 20;

/**
 * Center-gate matching mode (post-SGNL-parity carding-quality audit).
 *
 * - `'substring'` (pre-audit default): token-level substring overlap.
 *   Fast but fails for Korean composite words — `"모닝루틴"` does not
 *   contain `"루틴으로"` as a substring and vice versa, so legitimate
 *   videos titled `엄지원의 모닝루틴 7가지` are dropped from goals like
 *   `1달 일일 루틴으로 전문가되기`. Measured Recall 0% / 15 on a 20-item
 *   fixture — see `scripts/verify-mandala-filter-hypothesis.ts`.
 *
 * - `'subword'`: character 2-gram overlap between each center token and
 *   the title's combined 2-gram bag. A center token is considered
 *   matched when ≥ 30% of its 2-grams appear in the title. Catches the
 *   composite-word case without a morphological analyzer. Measured
 *   Recall 0.27 / Precision 1.00 on the same fixture (4 of 15 RELEVANT
 *   kept, 0 NOISE).
 *
 * - `'off'`: skip the center gate entirely, let the sub-goal jaccard
 *   stage (MIN_SUB_RELEVANCE) do the filtering alone. Widest net; use
 *   when the center phrase is highly specific and the sub-goals cover
 *   the semantic space.
 *
 * - `'semantic'` (CP416 Phase 3): cosine similarity between the center
 *   goal embedding and each candidate's title embedding (4096d qwen3-
 *   embedding:8b, same space as `mandala_embeddings`). A candidate
 *   passes when cosine ≥ `SEMANTIC_MIN_COSINE` (default 0.35). Intended
 *   to replace lexical gates: language-agnostic, catches paraphrases
 *   ("루틴으로 전문가되기" ↔ "하루 습관 형성하는 법"). Requires
 *   `centerEmbedding` + `candidateEmbeddings` on the filter input —
 *   callers that omit embeddings fall back to `'substring'` behavior
 *   for safety (mandala-filter.ts enforces).
 */
export type CenterGateMode = 'substring' | 'subword' | 'off' | 'semantic';
export const DEFAULT_CENTER_GATE_MODE: CenterGateMode = 'substring';

export type V3EnvInput = Record<string, string | undefined>;

const booleanFlag = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().toLowerCase() === 'true' : Boolean(v)),
  z.boolean()
);

const clampedUnit = z
  .preprocess(
    (v) => (v == null || v === '' ? undefined : Number(v)),
    z.number().finite().min(0).max(1).optional()
  )
  .transform((v) => v ?? DEFAULT_RECENCY_WEIGHT);

const positiveInt = z
  .preprocess(
    (v) => (v == null || v === '' ? undefined : Number(v)),
    z.number().finite().int().positive().optional()
  )
  .transform((v) => v ?? DEFAULT_RECENCY_HALF_LIFE_MONTHS);

const nonNegativeInt = z
  .preprocess(
    (v) => (v == null || v === '' ? undefined : Number(v)),
    z.number().finite().int().nonnegative().optional()
  )
  .transform((v) => v ?? DEFAULT_PUBLISHED_AFTER_DAYS);

const semanticAlpha = z
  .preprocess(
    (v) => (v == null || v === '' ? undefined : Number(v)),
    z.number().finite().min(0).max(1).optional()
  )
  .transform((v) => v ?? DEFAULT_SEMANTIC_ALPHA);

const semanticBeta = z
  .preprocess(
    (v) => (v == null || v === '' ? undefined : Number(v)),
    z.number().finite().min(0).max(1).optional()
  )
  .transform((v) => v ?? DEFAULT_SEMANTIC_BETA);

const youtubeSearchTimeoutMs = z
  .preprocess(
    (v) => (v == null || v === '' ? undefined : Number(v)),
    z.number().finite().int().positive().optional()
  )
  .transform((v) => v ?? DEFAULT_YOUTUBE_SEARCH_TIMEOUT_MS);

const maxQueries = z
  .preprocess(
    (v) => (v == null || v === '' ? undefined : Number(v)),
    z.number().finite().int().positive().optional()
  )
  .transform((v) => v ?? DEFAULT_MAX_QUERIES);

const centerGateMode = z
  .preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
    z.enum(['substring', 'subword', 'off', 'semantic']).optional()
  )
  .transform((v) => v ?? DEFAULT_CENTER_GATE_MODE);

export const DEFAULT_MIN_VIEW_COUNT = 1000;
export const DEFAULT_MIN_VIEWS_PER_DAY = 10;

/**
 * Two-stage pool matching (P2 fix, 2026-07-11).
 *
 * matchFromVideoPool brute-forces eligible(~6.3k) × 8 cells = 50,840 cosine
 * ops on vector(4096) per wizard call — EXPLAIN-measured 22.8s cold / 4.9s
 * warm, sitting on the wizard's synchronous precompute-consume path. pgvector
 * hnsw/ivfflat cap at 2,000 dims, so the 4096d column cannot be indexed.
 *
 * Fix: qwen3-embedding is MRL, so the stored 4096d vectors truncate+renorm to
 * 1024d without re-embedding (GENERATED column `embedding_1024` + hnsw index,
 * DDL prisma/migrations/pool-embeddings-1024/). Stage 1 = hnsw shortlist on
 * 1024d (OVERFETCH raw ordered rows per cell, filtered to eligibility, keep
 * SHORTLIST_K); stage 2 = exact 4096d re-rank of K×cells pairs.
 *
 * Measured on prod (mandala 9c50861b, 2026-07-11): true 4096d top-8/cell is
 * FULLY contained in the 1024d top-32 shortlist (recall 64/64) — two-stage is
 * exact at K=32. view_count pre-capping was tested and REJECTED (overlap
 * 7/64 = 11%; non-semantic pre-filters destroy semantic top-k).
 *
 * Default OFF (unset = brute-force path unchanged). Enable via compose
 * V3_POOL_MATCH_TWO_STAGE=true; rollback = remove the line, no code revert.
 */
export const DEFAULT_POOL_MATCH_TWO_STAGE = false;
export const DEFAULT_POOL_MATCH_SHORTLIST_K = 32;
export const DEFAULT_POOL_MATCH_OVERFETCH = 256;
/**
 * hnsw.ef_search for the shortlist scan. MUST exceed OVERFETCH or the index
 * silently returns fewer rows than LIMIT asks (pgvector default 40 → measured
 * recall collapse 51/64). Prod-measured at 400: recall 64/64, warm 105ms.
 */
export const DEFAULT_POOL_MATCH_EF_SEARCH = 400;
/**
 * Interactive-transaction timeout for the SET LOCAL + shortlist query.
 * Prisma's default 5s expired on a cold-cache run (15.6s measured,
 * 2026-07-11 08:08Z) and killed step2 entirely → 0-card mandala. 30s covers
 * the measured cold worst case ×2; failures past it fall back to brute-force.
 */
export const DEFAULT_POOL_MATCH_TX_TIMEOUT_MS = 30_000;

/**
 * Semantic-mode embedding candidate cap (Issue #543, CP436 PR-Y0b2).
 *
 * When `V3_CENTER_GATE_MODE=semantic`, the executor calls
 * `embedBatch([centerGoal, ...candidateTitles])` with one entry per
 * candidate. Without a cap, hundreds of titles enter a single
 * Mac-mini Ollama call (CP418 prod incident: 56s blocking).
 *
 * 30 keeps the embed call to ≤ 31 texts (center + 30 titles), well
 * under embedding.ts:DEFAULT_EMBED_CHUNK_SIZE = 50, so only one
 * provider round-trip happens per wizard finalize. Combined with
 * PR #550's OpenRouter fallback this stays in the 5-10s wall budget
 * even when Mac-mini is down.
 *
 * Trade-off: candidates beyond the cap arrive at applyMandalaFilter
 * without candidateEmbeddings entries — they are dropped by the
 * semantic-mode center gate (mandala-filter.ts:272-273 returns
 * centerScore=0 → droppedByCenterGate). This is by design: when
 * scoring isn't possible we err on the side of dropping rather than
 * letting unmeasured candidates through.
 */
export const DEFAULT_SEMANTIC_MAX_CANDIDATES = 30;

/**
 * Bypass mandala-filter and trust YouTube's own search.list ranking
 * (Issue #543, CP436 PR-Y0d).
 *
 * Default `false` keeps the existing 9-axis filter pipeline (token-overlap
 * + sub_goal jaccard + recency + optional semantic gate). Pre-CP436 prod
 * traffic showed that the filter actively degraded card quality for many
 * goals: candidates were re-ranked by token overlap on a tokenizer that
 * admits "AI" alone, discarding the strong topical-relevance signal that
 * YouTube already encodes in `search.list` order.
 *
 * When `true`, the executor skips applyMandalaFilter and emits enriched
 * candidates in the order returned by YouTube. Cell assignment uses the
 * per-cell query's `cellIndexHint` (set in v2/keyword-builder), so cards
 * land in the cell whose query produced them. Score is a descending
 * cursor that preserves arrival order in the global desc sort that picks
 * cards across cells.
 *
 * Trade-offs:
 *   + restores YouTube's native relevance ranking
 *   + avoids the "Google One AI 프로젝트 → Nvidia NIM" lexical false-positive
 *   - no defense against mandala-irrelevant titles that YouTube ranks high
 *     (best mitigated by tightening keyword-builder queries instead of
 *     re-scoring downstream)
 */
export const DEFAULT_USE_YOUTUBE_RANKING_ONLY = false;

/**
 * Tier 0 RedisProvider kill switch (Issue #543, CP436 PR-Y0g).
 *
 * Default `false` — Tier 0 is OFF. Pre-Y0g default was always-on with no
 * gate; prod incident on mandala 1ee990a9 ("감정 컨트롤 하기") produced 96
 * cards in cell 2 alone, sourced 100% from RedisProvider. Domain breakdown:
 *   ~30 한글 속기, ~30 마케팅/홍보, ~25 자각몽/루시드드림, ~5 한복.
 * Zero of the 96 were emotion-management content. Root cause:
 *   redis-provider.ts:179-203 matches sub_goal tokens against topic-slug
 *   parts via simple overlap (≥1 for single-token slugs, ≥2 otherwise),
 *   then admits up to 30 videos per matched slug with `relevanceScore`
 *   hardcoded to 0.5. Korean tokenization is broad enough that any
 *   sub_goal hits multiple unrelated slugs by accident.
 *
 * When `true`: re-enables the lexical Tier 0 path (do NOT flip without
 * adding a quality gate first — semantic cosine threshold or strict
 * minOverlap raise). Suggested re-enable path documented in
 * docs/design/v3-tier0-quality-gate.md (TBD).
 *
 * When `false` (default): Tier 0 is bypassed in both `executor.ts` main
 * and `runDiscoverEphemeral` paths. Tier 1 (video_pool) is also off via
 * V3_ENABLE_TIER1_CACHE → effective pipeline is YouTube-only (Tier 2),
 * matching user feedback "초기 youtube-only 가 가장 좋음" (CP436).
 */
export const DEFAULT_ENABLE_REDIS_PROVIDER = false;

/**
 * Tier 1 video_pool source filter (CP457 domain idempotency fix).
 *
 * Comma-separated list of `video_pool.source` values that Tier 1 + hybrid-
 * rerank keyword-expansion are allowed to draw from. Default
 * `['v2_promoted']` preserves CP456 behavior (CC-authored v2 summaries
 * with completeness ≥ 0.7, structurally on-topic).
 *
 * Set `V3_TIER1_SOURCES=v2_promoted,batch_trend` in prod to expand
 * coverage to travel / hobby / language / cooking domains where
 * v2_promoted alone is sparse (CP457 prod measurement: travel mandala
 * v2_promoted=13 rows vs +batch_trend=372 rows top-50 per cell, cosine
 * ≥ 0.5 batch=38 + v2=5 = 43 rows pass).
 *
 * Trade-off: batch_trend rows are untriaged trend-cron output and admit
 * cross-domain near-matches (CP455 cell 6 = 28 토익스피킹 at cosine 0.55+).
 * Companion env `V3_SEMANTIC_MIN_COSINE` (default 0.35, raise to 0.5 in
 * prod) gates noise via the post-Tier-1 mandala-filter semantic gate.
 *
 * Rollback: unset the env var or set back to `v2_promoted` only —
 * no code change required.
 */
export const DEFAULT_TIER1_SOURCES: ReadonlyArray<string> = ['v2_promoted'];

const tier1Sources = z
  .preprocess((v) => {
    if (typeof v !== 'string') return undefined;
    const parts = v
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return parts.length > 0 ? parts : undefined;
  }, z.array(z.string()).min(1).optional())
  .transform((v) => v ?? [...DEFAULT_TIER1_SOURCES]);

/**
 * Semantic-mode center-gate cosine threshold (CP457 domain idempotency).
 *
 * Default 0.35 matches `mandala-filter.ts::SEMANTIC_MIN_COSINE` (CP416
 * permissive floor) for backward compat. Set `V3_SEMANTIC_MIN_COSINE=0.5`
 * in prod when V3_TIER1_SOURCES admits batch_trend — raises quality bar
 * so cross-domain near-matches (CP455 cell 6 토익스피킹 cosine 0.55+) are
 * filtered while in-domain matches (0.5-0.8 range per CP416 measurement)
 * survive.
 *
 * Rollback: unset env to revert to 0.35 floor — no code change.
 */
const semanticMinCosine = z
  .preprocess(
    (v) => (v == null || v === '' ? undefined : Number(v)),
    z.number().finite().min(0).max(1).optional()
  )
  .transform((v) => v ?? SEMANTIC_MIN_COSINE);

const minViewCount = z
  .preprocess(
    (v) => (v == null || v === '' ? undefined : Number(v)),
    z.number().finite().int().nonnegative().optional()
  )
  .transform((v) => v ?? DEFAULT_MIN_VIEW_COUNT);

const minViewsPerDay = z
  .preprocess(
    (v) => (v == null || v === '' ? undefined : Number(v)),
    z.number().finite().nonnegative().optional()
  )
  .transform((v) => v ?? DEFAULT_MIN_VIEWS_PER_DAY);

const semanticMaxCandidates = z
  .preprocess(
    (v) => (v == null || v === '' ? undefined : Number(v)),
    z.number().finite().int().min(1).max(200).optional()
  )
  .transform((v) => v ?? DEFAULT_SEMANTIC_MAX_CANDIDATES);

const poolMatchShortlistK = z
  .preprocess(
    (v) => (v == null || v === '' ? undefined : Number(v)),
    z.number().finite().int().min(8).max(200).optional()
  )
  .transform((v) => v ?? DEFAULT_POOL_MATCH_SHORTLIST_K);

const poolMatchOverfetch = z
  .preprocess(
    (v) => (v == null || v === '' ? undefined : Number(v)),
    z.number().finite().int().min(32).max(2000).optional()
  )
  .transform((v) => v ?? DEFAULT_POOL_MATCH_OVERFETCH);

const poolMatchEfSearch = z
  .preprocess(
    (v) => (v == null || v === '' ? undefined : Number(v)),
    z.number().finite().int().min(40).max(1000).optional()
  )
  .transform((v) => v ?? DEFAULT_POOL_MATCH_EF_SEARCH);

const poolMatchTxTimeoutMs = z
  .preprocess(
    (v) => (v == null || v === '' ? undefined : Number(v)),
    z.number().finite().int().min(5_000).max(120_000).optional()
  )
  .transform((v) => v ?? DEFAULT_POOL_MATCH_TX_TIMEOUT_MS);

/**
 * R4 shadow guard kill switch (2026-07-04, BL-17).
 *
 * When `true`, `applyMandalaFilterWithStats` classifies blank/whitespace-
 * only title candidates as `stats.wouldRejectEmptyTitle` WITHOUT dropping
 * them — read-only instrumentation for measuring blast radius before any
 * enforcement decision. Default `false` (unset = no-op): the classification
 * branch never runs and `byCell` output is bit-identical to pre-R4
 * behavior regardless of this flag's value (enforce = 0, always).
 *
 * See `mandala-filter.ts::MandalaFilterInput.emptyTitleGateShadow` for the
 * root-cause writeup (stale Tier 1 embeddings surviving a title SCRUB).
 * Rollback: unset the env var — no code change required.
 */
export const DEFAULT_EMPTY_TITLE_GATE_SHADOW = false;

/**
 * R4 enforce kill switch (2026-07-04, BL-17).
 *
 * When `true`, `applyMandalaFilterWithStats` actually drops (real
 * `continue`) blank/whitespace-only title candidates instead of only
 * counting them — separate from `V3_EMPTY_TITLE_GATE_SHADOW` above, so
 * shadow-only measurement runs are unaffected by shipping this switch.
 * Default `false` (unset = no-op): pre-R4 behavior is bit-identical.
 *
 * This PR ships the code path only — flag stays OFF until a separate,
 * explicit flip decision (James gate) based on the R4 shadow-measurement
 * data (blast-radius: sparse/empty-cell counts). Rollback: unset the env
 * var — no code change required.
 */
export const DEFAULT_EMPTY_TITLE_GATE = false;

export const v3EnvSchema = z.object({
  V3_ENABLE_TIER1_CACHE: booleanFlag.optional().default(false as unknown as string),
  V3_RECENCY_WEIGHT: clampedUnit,
  V3_RECENCY_HALF_LIFE_MONTHS: positiveInt,
  V3_PUBLISHED_AFTER_DAYS: nonNegativeInt,
  V3_ENABLE_SEMANTIC_RERANK: booleanFlag.optional().default(false as unknown as string),
  V3_SEMANTIC_ALPHA: semanticAlpha,
  V3_SEMANTIC_BETA: semanticBeta,
  V3_ENABLE_WHITELIST_GATE: booleanFlag.optional().default(false as unknown as string),
  V3_YOUTUBE_SEARCH_TIMEOUT_MS: youtubeSearchTimeoutMs,
  V3_CENTER_GATE_MODE: centerGateMode,
  V3_MAX_QUERIES: maxQueries,
  V3_ENABLE_QUALITY_GATE: booleanFlag.optional().default(false as unknown as string),
  V3_MIN_VIEW_COUNT: minViewCount,
  V3_MIN_VIEWS_PER_DAY: minViewsPerDay,
  V3_SEMANTIC_MAX_CANDIDATES: semanticMaxCandidates,
  V3_USE_YOUTUBE_RANKING_ONLY: booleanFlag.optional().default(false as unknown as string),
  V3_ENABLE_REDIS_PROVIDER: booleanFlag.optional().default(false as unknown as string),
  V3_TIER1_SOURCES: tier1Sources,
  V3_SEMANTIC_MIN_COSINE: semanticMinCosine,
  V3_TIER2_OVERFETCH: booleanFlag.optional().default(true as unknown as string),
  // CP488 — toggleable code-path flags. Default ON to preserve current
  // behavior; admin can flip to OFF via a new algorithm row to rollback
  // any of the CP488 path additions without a code revert.
  V3_ENABLE_SIGNAL_EXCLUDE: booleanFlag.optional().default(true as unknown as string),
  V3_ENABLE_ZERO_HIT_RETRY: booleanFlag.optional().default(true as unknown as string),
  V3_ENABLE_USER_CURATED_INGEST: booleanFlag.optional().default(true as unknown as string),
  V3_EMPTY_TITLE_GATE_SHADOW: booleanFlag.optional().default(false as unknown as string),
  V3_EMPTY_TITLE_GATE: booleanFlag.optional().default(false as unknown as string),
  V3_POOL_MATCH_TWO_STAGE: booleanFlag.optional().default(false as unknown as string),
  V3_POOL_MATCH_SHORTLIST_K: poolMatchShortlistK,
  V3_POOL_MATCH_OVERFETCH: poolMatchOverfetch,
  V3_POOL_MATCH_EF_SEARCH: poolMatchEfSearch,
  V3_POOL_MATCH_TX_TIMEOUT_MS: poolMatchTxTimeoutMs,
});

export interface V3Config {
  enableTier1Cache: boolean;
  recencyWeight: number;
  recencyHalfLifeMonths: number;
  publishedAfterDays: number;
  enableSemanticRerank: boolean;
  semanticAlpha: number;
  semanticBeta: number;
  enableWhitelistGate: boolean;
  youtubeSearchTimeoutMs: number;
  centerGateMode: CenterGateMode;
  maxQueries: number;
  enableQualityGate: boolean;
  minViewCount: number;
  minViewsPerDay: number;
  semanticMaxCandidates: number;
  useYoutubeRankingOnly: boolean;
  enableRedisProvider: boolean;
  tier1Sources: ReadonlyArray<string>;
  semanticMinCosine: number;
  /**
   * When true (default), Tier 2 always runs and fetches a full per-cell
   * budget of fresh YouTube candidates regardless of Tier 1 fill — live
   * search is the main source, the pool is a minimal device. When false,
   * Tier 2 reverts to deficit-fill (`need = V3_TARGET_PER_CELL - have`).
   */
  tier2Overfetch: boolean;
  /**
   * CP488 — when true (default), card_interactions rows with signal='delete'
   * (user-global) or signal='archive' (this mandala) are added to
   * existingVideoIds before Tier 1 + Tier 2 source pulls. When false, the
   * pipeline behaves as before CP488 (signals only recorded, never read).
   */
  enableSignalExclude: boolean;
  /**
   * CP488 — when true (default), runSearchTraced issues ONE broader fallback
   * `search.list` call with the mandala centerGoal when ≥ 1 query in the
   * fan-out returned 0 items. When false, 0-hit queries are dropped silently
   * (pre-CP488 behavior).
   */
  enableZeroHitRetry: boolean;
  /**
   * CP488 — when true (default), every successful `/like` upserts a
   * `source='user_curated'` row into `video_pool` (fire-and-forget). When
   * false, Heart only records signals + pins; pool unchanged (pre-CP488).
   */
  enableUserCuratedIngest: boolean;
  /**
   * R4 shadow guard (2026-07-04, BL-17) — see `DEFAULT_EMPTY_TITLE_GATE_SHADOW`
   * for the full writeup. Default false = no-op (classification skipped,
   * `mandala-filter.ts` stats.wouldRejectEmptyTitle stays 0).
   */
  emptyTitleGateShadow: boolean;
  /**
   * R4 enforce (2026-07-04, BL-17) — see `DEFAULT_EMPTY_TITLE_GATE` for the
   * full writeup. Default false = no-op (real drop skipped,
   * `mandala-filter.ts` stats.droppedByEmptyTitle stays 0). Separate kill
   * switch from `emptyTitleGateShadow` above.
   */
  emptyTitleGate: boolean;
  /** Two-stage pool matching — see DEFAULT_POOL_MATCH_TWO_STAGE writeup. */
  poolMatchTwoStage: boolean;
  poolMatchShortlistK: number;
  poolMatchOverfetch: number;
  poolMatchEfSearch: number;
  poolMatchTxTimeoutMs: number;
}

export function loadV3Config(env: V3EnvInput = process.env): V3Config {
  const parsed = v3EnvSchema.safeParse({
    V3_ENABLE_TIER1_CACHE: env['V3_ENABLE_TIER1_CACHE'],
    V3_RECENCY_WEIGHT: env['V3_RECENCY_WEIGHT'],
    V3_RECENCY_HALF_LIFE_MONTHS: env['V3_RECENCY_HALF_LIFE_MONTHS'],
    V3_PUBLISHED_AFTER_DAYS: env['V3_PUBLISHED_AFTER_DAYS'],
    V3_ENABLE_SEMANTIC_RERANK: env['V3_ENABLE_SEMANTIC_RERANK'],
    V3_SEMANTIC_ALPHA: env['V3_SEMANTIC_ALPHA'],
    V3_SEMANTIC_BETA: env['V3_SEMANTIC_BETA'],
    V3_ENABLE_WHITELIST_GATE: env['V3_ENABLE_WHITELIST_GATE'],
    V3_YOUTUBE_SEARCH_TIMEOUT_MS: env['V3_YOUTUBE_SEARCH_TIMEOUT_MS'],
    V3_CENTER_GATE_MODE: env['V3_CENTER_GATE_MODE'],
    V3_MAX_QUERIES: env['V3_MAX_QUERIES'],
    V3_ENABLE_QUALITY_GATE: env['V3_ENABLE_QUALITY_GATE'],
    V3_MIN_VIEW_COUNT: env['V3_MIN_VIEW_COUNT'],
    V3_MIN_VIEWS_PER_DAY: env['V3_MIN_VIEWS_PER_DAY'],
    V3_SEMANTIC_MAX_CANDIDATES: env['V3_SEMANTIC_MAX_CANDIDATES'],
    V3_USE_YOUTUBE_RANKING_ONLY: env['V3_USE_YOUTUBE_RANKING_ONLY'],
    V3_ENABLE_REDIS_PROVIDER: env['V3_ENABLE_REDIS_PROVIDER'],
    V3_TIER1_SOURCES: env['V3_TIER1_SOURCES'],
    V3_SEMANTIC_MIN_COSINE: env['V3_SEMANTIC_MIN_COSINE'],
    V3_TIER2_OVERFETCH: env['V3_TIER2_OVERFETCH'],
    V3_ENABLE_SIGNAL_EXCLUDE: env['V3_ENABLE_SIGNAL_EXCLUDE'],
    V3_ENABLE_ZERO_HIT_RETRY: env['V3_ENABLE_ZERO_HIT_RETRY'],
    V3_ENABLE_USER_CURATED_INGEST: env['V3_ENABLE_USER_CURATED_INGEST'],
    V3_EMPTY_TITLE_GATE_SHADOW: env['V3_EMPTY_TITLE_GATE_SHADOW'],
    V3_EMPTY_TITLE_GATE: env['V3_EMPTY_TITLE_GATE'],
    V3_POOL_MATCH_TWO_STAGE: env['V3_POOL_MATCH_TWO_STAGE'],
    V3_POOL_MATCH_SHORTLIST_K: env['V3_POOL_MATCH_SHORTLIST_K'],
    V3_POOL_MATCH_OVERFETCH: env['V3_POOL_MATCH_OVERFETCH'],
    V3_POOL_MATCH_EF_SEARCH: env['V3_POOL_MATCH_EF_SEARCH'],
    V3_POOL_MATCH_TX_TIMEOUT_MS: env['V3_POOL_MATCH_TX_TIMEOUT_MS'],
  });
  if (!parsed.success) {
    return {
      enableTier1Cache: false,
      recencyWeight: DEFAULT_RECENCY_WEIGHT,
      recencyHalfLifeMonths: DEFAULT_RECENCY_HALF_LIFE_MONTHS,
      publishedAfterDays: DEFAULT_PUBLISHED_AFTER_DAYS,
      enableSemanticRerank: false,
      semanticAlpha: DEFAULT_SEMANTIC_ALPHA,
      semanticBeta: DEFAULT_SEMANTIC_BETA,
      enableWhitelistGate: false,
      youtubeSearchTimeoutMs: DEFAULT_YOUTUBE_SEARCH_TIMEOUT_MS,
      centerGateMode: DEFAULT_CENTER_GATE_MODE,
      maxQueries: DEFAULT_MAX_QUERIES,
      enableQualityGate: false,
      minViewCount: DEFAULT_MIN_VIEW_COUNT,
      minViewsPerDay: DEFAULT_MIN_VIEWS_PER_DAY,
      semanticMaxCandidates: DEFAULT_SEMANTIC_MAX_CANDIDATES,
      useYoutubeRankingOnly: DEFAULT_USE_YOUTUBE_RANKING_ONLY,
      enableRedisProvider: DEFAULT_ENABLE_REDIS_PROVIDER,
      tier1Sources: [...DEFAULT_TIER1_SOURCES],
      semanticMinCosine: SEMANTIC_MIN_COSINE,
      tier2Overfetch: true,
      enableSignalExclude: true,
      enableZeroHitRetry: true,
      enableUserCuratedIngest: true,
      emptyTitleGateShadow: DEFAULT_EMPTY_TITLE_GATE_SHADOW,
      emptyTitleGate: DEFAULT_EMPTY_TITLE_GATE,
      poolMatchTwoStage: DEFAULT_POOL_MATCH_TWO_STAGE,
      poolMatchShortlistK: DEFAULT_POOL_MATCH_SHORTLIST_K,
      poolMatchOverfetch: DEFAULT_POOL_MATCH_OVERFETCH,
      poolMatchEfSearch: DEFAULT_POOL_MATCH_EF_SEARCH,
      poolMatchTxTimeoutMs: DEFAULT_POOL_MATCH_TX_TIMEOUT_MS,
    };
  }
  return {
    enableTier1Cache: parsed.data.V3_ENABLE_TIER1_CACHE,
    recencyWeight: parsed.data.V3_RECENCY_WEIGHT,
    recencyHalfLifeMonths: parsed.data.V3_RECENCY_HALF_LIFE_MONTHS,
    publishedAfterDays: parsed.data.V3_PUBLISHED_AFTER_DAYS,
    enableSemanticRerank: parsed.data.V3_ENABLE_SEMANTIC_RERANK,
    semanticAlpha: parsed.data.V3_SEMANTIC_ALPHA,
    semanticBeta: parsed.data.V3_SEMANTIC_BETA,
    enableWhitelistGate: parsed.data.V3_ENABLE_WHITELIST_GATE,
    youtubeSearchTimeoutMs: parsed.data.V3_YOUTUBE_SEARCH_TIMEOUT_MS,
    centerGateMode: parsed.data.V3_CENTER_GATE_MODE,
    maxQueries: parsed.data.V3_MAX_QUERIES,
    enableQualityGate: parsed.data.V3_ENABLE_QUALITY_GATE,
    minViewCount: parsed.data.V3_MIN_VIEW_COUNT,
    minViewsPerDay: parsed.data.V3_MIN_VIEWS_PER_DAY,
    semanticMaxCandidates: parsed.data.V3_SEMANTIC_MAX_CANDIDATES,
    useYoutubeRankingOnly: parsed.data.V3_USE_YOUTUBE_RANKING_ONLY,
    enableRedisProvider: parsed.data.V3_ENABLE_REDIS_PROVIDER,
    tier1Sources: parsed.data.V3_TIER1_SOURCES,
    semanticMinCosine: parsed.data.V3_SEMANTIC_MIN_COSINE,
    tier2Overfetch: parsed.data.V3_TIER2_OVERFETCH,
    enableSignalExclude: parsed.data.V3_ENABLE_SIGNAL_EXCLUDE,
    enableZeroHitRetry: parsed.data.V3_ENABLE_ZERO_HIT_RETRY,
    enableUserCuratedIngest: parsed.data.V3_ENABLE_USER_CURATED_INGEST,
    emptyTitleGateShadow: parsed.data.V3_EMPTY_TITLE_GATE_SHADOW,
    emptyTitleGate: parsed.data.V3_EMPTY_TITLE_GATE,
    poolMatchTwoStage: parsed.data.V3_POOL_MATCH_TWO_STAGE,
    poolMatchShortlistK: parsed.data.V3_POOL_MATCH_SHORTLIST_K,
    poolMatchOverfetch: parsed.data.V3_POOL_MATCH_OVERFETCH,
    poolMatchEfSearch: parsed.data.V3_POOL_MATCH_EF_SEARCH,
    poolMatchTxTimeoutMs: parsed.data.V3_POOL_MATCH_TX_TIMEOUT_MS,
  };
}

export const v3Config: V3Config = loadV3Config();
