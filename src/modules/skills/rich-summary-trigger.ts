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
import { enqueueMandalaBookFill } from '@/modules/queue/handlers/mandala-book-fill';
import { bookRefillEnqueueOptions } from '@/modules/queue/handlers/book-refill-debounce';
import { enqueueJudgeDeboost } from '@/modules/queue/handlers/judge-deboost';
import { isJudgeDeboostEnabled } from '@/config/judge-deboost';
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

  // Query both tables: user_local_cards (manual/note cards) and
  // user_video_states (pipeline auto-added cards). The pipeline writes
  // to user_video_states, so querying only user_local_cards would miss
  // all recommendation-based cards — the common case.
  const [localCards, videoStates] = await Promise.all([
    prisma.user_local_cards.findMany({
      where: {
        user_id: params.userId,
        mandala_id: params.mandalaId,
        video_id: { not: null },
      },
      select: { video_id: true, title: true, url: true },
    }),
    prisma.userVideoState.findMany({
      where: {
        user_id: params.userId,
        mandala_id: params.mandalaId,
      },
      select: {
        videoId: true,
        video: { select: { youtube_video_id: true, title: true } },
      },
    }),
  ]);

  if (localCards.length === 0 && videoStates.length === 0) {
    log.info('No video cards placed in mandala — rich summary trigger no-op', {
      userId: params.userId,
      mandalaId: params.mandalaId,
    });
    return { enqueued: 0, skipped: 0 };
  }

  // Dedupe by YouTube video ID. user_local_cards stores it directly;
  // user_video_states references youtube_videos via UUID join.
  const uniqueByVideo = new Map<string, { title: string | null; url: string }>();
  for (const c of localCards) {
    if (!c.video_id) continue;
    if (!uniqueByVideo.has(c.video_id)) {
      uniqueByVideo.set(c.video_id, { title: c.title, url: c.url });
    }
  }
  for (const v of videoStates) {
    const ytId = v.video?.youtube_video_id;
    if (!ytId) continue;
    if (!uniqueByVideo.has(ytId)) {
      uniqueByVideo.set(ytId, {
        title: v.video?.title ?? null,
        url: `https://www.youtube.com/watch?v=${ytId}`,
      });
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
        mandalaId: params.mandalaId,
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

  // Book-chain guarantee (2026-07-12): the per-v2 book enqueue (enrichment.ts)
  // only fires when a video takes the FULL inline v2 path — cache-hit videos
  // early-return before it, so an all-cached mandala would never get its note.
  // Enqueue ONE debounced book fill here unconditionally (singletonKey per
  // mandala; 120s startAfter lets the enrich burst land first). Non-fatal.
  if (uniqueByVideo.size > 0 && isJudgeDeboostEnabled()) {
    // gA judge deboost — one shot per mandala (singleton, 240s). Fail-open.
    await enqueueJudgeDeboost({ userId: params.userId, mandalaId: params.mandalaId }).catch(
      (err) => {
        log.warn('judge-deboost enqueue failed (non-fatal)', {
          mandalaId: params.mandalaId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    );
  }
  if (uniqueByVideo.size > 0) {
    await enqueueMandalaBookFill(
      { userId: params.userId, mandalaId: params.mandalaId, trigger: 'enrich-complete' },
      bookRefillEnqueueOptions(params.mandalaId)
    ).catch((err) => {
      log.warn('trigger-level book fill enqueue failed (non-fatal)', {
        mandalaId: params.mandalaId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  return { enqueued, skipped };
}
