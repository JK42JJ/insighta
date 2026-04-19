/**
 * video-dictionary — semantic rank (consumer module for video_chunk_embeddings)
 *
 * pgvector cosine similarity between mandala cell embeddings (level=1,
 * 4096-dim) and video transcript chunk embeddings (4096-dim, same
 * qwen3-embedding:8b space — directly comparable).
 *
 * Signature per synthesis spec §6.2:
 *   getSemanticRank(mandalaId, videoIds[]) → Map<videoId, cosine | null>
 *
 * Fallback contract (§6.2, §4.3): a videoId with zero embedding rows returns
 * `null` — caller keeps the pre-filter `rec_score` with no penalty.
 *
 * Query: sequential scan inside `WHERE video_id = ANY($ids)` predicate.
 * Migration comment in 001_create_table.sql documents the chosen trade-off —
 * no HNSW/IVFFlat index is possible on 4096-dim `vector` today (pgvector
 * 0.8.0 caps both at 2000 dims). At Phase 0 scale (~6000 chunks per query)
 * the scan is <100ms.
 */

import { Prisma } from '@prisma/client';

import { getPrismaClient } from '@/modules/database';
import { logger } from '@/utils/logger';

import type { SemanticRankOptions, SemanticRankResult } from './types';

const log = logger.child({ module: 'video-dictionary/semantic-rank' });

interface RankRow {
  video_id: string;
  cosine: number;
}

/**
 * Compute per-video cosine similarity for semantic rerank.
 *
 * When `cellAssignments` is provided, cosine is taken against the assigned
 * cell's embedding only (§4.2). When omitted, cosine is max-pooled across
 * all cells — gives upper-bound similarity but may reward cross-cell matches.
 */
export async function getSemanticRank(opts: SemanticRankOptions): Promise<SemanticRankResult> {
  const result: SemanticRankResult = new Map();
  if (opts.videoIds.length === 0) return result;

  // Seed result with nulls so callers can rely on map-has for every input id
  // (tests + callers expect this invariant).
  for (const id of opts.videoIds) result.set(id, null);

  const db = getPrismaClient();
  const videoIds = Array.from(new Set(opts.videoIds));
  const assignments = opts.cellAssignments;

  try {
    const rows =
      assignments && assignments.size > 0
        ? await queryCellTargeted(db, opts.mandalaId, videoIds, assignments)
        : await queryMaxAcrossCells(db, opts.mandalaId, videoIds);

    for (const row of rows) {
      const raw = row.cosine;
      const clamped = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : null;
      result.set(row.video_id, clamped);
    }

    log.debug(
      `semantic rank: mandala=${opts.mandalaId} in=${videoIds.length} matched=${rows.length} targeted=${Boolean(assignments)}`
    );
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`semantic rank query failed: ${msg}`);
    // Fallback contract: on query error, return all-null map (callers use
    // pre-filter rec_score, no penalty).
    return result;
  }
}

/**
 * Cell-targeted cosine: join video chunks to the specific cell the caller
 * pre-assigned. Max-pools cosine across chunks (§4.2 "video_chunk_embedding_max").
 */
async function queryCellTargeted(
  db: ReturnType<typeof getPrismaClient>,
  mandalaId: string,
  videoIds: string[],
  assignments: ReadonlyMap<string, number>
): Promise<RankRow[]> {
  // Build (video_id, cell_index) pairs the caller cares about. Postgres
  // `unnest(array, array)` paired with a join on both columns keeps the
  // query single-pass.
  const pairs: Array<[string, number]> = [];
  for (const id of videoIds) {
    const cell = assignments.get(id);
    if (cell == null) continue;
    pairs.push([id, cell]);
  }
  if (pairs.length === 0) return [];

  const vidArr = pairs.map((p) => p[0]);
  const cellArr = pairs.map((p) => p[1]);

  return db.$queryRaw<RankRow[]>(Prisma.sql`
    WITH targets AS (
      SELECT v.video_id, v.cell_index
      FROM unnest(${vidArr}::text[], ${cellArr}::int[]) AS v(video_id, cell_index)
    ),
    mandala_cells AS (
      SELECT sub_goal_index AS cell_index, embedding
      FROM public.mandala_embeddings
      WHERE mandala_id = ${mandalaId}
        AND level = 1
        AND embedding IS NOT NULL
    ),
    scored AS (
      SELECT
        vce.video_id,
        MAX(1 - (vce.embedding <=> mc.embedding)) AS cosine
      FROM public.video_chunk_embeddings vce
      JOIN targets t ON t.video_id = vce.video_id
      JOIN mandala_cells mc ON mc.cell_index = t.cell_index
      GROUP BY vce.video_id
    )
    SELECT video_id, cosine FROM scored
  `);
}

/**
 * Max-across-cells cosine: no caller-provided cell assignment. For each
 * video, take max cosine across (all chunks × all 8 cells). Simpler but
 * looser than cell-targeted (§4.2 is cell-targeted; this is the fallback).
 */
async function queryMaxAcrossCells(
  db: ReturnType<typeof getPrismaClient>,
  mandalaId: string,
  videoIds: string[]
): Promise<RankRow[]> {
  return db.$queryRaw<RankRow[]>(Prisma.sql`
    WITH mandala_cells AS (
      SELECT embedding
      FROM public.mandala_embeddings
      WHERE mandala_id = ${mandalaId}
        AND level = 1
        AND embedding IS NOT NULL
    ),
    scored AS (
      SELECT
        vce.video_id,
        MAX(1 - (vce.embedding <=> mc.embedding)) AS cosine
      FROM public.video_chunk_embeddings vce
      CROSS JOIN mandala_cells mc
      WHERE vce.video_id = ANY(${videoIds}::text[])
      GROUP BY vce.video_id
    )
    SELECT video_id, cosine FROM scored
  `);
}
