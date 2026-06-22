/**
 * Deck-build worker (③ e2e — the last chain piece).
 *
 * Owns the deterministic deck chain in one durable job: ensure book_json (① —
 * fillMandalaBook is idempotent) → collect cached figures (#938; [] = text deck,
 * fail-closed) → call slidegen /slides/build (job poll, returns .pptx bytes) →
 * upload to Supabase Storage → store the public pptx_url in slide_decks. status:
 * pending → building → done | failed (the FE button + deck-stream SSE read
 * slide_decks.status).
 *
 * A failed/empty build (or upload failure) marks the deck failed (no fake deck).
 */

import PgBoss from 'pg-boss';
import { logger } from '@/utils/logger';
import { getJobQueue } from '../manager';
import { JOB_NAMES, DECK_BUILD_OPTIONS, type DeckBuildPayload } from '../types';
import { richSummaryWorkOptions } from './rich-summary-work-options';

const log = logger.child({ module: 'queue/deck-build' });

// One build per manual trigger; trap-proof option shape so raising later parallelizes.
const DECK_BUILD_CONCURRENCY = 2;

export async function registerDeckBuildWorker(): Promise<void> {
  const boss = getJobQueue().getInstance();
  await boss.work<DeckBuildPayload>(
    JOB_NAMES.DECK_BUILD,
    richSummaryWorkOptions(DECK_BUILD_CONCURRENCY),
    handleDeckBuild
  );
  log.info('deck-build worker registered', { concurrency: DECK_BUILD_CONCURRENCY });
}

export async function handleDeckBuild(job: PgBoss.Job<DeckBuildPayload>): Promise<void> {
  const { userId, mandalaId } = job.data ?? ({} as DeckBuildPayload);
  if (!userId || !mandalaId) {
    log.warn('deck-build: missing userId/mandalaId, dropping', { jobId: job.id });
    return;
  }

  // Lazy imports keep the queue boot path free of the build chain.
  const { fillMandalaBook } = await import('@/modules/mandala-book/fill-book');
  const { collectFiguresForMandala } = await import('@/modules/snapshot/collect-figures');
  const { buildDeck } = await import('@/modules/deck/slides-build-client');
  const { uploadDeckPptx } = await import('@/modules/deck/deck-storage');
  const { markDeckBuilding, markDeckDone, markDeckFailed } =
    await import('@/modules/deck/deck-status');
  const { getPrismaClient } = await import('@/modules/database/client');

  try {
    // 1. ensure book_json (idempotent — re-assembles from current v2 summaries).
    const fill = await fillMandalaBook({ userId, mandalaId, trigger: 'deck-build' });
    const bookRow = await getPrismaClient().mandala_books.findUnique({
      where: { mandala_id: mandalaId },
      select: { book_json: true },
    });
    if (!bookRow?.book_json) {
      // No book (e.g. mandala has no usable v2 videos) — honest fail, no deck.
      await markDeckFailed(mandalaId, `no book_json (fill: ${fill.action ?? 'unknown'})`);
      log.warn('deck-build: no book_json, marked failed', { jobId: job.id, mandalaId });
      return;
    }

    // 2. building — collect cached figures ([] = text deck, fail-closed).
    await markDeckBuilding(mandalaId);
    const figures = await collectFiguresForMandala(mandalaId);

    // 3. slidegen /slides/build (job poll) → .pptx bytes.
    const pptxBytes = await buildDeck(bookRow.book_json, figures);
    if (!pptxBytes) {
      await markDeckFailed(mandalaId, 'slidegen /slides/build returned no deck');
      log.warn('deck-build: build returned null, marked failed', { jobId: job.id, mandalaId });
      // Throw → pg-boss retry (1×): a transient slidegen blip gets one more shot.
      throw new Error(`deck-build failed for ${mandalaId}: slides/build null`);
    }

    // 4. upload to Supabase Storage → public URL → done.
    const pptxUrl = await uploadDeckPptx(mandalaId, pptxBytes);
    await markDeckDone(mandalaId, pptxUrl);
    log.info('deck-build done', {
      jobId: job.id,
      mandalaId,
      figures: figures.length,
      bytes: pptxBytes.length,
    });
  } catch (err) {
    // markDeckFailed already ran for the known-null case; ensure failed state on
    // any unexpected throw too, then rethrow for the retry/backoff.
    const msg = err instanceof Error ? err.message : String(err);
    await markDeckFailed(mandalaId, msg).catch(() => {
      /* best-effort — don't mask the original error */
    });
    throw err;
  }
}

/** Enqueue a deck-build job for one mandala. Returns the pg-boss job id (or null). */
export async function enqueueDeckBuild(
  payload: DeckBuildPayload,
  options?: PgBoss.SendOptions
): Promise<string | null> {
  const boss = getJobQueue().getInstance();
  return boss.send(JOB_NAMES.DECK_BUILD, payload, { ...DECK_BUILD_OPTIONS, ...options });
}
