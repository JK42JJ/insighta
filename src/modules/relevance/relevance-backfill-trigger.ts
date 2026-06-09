/**
 * Relevance backfill trigger — CP498 PR3b (A-stage).
 *
 * Fans out one enrich-relevance-quick job per UNSCORED placed card row in a
 * mandala, across both user-scoped tables (user_video_states + user_local_cards).
 *
 * ⚠️ ONE deliberate divergence from rich-summary-trigger.ts: NO video-id dedup.
 * rich-summary-trigger collapses both tables into a Map keyed by YouTube video
 * id (one enrich job per video) — correct there, because a rich summary IS a
 * video attribute. It is WRONG for relevance: relevance is a relation
 * (video × this row's centerGoal), so the fan-out unit MUST be the ROW
 * (table, id). The same video placed in two cells/mandalas → two jobs → two
 * independent scores. Collapsing to video would re-introduce the cross-user
 * leak that PR3a's import-purity closed. The regression test
 * (relevance-backfill-trigger.test.ts) locks this: two rows, same video_id,
 * two enqueues.
 */

import { getPrismaClient } from '@/modules/database/client';
import { getMandalaManager } from '@/modules/mandala/manager';
import { enqueueRelevanceQuick } from '@/modules/queue/handlers/enrich-relevance-quick';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'RelevanceBackfillTrigger' });

export interface RelevanceBackfillResult {
  enqueued: number;
  skipped: number;
  uvsRows: number;
  ulcRows: number;
}

/**
 * Enqueue relevance-quick jobs for a mandala's unscored placed cards.
 *
 * @param applyCutoff true = AUTO path: only score cards created strictly after
 *   `cutoff` (new cards). false = admin manual: all unscored placed cards,
 *   cutoff ignored. The BACKFILL_RELEVANCE_ENABLED flag is checked by the AUTO
 *   call sites, NOT here — the admin route must work while the flag is off so a
 *   controlled 1-mandala measurement can run.
 */
export async function enqueueRelevanceBackfillForMandala(params: {
  userId: string;
  mandalaId: string;
  applyCutoff: boolean;
  cutoff?: string;
}): Promise<RelevanceBackfillResult> {
  const prisma = getPrismaClient();

  // Resolve the mandala centerGoal once (root level depth=0) — same source as
  // enrich-rich-summary.ts:174. Empty ⇒ compute returns 0 per the quick prompt.
  let centerGoal = '';
  let cellGoals: string[] = [];
  try {
    const mandala = await getMandalaManager().getMandalaById(params.userId, params.mandalaId);
    centerGoal = mandala?.levels[0]?.centerGoal ?? '';
    // CP499 — the 8 cell sub-goals from the SAME fetched mandala (0 extra query).
    // cellGoals[cell_index] is the per-card cell goal forwarded to the SSOT scorer.
    cellGoals = mandala?.levels[0]?.subjects ?? [];
  } catch (err) {
    log.warn('mandala lookup failed (continuing with empty centerGoal)', {
      userId: params.userId,
      mandalaId: params.mandalaId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const cutoffDate = params.applyCutoff && params.cutoff ? new Date(params.cutoff) : undefined;

  // Placed (cell_index >= 0), not-yet-scored cards in this mandala. NO dedup —
  // one job per ROW. uvs createdAt is mapped from created_at; ulc is created_at.
  const [videoStates, localCards] = await Promise.all([
    prisma.userVideoState.findMany({
      where: {
        user_id: params.userId,
        mandala_id: params.mandalaId,
        cell_index: { gte: 0 },
        relevance_pct: null,
        ...(cutoffDate ? { createdAt: { gt: cutoffDate } } : {}),
      },
      select: { id: true, cell_index: true, video: { select: { title: true } } },
    }),
    prisma.user_local_cards.findMany({
      where: {
        user_id: params.userId,
        mandala_id: params.mandalaId,
        cell_index: { gte: 0 },
        relevance_pct: null,
        ...(cutoffDate ? { created_at: { gt: cutoffDate } } : {}),
      },
      select: {
        id: true,
        cell_index: true,
        title: true,
        metadata_title: true,
        metadata_description: true,
      },
    }),
  ]);

  let enqueued = 0;
  let skipped = 0;

  // uvs = title-only relevance (no description stored on the row; handoff).
  for (const row of videoStates) {
    try {
      const jobId = await enqueueRelevanceQuick({
        table: 'uvs',
        rowId: row.id,
        title: row.video?.title ?? '',
        centerGoal,
        cellGoal: row.cell_index != null ? cellGoals[row.cell_index] : undefined,
      });
      if (jobId) enqueued += 1;
      else skipped += 1;
    } catch (err) {
      skipped += 1;
      log.warn('enqueue failed (uvs row, non-fatal)', {
        rowId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ulc carries its own metadata (title / metadata_title + metadata_description).
  for (const row of localCards) {
    try {
      const jobId = await enqueueRelevanceQuick({
        table: 'ulc',
        rowId: row.id,
        title: row.title ?? row.metadata_title ?? '',
        description: row.metadata_description ?? undefined,
        centerGoal,
        cellGoal: row.cell_index != null ? cellGoals[row.cell_index] : undefined,
      });
      if (jobId) enqueued += 1;
      else skipped += 1;
    } catch (err) {
      skipped += 1;
      log.warn('enqueue failed (ulc row, non-fatal)', {
        rowId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const result: RelevanceBackfillResult = {
    enqueued,
    skipped,
    uvsRows: videoStates.length,
    ulcRows: localCards.length,
  };

  log.info('relevance backfill trigger fired', {
    userId: params.userId,
    mandalaId: params.mandalaId,
    applyCutoff: params.applyCutoff,
    ...result,
  });

  return result;
}
