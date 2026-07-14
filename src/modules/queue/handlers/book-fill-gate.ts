/**
 * Completion-gated book-fill trigger (CP516 — book-fill cost fix).
 *
 * Root cause it replaces: the enrich-rich-summary handler fired a book re-fill
 * per video v2 completion. A mandala's videos enrich in waves over minutes, so
 * the 120s singletonKey debounce only collapsed WITHIN a wave — across the full
 * enrichment a mandala re-filled its book 3-4×, each run re-calling the book's
 * Sonnet stages (topic-synthesis + chapter body). That 3-4× multiplier is the
 * dominant Sonnet cost (measured 2026-07-09: book-body Sonnet was the largest,
 * untagged, spend).
 *
 * James's policy (this module): the note is built ONCE when every video's v2 is
 * done, then updated only when ≥5 new summaries accumulate.
 *
 * Flag BOOK_FILL_BARRIER_ENABLED gates it: unset/false ⇒ EXACT legacy behavior
 * (one debounced re-fill per enrich completion) so rollback needs no code revert.
 */

import { getPrismaClient } from '../../database/client';
import { logger } from '../../../utils/logger';
import { isBookFillBarrierEnabled } from '@/config/book-gate';
import { JOB_NAMES } from '../types';
import { enqueueMandalaBookFill } from './mandala-book-fill';
import { bookRefillEnqueueOptions } from './book-refill-debounce';

const log = logger.child({ module: 'queue/book-fill-gate' });

/** James 2026-07-10: re-fill the note only once ≥5 new video summaries accumulate. */
const UPDATE_THRESHOLD_NEW_V2 = 5;

interface BookFillGateParams {
  userId: string;
  mandalaId: string;
}

/**
 * Distinct YouTube video ids placed in a mandala — both the pipeline table
 * (user_video_states) and manual/note cards (user_local_cards). Mirrors
 * enqueueRichSummaryForMandalaCards so the gate's denominator matches what
 * actually gets enriched.
 */
async function mandalaVideoIds(userId: string, mandalaId: string): Promise<string[]> {
  const prisma = getPrismaClient();
  const [localCards, videoStates] = await Promise.all([
    prisma.user_local_cards.findMany({
      where: { user_id: userId, mandala_id: mandalaId, video_id: { not: null } },
      select: { video_id: true },
    }),
    prisma.userVideoState.findMany({
      where: { user_id: userId, mandala_id: mandalaId },
      select: { video: { select: { youtube_video_id: true } } },
    }),
  ]);
  const ids = new Set<string>();
  for (const c of localCards) if (c.video_id) ids.add(c.video_id);
  for (const v of videoStates) {
    const yt = v.video?.youtube_video_id;
    if (yt) ids.add(yt);
  }
  return [...ids];
}

/**
 * Latest completed barrier/update book-fill for this mandala (pg-boss history,
 * retained ~14d). Used to (a) suppress a duplicate initial fill and (b) window
 * the "new v2 since last fill" count. Returns null when none yet.
 */
async function lastBookFillAt(mandalaId: string): Promise<Date | null> {
  const prisma = getPrismaClient();
  const rows = await prisma
    .$queryRawUnsafe<Array<{ completedon: Date | null }>>(
      `SELECT max(completedon) AS completedon
       FROM pgboss.job
      WHERE name = $1
        AND data->>'mandalaId' = $2
        AND (data->>'trigger') IN ('completion-barrier', 'update-threshold')
        AND state = 'completed'`,
      JOB_NAMES.MANDALA_BOOK_FILL,
      mandalaId
    )
    .catch((err) => {
      log.warn('lastBookFillAt query failed (treating as none)', { mandalaId, error: String(err) });
      return [{ completedon: null }];
    });
  return rows[0]?.completedon ?? null;
}

/**
 * Decide whether to enqueue a mandala book-fill after a video's v2 settled.
 *
 * Flag OFF → legacy debounced re-fill (unchanged).
 * Flag ON:
 *  - initial: once no mandala video is missing a v2 row (remaining=0) AND no
 *    completion-barrier/update fill has run yet → enqueue once ('completion-barrier').
 *  - update: when ≥UPDATE_THRESHOLD_NEW_V2 non-skipped v2 rows landed since the
 *    last fill → enqueue ('update-threshold').
 *
 * "remaining" counts videos with NO v2 row. Skipped rows are terminal (they do
 * not self-retry), so a genuinely-unfixable/no-caption video still resolves to a
 * row and never stalls the gate (supervisor condition 1 — the denominator is
 * fixable-incomplete, i.e. not-yet-attempted, not "unfixable forever").
 */
export async function maybeTriggerBookFill(params: BookFillGateParams): Promise<void> {
  const { userId, mandalaId } = params;

  if (!isBookFillBarrierEnabled()) {
    // Legacy path — one debounced re-fill per enrich completion.
    await enqueueMandalaBookFill(
      { userId, mandalaId, trigger: 'enrich-complete' },
      bookRefillEnqueueOptions(mandalaId)
    ).catch((err) => {
      log.warn('legacy book re-fill enqueue failed (non-fatal)', { mandalaId, error: String(err) });
    });
    return;
  }

  const videoIds = await mandalaVideoIds(userId, mandalaId);
  if (videoIds.length === 0) return;

  const v2Rows = await getPrismaClient().video_rich_summaries.findMany({
    where: { video_id: { in: videoIds }, template_version: 'v2' },
    select: { video_id: true, quality_flag: true, updated_at: true },
  });
  const withRow = new Set(v2Rows.map((r) => r.video_id));
  const remaining = videoIds.filter((id) => !withRow.has(id)).length;
  const lastFillAt = await lastBookFillAt(mandalaId);

  // Initial fill — every video attempted, book never built by the gate yet.
  if (remaining === 0 && !lastFillAt) {
    await enqueueMandalaBookFill(
      { userId, mandalaId, trigger: 'completion-barrier' },
      { singletonKey: `book-fill-barrier-${mandalaId}` }
    ).catch((err) => {
      log.warn('barrier book-fill enqueue failed (non-fatal)', { mandalaId, error: String(err) });
    });
    log.info('book-fill barrier fired (initial)', { mandalaId, videos: videoIds.length });
    return;
  }

  // Update fill — ≥N new non-skipped summaries since the last fill.
  if (lastFillAt) {
    const newV2 = v2Rows.filter(
      (r) => r.quality_flag !== 'skipped' && r.updated_at != null && r.updated_at > lastFillAt
    ).length;
    if (newV2 >= UPDATE_THRESHOLD_NEW_V2) {
      await enqueueMandalaBookFill(
        { userId, mandalaId, trigger: 'update-threshold' },
        { singletonKey: `book-fill-update-${mandalaId}` }
      ).catch((err) => {
        log.warn('update book-fill enqueue failed (non-fatal)', { mandalaId, error: String(err) });
      });
      log.info('book-fill barrier fired (update)', { mandalaId, newV2 });
    }
  }
}

export const __test = { UPDATE_THRESHOLD_NEW_V2 };
