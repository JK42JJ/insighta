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

const log = logger.child({ module: 'video-discover/v3/cache-matcher' });

/** Minimum cosine similarity to admit a cached video to a cell. */
export const DEFAULT_RELEVANCE_THRESHOLD = 0.3;
/** Tiers eligible for Tier 1 matching. bronze is kept in the pool for
 *  diagnostics but never surfaced here. */
export const MATCHED_QUALITY_TIERS: ReadonlyArray<'gold' | 'silver'> = ['gold', 'silver'];

export interface CachedMatch {
  videoId: string;
  title: string;
  description: string | null;
  channelName: string | null;
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
}

interface MatchRow {
  video_id: string;
  title: string;
  description: string | null;
  channel_name: string | null;
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
  const db = getPrismaClient();

  const rows = await db.$queryRaw<MatchRow[]>(Prisma.sql`
    WITH mandala_embs AS (
      SELECT sub_goal_index AS cell_index, embedding
        FROM public.mandala_embeddings
       WHERE mandala_id = ${opts.mandalaId}
         AND level = 1
         AND embedding IS NOT NULL
    ),
    scored AS (
      SELECT
        vp.video_id,
        vp.title,
        vp.description,
        vp.channel_name,
        vp.thumbnail_url,
        vp.view_count,
        vp.like_count,
        vp.duration_seconds,
        vp.published_at,
        me.cell_index,
        1 - (vpe.embedding <=> me.embedding) AS score
      FROM public.video_pool vp
      JOIN public.video_pool_embeddings vpe
        ON vp.video_id = vpe.video_id
      CROSS JOIN mandala_embs me
      WHERE vp.is_active = true
        AND vp.language = ${opts.language}
        AND vp.quality_tier IN ('gold', 'silver')
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

  return rows.map((r) => ({
    videoId: r.video_id,
    title: r.title,
    description: r.description,
    channelName: r.channel_name,
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
