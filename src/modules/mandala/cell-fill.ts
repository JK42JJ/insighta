/**
 * Per-cell card-fill counting (CP494 ④-1 full-cell skip).
 *
 * Mirrors MandalaManager.computeCardCount's "grid card" definition
 * (user_local_cards ∪ user_video_states, cell_index >= 0, non-scratchpad,
 * dedup by video_id/url) but GROUPed BY cell_index, so add-cards can skip
 * searching cells the user has already filled. Uses the existing
 * idx_user_video_states_auto_add_lookup [mandala_id, cell_index, auto_added].
 *
 * READ-ONLY. Threshold filter is applied in JS (not SQL HAVING) so it is
 * unit-testable with a mocked client.
 */

/** Minimal raw-query surface (real PrismaClient + jest mock both satisfy it). */
export interface CellCountClient {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

interface CellCountRow {
  cell_index: number;
  c: number;
}

/**
 * Return the cellIndices (0-7) whose grid-card count is >= threshold. These
 * cells are "full enough" → add-cards skips searching them (pool + live).
 * Empty / sparse cells are not returned (normal search proceeds).
 */
export async function getFullCellIndices(
  prisma: CellCountClient,
  userId: string,
  mandalaId: string,
  threshold: number
): Promise<number[]> {
  const rows = await prisma.$queryRaw<CellCountRow[]>`
    WITH all_cards AS (
      SELECT cell_index, COALESCE(video_id, url) AS dedup_key
        FROM public.user_local_cards
       WHERE user_id = ${userId}::uuid
         AND mandala_id = ${mandalaId}::uuid
         AND cell_index IS NOT NULL AND cell_index >= 0
         AND (level_id IS NULL OR level_id <> 'scratchpad')
      UNION
      SELECT uvs.cell_index, yv.youtube_video_id AS dedup_key
        FROM public.user_video_states uvs
        JOIN public.youtube_videos yv ON yv.id = uvs.video_id
       WHERE uvs.user_id = ${userId}::uuid
         AND uvs.mandala_id = ${mandalaId}::uuid
         AND uvs.cell_index >= 0
         AND uvs.level_id <> 'scratchpad'
    )
    SELECT cell_index, COUNT(DISTINCT dedup_key)::int AS c
    FROM all_cards
    GROUP BY cell_index
  `;
  return filterFullCells(rows, threshold);
}

/** Pure threshold filter — exported for unit tests. */
export function filterFullCells(rows: CellCountRow[], threshold: number): number[] {
  return rows.filter((r) => r.c >= threshold).map((r) => r.cell_index);
}

/** Re-export the row type for callers/tests. */
export type { CellCountRow };
