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

/**
 * Settle-grace (2026-07-16, supervisor): within this window of the newest card
 * placement, a rowless video with NO enrich job is treated as still-pending
 * (its bulk enqueue may be in flight) rather than settled — so a fast/cached
 * sibling completing mid-enqueue cannot prematurely fire a partial book.
 */
const BARRIER_SETTLE_GRACE_MS = 120_000;

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
 * Latest completed book-fill for this mandala, REGARDLESS of trigger (pg-boss
 * history, retained ~14d). Used to (a) suppress a duplicate initial fill and
 * (b) window the "new v2 since last fill" count. Returns null when none yet.
 *
 * Deadlock fix (2026-07-16): the old query counted only 'completion-barrier'/
 * 'update-threshold' triggers, so it was BLIND to the note actually being built
 * by any other emitter (ontology/enrichment + rich-summary-trigger both emitted
 * 'enrich-complete'). That left the baseline null forever → the update path
 * never armed → the note froze as whatever the first ungated fill produced
 * (observed: a 1-video stub). "When was the note last built" must count EVERY
 * completed fill, not just the gate's own triggers.
 */
async function lastBookFillAt(mandalaId: string): Promise<Date | null> {
  const prisma = getPrismaClient();
  const rows = await prisma
    .$queryRawUnsafe<Array<{ completedon: Date | null }>>(
      `SELECT max(completedon) AS completedon
       FROM pgboss.job
      WHERE name = $1
        AND data->>'mandalaId' = $2
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
 * Per-video enrich-job state for the given youtube ids:
 *   present with true  → has a LIVE job (created/active/retry) → still enriching
 *   present with false → has ONLY terminal jobs (completed/failed/…) → settled,
 *                        a v2 row will never land
 *   ABSENT (no entry)  → no enrich job at all → not-yet-attempted (or a failed
 *                        enqueue) — the caller decides via the grace window.
 *
 * Deadlock fix (2026-07-16): the old gate treated "no v2 row" as "still
 * pending", assuming every video eventually gets a row (or a 'skipped' row). A
 * FAILED enrich writes no row, so `remaining` never reached 0 and the initial
 * barrier never fired (4 failed jobs → 12 rowless videos → permanent stall).
 * 'retry' counts as live so a job awaiting its retry does not settle early
 * (supervisor check b — only TERMINAL failures settle).
 */
async function enrichJobStates(videoIds: string[]): Promise<Map<string, boolean>> {
  if (videoIds.length === 0) return new Map();
  const prisma = getPrismaClient();
  const rows = await prisma
    .$queryRawUnsafe<Array<{ vid: string; is_live: boolean }>>(
      `SELECT data->>'videoId' AS vid,
              bool_or(state IN ('created', 'active', 'retry')) AS is_live
         FROM pgboss.job
        WHERE name = $1
          AND data->>'videoId' = ANY($2::text[])
        GROUP BY 1`,
      JOB_NAMES.ENRICH_RICH_SUMMARY,
      videoIds
    )
    .catch((err) => {
      // Fail-safe: on query error, mark all as live (never fire a premature/
      // partial book). A stalled gate is recoverable; a wrong note is not.
      log.warn('enrichJobStates query failed (treating all as pending)', { error: String(err) });
      return videoIds.map((v) => ({ vid: v, is_live: true }));
    });
  const m = new Map<string, boolean>();
  for (const r of rows) if (r.vid) m.set(r.vid, r.is_live === true);
  return m;
}

/**
 * Newest placed-card timestamp for the mandala, across both card tables. Used
 * for the settle-grace window: a rowless video with NO enrich job is only
 * treated as settled AFTER this grace, because right after placement the bulk
 * enrich enqueue can still be in flight (a fast/cached sibling completing mid-
 * loop must NOT prematurely settle a not-yet-enqueued video and fire a partial
 * book — supervisor check a). Returns null when the mandala has no cards.
 */
async function newestCardAt(userId: string, mandalaId: string): Promise<Date | null> {
  const prisma = getPrismaClient();
  const rows = await prisma
    .$queryRawUnsafe<Array<{ newest: Date | null }>>(
      `SELECT max(t) AS newest FROM (
         SELECT created_at AS t FROM public.user_video_states WHERE user_id = $1::uuid AND mandala_id = $2::uuid
         UNION ALL
         SELECT created_at AS t FROM public.user_local_cards  WHERE user_id = $1::uuid AND mandala_id = $2::uuid
       ) x`,
      userId,
      mandalaId
    )
    .catch(() => [{ newest: null }]);
  return rows[0]?.newest ?? null;
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
 * "remaining" = videos whose enrichment could STILL produce a v2 row (no row
 * yet AND a live enrich job). Videos that failed terminally or were never
 * attempted are settled — they never block the gate (supervisor condition 1:
 * the denominator is fixable-incomplete = still-enriching, not "rowless forever").
 *
 * Curation extension point (growth-hub track, 2026-07-16): when a `kind` column
 * lands on user_mandalas, exclude `kind='curation'` mandalas here — a curation
 * mandala carries v2 rows but must NEVER build a Sonnet note. There is no `kind`
 * column today, so no filter yet; this comment marks the single line to add so
 * the barrier revival does not start burning Sonnet on curation mandalas.
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
  const noRow = videoIds.filter((id) => !withRow.has(id));
  // A rowless video is "pending" (blocks the barrier) when it still has a live
  // enrich job, OR it has NO job yet AND we're still inside the settle-grace
  // window (its enqueue may be in flight — premature-fire race, supervisor
  // check a). A rowless video with only terminal jobs is settled. Past grace,
  // a no-job rowless video is also settled (a failed enqueue must not stall
  // forever). Grace is keyed on the newest card; a mandala whose cards are all
  // enriched (rowless=∅) skips it entirely, so the common path is not delayed.
  const jobStates = noRow.length > 0 ? await enrichJobStates(noRow) : new Map<string, boolean>();
  const newestCard = noRow.length > 0 ? await newestCardAt(userId, mandalaId) : null;
  const withinGrace =
    newestCard != null && Date.now() - newestCard.getTime() < BARRIER_SETTLE_GRACE_MS;
  const remaining = noRow.filter((id) => {
    const isLive = jobStates.get(id);
    if (isLive === true) return true; // still enriching
    if (isLive === false) return false; // terminal job, no row → settled
    return withinGrace; // no job record → pending only while enqueue may be in flight
  }).length;
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
