/**
 * Mandala book-fill worker (§2-D #1).
 *
 * Durable lane for assembling a mandala's book_json from its placed videos' v2
 * rich summaries. The assembly is LLM-free (build-book.ts is pure string
 * concat); this worker just provides persistence + retries so a triggered fill
 * survives restarts and transient DB errors.
 *
 * Concurrency via richSummaryWorkOptions(N) — teamSize:N + teamRefill so the
 * configured concurrency is NOT inert (CP498 teamSize:1 serial trap).
 */

import PgBoss from 'pg-boss';
import { logger } from '@/utils/logger';
import { getPrismaClient } from '@/modules/database/client';
import { getJobQueue } from '../manager';
import { JOB_NAMES, MANDALA_BOOK_FILL_OPTIONS, type MandalaBookFillPayload } from '../types';
import { richSummaryWorkOptions } from './rich-summary-work-options';
import { sendNoteReadyEmail } from '@/modules/email/transactional';
import { noteReadyCtaUrl } from '@/modules/email/note-ready-cta';
import { isBookFillBarrierEnabled } from '@/config/book-gate';

const log = logger.child({ module: 'queue/mandala-book-fill' });

/**
 * Send the note-ready email AT MOST ONCE per mandala (2026-07-16 deadlock fix).
 *
 * The old gate fired only on `trigger === 'completion-barrier'` — a trigger that
 * (given the barrier deadlock) never actually occurred for real mandalas, so NO
 * beta user ever got a note-ready email. Now it fires on the first successful
 * note build regardless of which trigger built it, deduped by a claim row so an
 * update-fill never re-notifies. The claim table (`note_ready_email_sends`) also
 * serves as the send log — previously sends existed only in container logs
 * (lost on deploy), so delivery was unverifiable.
 *
 * Race-safe: the INSERT ... ON CONFLICT DO NOTHING RETURNING wins exactly once.
 */
async function notifyNoteReadyOnce(userId: string, mandalaId: string): Promise<void> {
  let claimed: Array<{ mandala_id: string }> = [];
  try {
    claimed = await getPrismaClient().$queryRawUnsafe<Array<{ mandala_id: string }>>(
      `INSERT INTO note_ready_email_sends (mandala_id)
       VALUES ($1::uuid)
       ON CONFLICT (mandala_id) DO NOTHING
       RETURNING mandala_id`,
      mandalaId
    );
  } catch (err) {
    // If the claim table is missing/unavailable, do NOT send (avoid unbounded
    // re-sends) — surface loudly so the DDL gap is caught.
    log.warn('note-ready claim failed — email skipped', {
      mandalaId,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  if (claimed.length === 0) return; // already sent for this mandala
  const to = await notifyNoteReady(userId, mandalaId);
  if (to) {
    await getPrismaClient()
      .$executeRawUnsafe(
        `UPDATE note_ready_email_sends SET to_email = $2 WHERE mandala_id = $1::uuid`,
        mandalaId,
        to
      )
      .catch(() => {
        /* best-effort log annotation */
      });
  }
}

/**
 * Build + send the note-ready email to the mandala owner. Returns the recipient
 * address (or '' when unsent). Non-fatal — email must never fail the fill.
 * Dedup/one-shot is the caller's job (notifyNoteReadyOnce).
 */
async function notifyNoteReady(userId: string, mandalaId: string): Promise<string> {
  try {
    const mandala = await getPrismaClient().user_mandalas.findFirst({
      where: { id: mandalaId, user_id: userId },
      select: { title: true, users: { select: { email: true } } },
    });
    const to = mandala?.users?.email ?? '';
    if (!to) return '';
    // Focus video from the SAME sources the learning page renders
    // (useMandalaCards = user_video_states ∪ user_local_cards, placed only).
    // uvs is the dominant table (auto-add/wizard cards) and is video-UUID
    // keyed — join youtube_videos for the 11-char id the /learning route uses.
    const synced = await getPrismaClient().userVideoState.findFirst({
      where: {
        user_id: userId,
        mandala_id: mandalaId,
        cell_index: { gte: 0 },
        is_in_ideation: false,
      },
      orderBy: [{ cell_index: 'asc' }, { sort_order: 'asc' }],
      select: { video: { select: { youtube_video_id: true } } },
    });
    let focusVideoId = synced?.video?.youtube_video_id ?? null;
    if (!focusVideoId) {
      const local = await getPrismaClient().user_local_cards.findFirst({
        where: {
          user_id: userId,
          mandala_id: mandalaId,
          cell_index: { gte: 0 },
          video_id: { not: null },
        },
        orderBy: [{ cell_index: 'asc' }, { sort_order: 'asc' }],
        select: { video_id: true },
      });
      focusVideoId = local?.video_id ?? null;
    }
    await sendNoteReadyEmail(to, {
      mandalaName: mandala?.title ?? '내 만다라',
      ctaUrl: noteReadyCtaUrl(mandalaId, focusVideoId),
    });
    return to;
  } catch (err) {
    log.warn('note-ready email skipped (non-fatal)', {
      mandalaId,
      error: err instanceof Error ? err.message : String(err),
    });
    return '';
  }
}

// Low volume (one job per manual trigger), but use the trap-proof option shape
// so raising this later actually parallelizes. Named constant — no magic number.
const BOOK_FILL_CONCURRENCY = 2;

export async function registerMandalaBookFillWorker(): Promise<void> {
  const boss = getJobQueue().getInstance();
  await boss.work<MandalaBookFillPayload>(
    JOB_NAMES.MANDALA_BOOK_FILL,
    richSummaryWorkOptions(BOOK_FILL_CONCURRENCY),
    handleMandalaBookFill
  );
  log.info('mandala-book-fill worker registered', { concurrency: BOOK_FILL_CONCURRENCY });
}

export async function handleMandalaBookFill(
  job: PgBoss.Job<MandalaBookFillPayload>
): Promise<void> {
  const { userId, mandalaId, trigger } = job.data ?? ({} as MandalaBookFillPayload);
  if (!userId || !mandalaId) {
    // Malformed payload — retrying cannot fix it; complete without throwing.
    log.warn('mandala-book-fill: missing userId/mandalaId, dropping', { jobId: job.id });
    return;
  }

  // Lazy import keeps the queue boot path free of the assembler import chain.
  const { fillMandalaBook } = await import('@/modules/mandala-book/fill-book');
  const result = await fillMandalaBook({ userId, mandalaId, trigger });

  if (!result.ok && result.action === 'failed') {
    // Throw → pg-boss retry (3× backoff). 'skipped-*' results are terminal (a
    // mandala with no videos is not an error), so only 'failed' retries.
    log.warn('mandala-book-fill: fill failed, will retry', { jobId: job.id, mandalaId });
    throw new Error(`mandala-book-fill failed for ${mandalaId}: ${result.reason ?? 'unknown'}`);
  }

  // Note-ready email — first successful note build for this mandala, regardless
  // of trigger (deadlock fix 2026-07-16: 'completion-barrier' never fired, so no
  // user was ever notified). Deduped one-shot; only 'filled' builds a note.
  //
  // Flag-combo guard (supervisor): the barrier is what guarantees the note is
  // COMPLETE (all videos settled) before the first build. With the barrier OFF,
  // fills are per-video legacy re-fills that can be 1-video stubs — emailing a
  // stub-note is worse than no email. So only notify when the barrier is on.
  if (result.ok && result.action === 'filled' && isBookFillBarrierEnabled()) {
    await notifyNoteReadyOnce(userId, mandalaId);
  }

  log.info('mandala-book-fill done', { jobId: job.id, ...result });
}

/** Enqueue a book-fill job for one mandala. Returns the pg-boss job id (or null). */
export async function enqueueMandalaBookFill(
  payload: MandalaBookFillPayload,
  options?: PgBoss.SendOptions
): Promise<string | null> {
  const boss = getJobQueue().getInstance();
  return boss.send(JOB_NAMES.MANDALA_BOOK_FILL, payload, {
    ...MANDALA_BOOK_FILL_OPTIONS,
    ...options,
  });
}
