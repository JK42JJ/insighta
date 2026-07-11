/**
 * video-discover v3 — Tier 1: cache matcher
 *
 * Matches a mandala's 8 sub_goal embeddings against the video_pool cache
 * via pgvector cosine similarity. Uses brute-force `<=>` (no IVFFlat yet —
 * the index requires ~5k rows of training data; until then the pool is
 * small enough that brute-force is fine).
 *
 * Output: per-cell list of (videoId, score, metadata) sorted by score desc,
 * already capped at `perCell`. Caller assembles into CellAssignment.
 *
 * Design: docs/design/insighta-video-cache-layer-design.md §5-1
 */

import { getPrismaClient } from '@/modules/database';
import { Prisma } from '@prisma/client';
import { logger } from '@/utils/logger';
import { recordTrace } from '@/modules/discover-tracing';

const log = logger.child({ module: 'video-discover/v3/cache-matcher' });

export const DEFAULT_RELEVANCE_THRESHOLD = 0.5;
/** Tiers eligible for Tier 1 matching. bronze is kept in the pool for
 *  diagnostics but never surfaced here. */
export const MATCHED_QUALITY_TIERS: ReadonlyArray<'gold' | 'silver'> = ['gold', 'silver'];

export interface CachedMatch {
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
  score: number; // cosine similarity in [0, 1]
}

export interface MatchFromVideoPoolOpts {
  mandalaId: string;
  language: 'ko' | 'en';
  perCell?: number;
  threshold?: number;
  /**
   * Restrict to video_pool rows by source tag. Default `['v2_promoted']`
   * gates out batch_trend (untriaged trend-cron rows) which carry
   * cross-domain noise — measured CP455 (mandala c1ba1e9f cell 6 = 28
   * 토익스피킹 with cosine 0.55+). v2_promoted are CC-authored v2
   * summaries with completeness ≥ 0.7, structurally on-topic.
   */
  sources?: ReadonlyArray<string>;
}

interface MatchRow {
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
  cell_index: number;
  score: number;
  rn: bigint;
}

/**
 * Pull the top `perCell` videos per cell from video_pool whose cosine
 * similarity to the corresponding sub_goal embedding meets `threshold`.
 *
 * Returns [] when either:
 *   - the mandala has no level=1 embeddings (caller should have populated
 *     them before calling — mirrors v2.preflight behavior), OR
 *   - video_pool has zero active rows for `language` (cold start).
 */
export async function matchFromVideoPool(opts: MatchFromVideoPoolOpts): Promise<CachedMatch[]> {
  const perCell = opts.perCell ?? 5;
  const threshold = opts.threshold ?? DEFAULT_RELEVANCE_THRESHOLD;
  const sources = opts.sources ?? ['v2_promoted'];
  const db = getPrismaClient();
  const t0 = Date.now();

  // CP458: materialise the eligible video_pool subset (index scan, fast)
  // BEFORE joining video_pool_embeddings, so pgvector cosine runs only over
  // the eligible rows — not the whole embeddings table. EXPLAIN ANALYZE on
  // prod: pre-CP458 the planner hash-joined (mandala × Seq Scan ALL 11,123
  // embeddings) → 89k cosine ops → 65-100s. With the eligible CTE first +
  // sources=['v2_promoted'] (1,156 ko rows): ~9k cosine → ~2.9s.
  const rows = await db.$queryRaw<MatchRow[]>(Prisma.sql`
    WITH eligible AS (
      SELECT
        video_id, title, description, channel_name, channel_id,
        thumbnail_url, view_count, like_count, duration_seconds, published_at
      FROM public.video_pool
      WHERE is_active = true
        AND language = ${opts.language}
        AND quality_tier IN ('gold', 'silver')
        AND source = ANY(${sources}::text[])
    ),
    mandala_embs AS (
      SELECT sub_goal_index AS cell_index, embedding
        FROM public.mandala_embeddings
       WHERE mandala_id = ${opts.mandalaId}
         AND level = 1
         AND embedding IS NOT NULL
    ),
    scored AS (
      SELECT
        e.video_id,
        e.title,
        e.description,
        e.channel_name,
        e.channel_id,
        e.thumbnail_url,
        e.view_count,
        e.like_count,
        e.duration_seconds,
        e.published_at,
        me.cell_index,
        1 - (vpe.embedding <=> me.embedding) AS score
      FROM eligible e
      JOIN public.video_pool_embeddings vpe
        ON vpe.video_id = e.video_id
      CROSS JOIN mandala_embs me
    ),
    ranked AS (
      SELECT
        s.*,
        ROW_NUMBER() OVER (
          PARTITION BY s.cell_index
          ORDER BY s.score DESC
        ) AS rn
      FROM scored s
      WHERE s.score >= ${threshold}
    )
    SELECT * FROM ranked WHERE rn <= ${perCell}
    ORDER BY cell_index ASC, score DESC
  `);

  log.info(
    `cache match: mandala=${opts.mandalaId} lang=${opts.language} matches=${rows.length} threshold=${threshold}`
  );

  // CP457+ trace — capture SQL inputs + per-cell row sample.
  recordTrace({
    step: 'tier1.match_from_video_pool',
    status: 'ok',
    request: {
      mandalaId: opts.mandalaId,
      language: opts.language,
      sources,
      threshold,
      perCell,
    },
    response: {
      row_count: rows.length,
      rows: rows.slice(0, 60).map((r) => ({
        videoId: r.video_id,
        title: r.title,
        cell_index: r.cell_index,
        score: r.score,
      })),
    },
    latencyMs: Date.now() - t0,
  });

  return rows.map((r) => ({
    videoId: r.video_id,
    title: r.title,
    description: r.description,
    channelName: r.channel_name,
    channelId: r.channel_id,
    thumbnail: r.thumbnail_url,
    viewCount: r.view_count == null ? null : Number(r.view_count),
    likeCount: r.like_count == null ? null : Number(r.like_count),
    durationSec: r.duration_seconds,
    publishedAt: r.published_at,
    cellIndex: r.cell_index,
    score: r.score,
  }));
}

/**
 * Options for `matchFromVideoPoolByCenterGoal` (CP457).
 *
 * Used by the ephemeral / wizard-precompute path where no `mandala_id`
 * exists yet — so `mandala_embeddings` table is unavailable. Instead the
 * caller embeds `centerGoal` once and we run pgvector cosine against
 * `video_pool_embeddings` with that single vector.
 *
 * Cell assignment falls back to argmax token-overlap over `subGoals`,
 * the same pattern used by `tsvectorKeywordCandidates` in
 * `hybrid-rerank.ts:212-224`. When centerGateMode='semantic' in the
 * downstream executor the post-Tier-1 mandala-filter may reassign cells;
 * we still need a meaningful initial value because non-semantic modes
 * (substring/subword/off) skip that reassignment.
 */
export interface MatchByCenterGoalOpts {
  /** 4096-d qwen3-embedding:8b vector of the wizard `centerGoal`. */
  centerEmbedding: ReadonlyArray<number>;
  /** Eight sub_goal strings; argmax token overlap drives cellIndex. */
  subGoals: ReadonlyArray<string>;
  language: 'ko' | 'en';
  limit?: number;
  /** Minimum cosine to admit. Caller passes `v3Config.semanticMinCosine`. */
  threshold?: number;
  /** Same default + override semantics as `matchFromVideoPool`. */
  sources?: ReadonlyArray<string>;
}

interface CenterMatchRow {
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
  score: number;
}

/**
 * Tier 1 cache match against a single center-goal embedding (no mandala_id).
 *
 * Returns up to `limit` rows from `video_pool`, sorted by cosine desc
 * against `centerEmbedding`, restricted to gold+silver, language match,
 * is_active=true, and `sources` whitelist (default `['v2_promoted']`).
 *
 * Cell index is assigned per-row via argmax token-overlap with `subGoals`
 * (lower-case tokenisation on title). Mirrors the tsvector-keyword-path
 * cell-assignment so ephemeral Tier 1 + Tier 2 hybrid candidates share
 * an identical distribution rule.
 *
 * Returns `[]` when the pool has zero gold+silver rows for the language
 * or `centerEmbedding.length === 0` (defensive — caller should never).
 */
export async function matchFromVideoPoolByCenterGoal(
  opts: MatchByCenterGoalOpts
): Promise<CachedMatch[]> {
  if (opts.centerEmbedding.length === 0) return [];
  const limit = opts.limit ?? 64;
  const threshold = opts.threshold ?? DEFAULT_RELEVANCE_THRESHOLD;
  const sources = opts.sources ?? ['v2_promoted'];
  const db = getPrismaClient();
  const t0 = Date.now();

  // pgvector requires the literal vector cast — `${array}::vector` doesn't
  // resolve a JS array through Prisma's template parameter binding, so we
  // serialise to the `[v1,v2,...]` text form and let Postgres cast.
  const vectorLiteral = `[${opts.centerEmbedding.join(',')}]`;

  // CP467: dropped the `WHERE 1 - (cosine) >= threshold` filter that was
  // forcing the planner into a full Seq Scan + Sort path (ivfflat
  // `idx_vpool_emb_cosine` unused — EXPLAIN measured ~10s vs ~1.4s
  // without the filter). Threshold is applied post-fetch in JS instead;
  // ORDER BY + LIMIT keeps ANN-style top-k behaviour and lets the
  // planner choose the embedding index when beneficial. The eligible
  // CTE is still materialised first so only the gold|silver|active
  // subset enters the cosine path.
  const rows = await db.$queryRaw<CenterMatchRow[]>(Prisma.sql`
    WITH eligible AS (
      SELECT
        video_id, title, description, channel_name, channel_id,
        thumbnail_url, view_count, like_count, duration_seconds, published_at
      FROM public.video_pool
      WHERE is_active = true
        AND language = ${opts.language}
        AND quality_tier IN ('gold', 'silver')
        AND source = ANY(${sources}::text[])
    )
    SELECT
      e.video_id,
      e.title,
      e.description,
      e.channel_name,
      e.channel_id,
      e.thumbnail_url,
      e.view_count,
      e.like_count,
      e.duration_seconds,
      e.published_at,
      1 - (vpe.embedding <=> ${vectorLiteral}::vector) AS score
    FROM eligible e
    JOIN public.video_pool_embeddings vpe
      ON vpe.video_id = e.video_id
    ORDER BY vpe.embedding <=> ${vectorLiteral}::vector ASC
    LIMIT ${limit}
  `);

  // Post-fetch threshold gate — preserves semantic floor without
  // poisoning the SQL planner.
  const aboveThreshold = rows.filter((r) => r.score >= threshold);

  const subTokens = opts.subGoals.map((sg) => tokenizeLower(sg ?? ''));
  const matches: CachedMatch[] = aboveThreshold.map((r) => {
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
    return {
      videoId: r.video_id,
      title: r.title,
      description: r.description,
      channelName: r.channel_name,
      channelId: r.channel_id,
      thumbnail: r.thumbnail_url,
      viewCount: r.view_count == null ? null : Number(r.view_count),
      likeCount: r.like_count == null ? null : Number(r.like_count),
      durationSec: r.duration_seconds,
      publishedAt: r.published_at,
      cellIndex: bestCell,
      score: r.score,
    };
  });

  log.info(
    `cache match (by center-goal): lang=${opts.language} sources=[${sources.join(',')}] threshold=${threshold} matches=${matches.length}`
  );

  // CP457+ trace — ephemeral path Tier 1 SQL inputs + outcome.
  recordTrace({
    step: 'tier1.match_by_center_goal',
    status: 'ok',
    request: {
      language: opts.language,
      sources,
      threshold,
      limit,
      centerEmbedding_dim: opts.centerEmbedding.length,
      subGoals_count: opts.subGoals.length,
    },
    response: {
      row_count: matches.length,
      rows: matches.slice(0, 60).map((m) => ({
        videoId: m.videoId,
        title: m.title,
        cell_index: m.cellIndex,
        score: m.score,
      })),
    },
    latencyMs: Date.now() - t0,
  });

  return matches;
}

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
 * Distribute cached matches into 8 cell buckets (cellIndex 0..7). Already
 * sorted per cell by score desc. Caller is responsible for merging with
 * Tier 2 fallback and upserting to recommendation_cache.
 */
export function groupByCell(
  matches: ReadonlyArray<CachedMatch>,
  nCells: number
): Map<number, CachedMatch[]> {
  const out = new Map<number, CachedMatch[]>();
  for (let i = 0; i < nCells; i++) out.set(i, []);
  for (const m of matches) {
    const bucket = out.get(m.cellIndex);
    if (bucket) bucket.push(m);
  }
  return out;
}
