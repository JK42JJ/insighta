/**
 * Rich Summary trigger helpers (CP423).
 *
 * Per-user decision: rich summary generation fires only for videos that are
 * (1) placed into a mandala cell during wizard completion, or
 * (2) explicitly added by the user via the card ADD action.
 *
 * System paths (batch collector, scheduled enrichment) must NOT invoke rich
 * summary generation. This module is the narrow surface callers use to
 * respect that boundary.
 */

import { getPrismaClient } from '@/modules/database/client';
import { enqueueEnrichVideo } from '@/modules/queue/handlers/enrich-video';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'RichSummaryTrigger' });

/**
 * Trigger 1 — mandala creation bulk enqueue.
 * Reads all cards placed into the given mandala (video_id NOT NULL, deduped)
 * and enqueues an enrich-video job per video with withRichSummary=true and
 * the owner's userId for quota accounting.
 *
 * Idempotent: duplicate enqueues are cheap (pg-boss de-dupe via payload hash
 * is not enforced here, but enrichRichSummary itself cache-hits on existing
 * passing rows, so repeated triggers do not re-generate).
 */
export async function enqueueRichSummaryForMandalaCards(params: {
  userId: string;
  mandalaId: string;
}): Promise<{ enqueued: number; skipped: number }> {
  const prisma = getPrismaClient();

  const cards = await prisma.user_local_cards.findMany({
    where: {
      user_id: params.userId,
      mandala_id: params.mandalaId,
      video_id: { not: null },
    },
    select: { video_id: true, title: true, url: true },
  });

  if (cards.length === 0) {
    log.info('No video cards placed in mandala — rich summary trigger no-op', {
      userId: params.userId,
      mandalaId: params.mandalaId,
    });
    return { enqueued: 0, skipped: 0 };
  }

  // Dedupe by video_id (same video can appear in multiple cells).
  const uniqueByVideo = new Map<string, { title: string | null; url: string }>();
  for (const c of cards) {
    if (!c.video_id) continue;
    if (!uniqueByVideo.has(c.video_id)) {
      uniqueByVideo.set(c.video_id, { title: c.title, url: c.url });
    }
  }

  let enqueued = 0;
  let skipped = 0;
  for (const [videoId, meta] of uniqueByVideo) {
    try {
      await enqueueEnrichVideo({
        videoId,
        title: meta.title ?? videoId,
        url: meta.url,
        source: 'user',
        withRichSummary: true,
        userId: params.userId,
      });
      enqueued += 1;
    } catch (err) {
      skipped += 1;
      log.warn('enqueue failed (non-fatal, skipping video)', {
        userId: params.userId,
        mandalaId: params.mandalaId,
        videoId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  log.info('Rich summary trigger fired for mandala', {
    userId: params.userId,
    mandalaId: params.mandalaId,
    uniqueVideos: uniqueByVideo.size,
    enqueued,
    skipped,
  });

  return { enqueued, skipped };
}
