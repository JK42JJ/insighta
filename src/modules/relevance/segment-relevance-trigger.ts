/**
 * Segment-relevance fill trigger (§2-D #2).
 *
 * Fans out one SEGMENT_RELEVANCE_FILL job per rich-summary time-segment of each
 * placed video in a mandala. Mirrors relevance-backfill-trigger (enumerate
 * placed videos across uvs+ulc, fetch the mandala centerGoal + cell sub-goals),
 * but the unit of work is a SEGMENT (video_id, mandala_id, segment_idx), not a
 * card row.
 *
 * Stale handling (§2-B decision 3): before fan-out, DELETE all existing rows for
 * the videos being re-scored, scoped to THIS mandala only. A rich-summary
 * regeneration reorders/shrinks segments[].sections — deleting then re-inserting
 * the current segments absorbs that drift (orphan segment_idx cannot survive).
 * The DELETE never touches other mandalas (mandala_id filter).
 */

import { getPrismaClient } from '@/modules/database/client';
import { getMandalaManager } from '@/modules/mandala/manager';
import { logger } from '@/utils/logger';
import { enqueueSegmentRelevanceFill } from '@/modules/queue/handlers/segment-relevance-fill';
import type { RichSummarySegments } from '@/modules/skills/rich-summary-v2-prompt';

const log = logger.child({ module: 'SegmentRelevanceTrigger' });

export interface SegmentRelevanceResult {
  enqueued: number;
  skipped: number;
  videos: number;
  segments: number;
  staleDeleted: number;
}

interface Placement {
  cellIndex: number;
  videoId: string; // 11-char YouTube id
}

/**
 * Enqueue segment-relevance jobs for every placed video's v2 time-segments in
 * the target mandala. Re-runnable: stale rows for the affected videos are
 * cleared first (regeneration drift), then current segments are fanned out.
 */
export async function enqueueSegmentRelevanceForMandala(params: {
  userId: string;
  mandalaId: string;
}): Promise<SegmentRelevanceResult> {
  const { userId, mandalaId } = params;
  const prisma = getPrismaClient();

  let centerGoal = '';
  let cellGoals: string[] = [];
  try {
    const mandala = await getMandalaManager().getMandalaById(userId, mandalaId);
    centerGoal = mandala?.levels[0]?.centerGoal ?? '';
    cellGoals = mandala?.levels[0]?.subjects ?? [];
  } catch (err) {
    log.warn('mandala lookup failed (continuing with empty centerGoal)', {
      userId,
      mandalaId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 1. Enumerate placed videos (uvs + ulc, cell_index >= 0).
  const [videoStates, localCards] = await Promise.all([
    prisma.userVideoState.findMany({
      where: { user_id: userId, mandala_id: mandalaId, cell_index: { gte: 0 } },
      select: { cell_index: true, video: { select: { youtube_video_id: true } } },
    }),
    prisma.user_local_cards.findMany({
      where: { user_id: userId, mandala_id: mandalaId, cell_index: { gte: 0 } },
      select: { cell_index: true, video_id: true },
    }),
  ]);

  const byVideo = new Map<string, Placement>(); // dedup: one cell per video for scoring
  for (const r of videoStates) {
    const vid = r.video?.youtube_video_id;
    if (!vid || r.cell_index == null) continue;
    if (!byVideo.has(vid)) byVideo.set(vid, { cellIndex: r.cell_index, videoId: vid });
  }
  for (const r of localCards) {
    if (!r.video_id || r.cell_index == null) continue;
    if (!byVideo.has(r.video_id))
      byVideo.set(r.video_id, { cellIndex: r.cell_index, videoId: r.video_id });
  }

  if (byVideo.size === 0) {
    return { enqueued: 0, skipped: 0, videos: 0, segments: 0, staleDeleted: 0 };
  }

  // 2. Fetch v2 segments for those videos.
  const videoIds = Array.from(byVideo.keys());
  const v2Rows = await prisma.video_rich_summaries.findMany({
    where: { video_id: { in: videoIds }, template_version: 'v2' },
    select: { video_id: true, segments: true },
  });

  // 3. Stale cleanup: remove existing rows for these videos in THIS mandala only.
  const staleDeleted = await prisma.$executeRawUnsafe(
    `DELETE FROM video_mandala_segment_relevance WHERE mandala_id = $1::uuid AND video_id = ANY($2::text[])`,
    mandalaId,
    videoIds
  );

  // 4. Fan out one job per current segment.
  let enqueued = 0;
  let skipped = 0;
  let segments = 0;
  let videos = 0;

  for (const row of v2Rows) {
    const placement = byVideo.get(row.video_id);
    if (!placement) continue;
    const segs = (row.segments ?? null) as unknown as RichSummarySegments | null;
    const sections = segs?.sections ?? [];
    if (sections.length === 0) continue;
    videos += 1;

    const cellGoal = cellGoals[placement.cellIndex];
    for (let idx = 0; idx < sections.length; idx++) {
      const s = sections[idx]!;
      segments += 1;
      try {
        const jobId = await enqueueSegmentRelevanceFill({
          videoId: row.video_id,
          mandalaId,
          segmentIdx: idx,
          fromSec: s.from_sec,
          toSec: s.to_sec,
          title: s.title,
          summary: s.summary,
          centerGoal,
          cellGoal,
        });
        if (jobId) enqueued += 1;
        else skipped += 1;
      } catch (err) {
        skipped += 1;
        log.warn('enqueue failed (segment, non-fatal)', {
          videoId: row.video_id,
          segmentIdx: idx,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  log.info('segment relevance fan-out', {
    mandalaId,
    videos,
    segments,
    enqueued,
    skipped,
    staleDeleted,
  });
  return { enqueued, skipped, videos, segments, staleDeleted: Number(staleDeleted) };
}
