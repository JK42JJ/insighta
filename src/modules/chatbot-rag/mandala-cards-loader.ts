/**
 * src/modules/chatbot-rag/mandala-cards-loader.ts
 *
 * Block J source — the card list shown in the LearningPage left sidebar.
 *
 * Mirror invariant: this query MUST match the LeftPanel.tsx filter
 * (`c.mandalaId === mandalaId && c.cellIndex >= 0`). Drift would mean
 * the chatbot answers "영상 N개" while the sidebar shows a different
 * count — a credibility-breaking inconsistency.
 *
 *   LeftPanel.tsx:32-35
 *   const { cards } = useLocalCards();
 *   const mandalaCards = cards.filter(
 *     (c) => c.mandalaId === mandalaId && c.cellIndex >= 0
 *   );
 *
 * Cells with `cell_index = -1` (scratchpad) are excluded — these
 * represent rough captures the user has not yet placed in the mandala.
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

/**
 * Loads the mandala's placed cards (cell_index >= 0) for Block J.
 * Returns null on missing mandalaId / DB error — caller treats null as
 * "block omitted".
 */
export async function loadMandalaCards(
  params: LoadMandalaCardsParams
): Promise<MandalaCardsContext | null> {
  if (!params.mandalaId) return null;
  const prisma = getPrismaClient();

  try {
    // LeftPanel mirror: user_id + mandala_id + cell_index >= 0.
    const [totalCount, recentRows] = await Promise.all([
      prisma.user_local_cards.count({
        where: {
          user_id: params.userId,
          mandala_id: params.mandalaId,
          cell_index: { gte: 0 },
        },
      }),
      prisma.user_local_cards.findMany({
        where: {
          user_id: params.userId,
          mandala_id: params.mandalaId,
          cell_index: { gte: 0 },
        },
        select: {
          title: true,
          metadata_title: true,
          video_id: true,
          cell_index: true,
        },
        orderBy: { created_at: 'desc' },
        take: MAX_MANDALA_CARDS,
      }),
    ]);

    const cards: MandalaCardSummary[] = recentRows
      .map((row) => {
        // Prefer human-set title; fall back to scraped metadata; drop rows
        // with neither (typically link_type='note' scratchpads — already
        // filtered by cell_index>=0 in most cases, defensive belt+braces).
        const title = (row.title ?? row.metadata_title ?? '').trim();
        if (title.length === 0) return null;
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
        return summary;
      })
      .filter((c): c is MandalaCardSummary => c !== null);

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
