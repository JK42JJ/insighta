/**
 * Chunk anchor lookup — maps video_id to best-matching transcript chunk
 * `start_time` for FE timestamp deep-link (`youtube.com/watch?v=<id>&t=<s>s`).
 *
 * Source: `video_chunk_embeddings.start_time` (populated by external Mac Mini
 * batch — see docs/reports/wizard-dashboard-diagnosis-2026-05-12.md §6).
 *
 * Strategy:
 *   - For an unfiltered MVP, we pick the FIRST chunk (chunk_idx ASC) of each
 *     video. This is "an anchor", not necessarily "the most relevant anchor".
 *   - When PR1 hybrid-rerank lands, the v3 executor will be able to pass the
 *     best-scored chunk's start_time directly. Until then, first-chunk fallback
 *     is strictly better than no anchor (user lands somewhere coherent).
 *   - Most videos have no chunks (only 64 unique videos out of 1,493
 *     rec_cache rows as of 2026-05-12). For those, we return null and the
 *     caller falls back to plain youtube.com/watch?v=<id>.
 */

import { getPrismaClient } from '@/modules/database/client';
import { Prisma } from '@prisma/client';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'chunk-anchor' });

/**
 * Look up the first available chunk start_time for each of the given videoIds.
 *
 * @param videoIds  YouTube video IDs (length-deduped by caller is OK but not required)
 * @returns         Map<videoId, startSec> — entries only present when chunk exists
 *
 * Non-fatal: returns empty map on DB error. Caller falls back to no anchor.
 */
export async function lookupChunkAnchors(
  videoIds: ReadonlyArray<string>
): Promise<Map<string, number>> {
  const out = new Map<string, number>();

  if (videoIds.length === 0) return out;

  // Dedupe before query.
  const uniqueIds = Array.from(new Set(videoIds));

  try {
    const prisma = getPrismaClient();
    // DISTINCT ON keeps the first chunk_idx per video_id — cheap given the
    // existing `(video_id, chunk_idx)` unique index.
    const rows = await prisma.$queryRaw<Array<{ video_id: string; start_time: number }>>(
      Prisma.sql`
        SELECT DISTINCT ON (video_id)
          video_id, start_time
        FROM public.video_chunk_embeddings
        WHERE video_id = ANY(${uniqueIds}::text[])
          AND start_time IS NOT NULL
        ORDER BY video_id, chunk_idx ASC
      `
    );

    for (const r of rows) {
      // Postgres `real` → number; coerce + floor for cleaner URL.
      const sec = Math.max(0, Math.floor(Number(r.start_time)));
      out.set(r.video_id, sec);
    }
  } catch (err) {
    log.warn('chunk-anchor lookup failed, falling back to no anchor', {
      error: err instanceof Error ? err.message : String(err),
      n: uniqueIds.length,
    });
    // Return empty map — callers treat missing entries as "no anchor".
  }

  return out;
}
