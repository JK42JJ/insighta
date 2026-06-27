/**
 * markSkippedSummary — CP500+ PR-B.
 *
 * Persist a terminal `video_rich_summaries` row with `quality_flag='skipped'`
 * for genuine "cannot generate v2" cases (no transcript / no youtube metadata).
 *
 * Why: without a row, the FE rich-summary poll (GET /rich-notes is separate;
 * this is GET /videos/:id/rich-summary → useRichSummary) returns 404 → the
 * learning panel shows an eternal "generating…" spinner AND re-fires
 * enrichCardBackground on every remount (4 jobs in 3 min observed). A terminal
 * `skipped` row makes the panel render "summary unavailable: <reason>" and the
 * existing `quality_flag !== 'pass'` guard (PanelAISummary :88) suppresses the
 * auto-enrich re-trigger → churn stops.
 *
 * vrs is VIDEO-scoped (`video_id` PK = youtube id string) — independent of the
 * uvs/ulc card-identity split (that is the separate crosscutting audit). This
 * helper keys by videoId only.
 *
 * Safety: never clobbers a row that already passed; never throws (fire-and-
 * forget — the caller's primary control flow, e.g. NO_TRANSCRIPT throw, is
 * unaffected by a marker write failure).
 */

import { Prisma } from '@prisma/client';
import { getPrismaClient } from '@/modules/database/client';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'mark-skipped-summary' });

export async function markSkippedSummary(
  videoId: string,
  reason: string,
  userId?: string | null
): Promise<void> {
  const prisma = getPrismaClient();
  try {
    const existing = await prisma.video_rich_summaries.findUnique({
      where: { video_id: videoId },
      select: { quality_flag: true, template_version: true },
    });
    // CP504 — protect a real V2 pass only. A v1/pass row is an OLD summary that
    // could not upgrade to v2 (e.g. NO_TRANSCRIPT); leaving it 'pass' means
    // fill-book never sees the video as terminally skipped, so it re-enqueues it
    // every book build → the enrich job re-throws NO_TRANSCRIPT forever (measured:
    // one video failed 12×) and the FE spinner never ends. Overwrite v1/pass with
    // the terminal skipped marker so re-enqueue + the v2-pending count both stop.
    if (existing?.quality_flag === 'pass' && existing?.template_version === 'v2') return;
    const skipCore = { skip_reason: reason } as unknown as Prisma.InputJsonValue;
    await prisma.video_rich_summaries.upsert({
      where: { video_id: videoId },
      update: {
        quality_flag: 'skipped',
        core: skipCore,
        template_version: 'v2',
        ...(userId ? { user_id: userId } : {}),
        updated_at: new Date(),
      },
      create: {
        video_id: videoId,
        quality_flag: 'skipped',
        core: skipCore,
        template_version: 'v2',
        ...(userId ? { user_id: userId } : {}),
      },
    });
  } catch (err) {
    log.warn('markSkippedSummary upsert failed (non-fatal)', {
      videoId,
      reason,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
