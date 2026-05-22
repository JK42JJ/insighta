/**
 * src/modules/chatbot-rag/mandala-cards-loader.ts
 *
 * Block J source — the mandala home page's "N장" count + recent video
 * list. CP467b server-truth: the user-facing count combines BOTH
 * `user_local_cards` (manual paste / D&D) AND `user_video_states`
 * (mandala-mapped video subscriptions) and dedupes by YouTube video id
 * (falling back to URL for non-YouTube cards). LeftPanel sidebar shows
 * `user_local_cards` only (a subset), but the mandala grid header
 * "N장" — which is what users actually see and ask about — uses the
 * union. Block J mirrors the union so the chatbot answers the same
 * number the user reads.
 *
 * Mirror of `src/modules/mandala/manager.ts:299-320` (`computeCardCount`).
 * If that query changes, this one must change too.
 *
 * Failures degrade silently to `null` so the chatbot still answers via
 * the rest of the prompt blocks.
 */

import { getPrismaClient } from '@/modules/database/client';
import { logger } from '@/utils/logger';
import { MAX_MANDALA_CARDS, type MandalaCardSummary, type MandalaCardsContext } from './types';

const log = logger.child({ module: 'chatbot-rag/mandala-cards-loader' });

export interface LoadMandalaCardsParams {
  userId: string;
  mandalaId: string;
  /** Optional cell labels to resolve cell_name (subjects[0..7] from user_mandala_levels). */
  cellLabels?: ReadonlyArray<string | null>;
}

/** One row from the union below. `title` may be null for older video_states rows. */
interface UnionRow {
  source: 'local' | 'state';
  dedup_key: string;
  title: string | null;
  metadata_title: string | null;
  video_id: string | null;
  cell_index: number | null;
  created_at: Date;
}

/**
 * Loads the mandala's cards (manual + video-state union, deduped) for Block J.
 * Returns null on missing mandalaId / DB error.
 */
export async function loadMandalaCards(
  params: LoadMandalaCardsParams
): Promise<MandalaCardsContext | null> {
  if (!params.mandalaId) return null;
  const prisma = getPrismaClient();

  try {
    // Mirror of manager.ts:299-320 `computeCardCount` — UNION of
    // user_local_cards (placed cells, level_id != scratchpad) and
    // user_video_states (mandala-mapped, level_id != scratchpad), with
    // YouTube id from a JOIN on youtube_videos for the video_states
    // branch. Dedup key: video_id (YouTube 11-char) when available,
    // else url (for non-YouTube cards).
    const [countRows, recentRows] = await Promise.all([
      prisma.$queryRaw<Array<{ c: number }>>`
        WITH all_cards AS (
          SELECT COALESCE(video_id, url) AS dedup_key
            FROM public.user_local_cards
           WHERE user_id = ${params.userId}::uuid
             AND mandala_id = ${params.mandalaId}::uuid
             AND cell_index IS NOT NULL AND cell_index >= 0
             AND (level_id IS NULL OR level_id <> 'scratchpad')
          UNION
          SELECT yv.youtube_video_id AS dedup_key
            FROM public.user_video_states uvs
            JOIN public.youtube_videos yv ON yv.id = uvs.video_id
           WHERE uvs.user_id = ${params.userId}::uuid
             AND uvs.mandala_id = ${params.mandalaId}::uuid
             AND uvs.cell_index >= 0
             AND uvs.level_id <> 'scratchpad'
        )
        SELECT COUNT(DISTINCT dedup_key)::int AS c FROM all_cards
      `,
      prisma.$queryRaw<UnionRow[]>`
        SELECT * FROM (
          SELECT
            'local'::text AS source,
            COALESCE(video_id, url) AS dedup_key,
            title,
            metadata_title,
            video_id,
            cell_index,
            created_at
            FROM public.user_local_cards
           WHERE user_id = ${params.userId}::uuid
             AND mandala_id = ${params.mandalaId}::uuid
             AND cell_index IS NOT NULL AND cell_index >= 0
             AND (level_id IS NULL OR level_id <> 'scratchpad')
          UNION ALL
          SELECT
            'state'::text AS source,
            yv.youtube_video_id AS dedup_key,
            yv.title AS title,
            NULL::text AS metadata_title,
            yv.youtube_video_id AS video_id,
            uvs.cell_index,
            uvs.created_at
            FROM public.user_video_states uvs
            JOIN public.youtube_videos yv ON yv.id = uvs.video_id
           WHERE uvs.user_id = ${params.userId}::uuid
             AND uvs.mandala_id = ${params.mandalaId}::uuid
             AND uvs.cell_index >= 0
             AND uvs.level_id <> 'scratchpad'
        ) combined
        ORDER BY created_at DESC
        LIMIT ${MAX_MANDALA_CARDS * 2}
      `,
    ]);

    const totalCount = countRows[0]?.c ?? 0;

    // Dedup recent rows by dedup_key (UNION ALL in the SQL keeps both
    // sources; we drop duplicates here so a single video that appears
    // in BOTH user_local_cards and user_video_states surfaces once).
    const seen = new Set<string>();
    const cards: MandalaCardSummary[] = [];
    for (const row of recentRows) {
      if (seen.has(row.dedup_key)) continue;
      seen.add(row.dedup_key);

      const title = (row.title ?? row.metadata_title ?? '').trim();
      if (title.length === 0) continue;

      const cellIndex = row.cell_index ?? -1;
      const cellName =
        cellIndex >= 1 && cellIndex <= 8 && params.cellLabels
          ? (params.cellLabels[cellIndex - 1] ?? undefined)
          : undefined;

      const summary: MandalaCardSummary = {
        video_id: row.video_id,
        title,
        cell_index: cellIndex,
      };
      if (cellName) summary.cell_name = cellName;
      cards.push(summary);

      if (cards.length >= MAX_MANDALA_CARDS) break;
    }

    return {
      mandala_id: params.mandalaId,
      total_count: totalCount,
      cards,
    };
  } catch (err) {
    log.warn('mandala-cards-loader query failed', {
      userId: params.userId,
      mandalaId: params.mandalaId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
