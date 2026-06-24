/**
 * Translate-mandala-bulk worker (v2 translations — PR-T1).
 *
 * Trigger: the card-add panel CLOSE (one bulk job per mandala) — NOT per-card.
 * Scans the mandala's placed videos whose v2 atom source_language differs from
 * the mandala language and have NO stored translation yet, then translates each
 * into the mandala language (Haiku via OpenRouter — the allowed SERVICE path).
 *
 * Cost levers (no Anthropic Batch API: OpenRouter has no -50% batch + Anthropic-
 * direct is a Hard-Rule violation):
 *   1. Dedup — skip videos whose translations[lang] already exists. The
 *      translations jsonb is GLOBAL (video_rich_summaries.video_id PK), so a
 *      translation made for any user is reused by all (same principle as #961).
 *   2. One job per mandala (not per atom) — debounced singletonKey collects a
 *      card-add burst into a single bulk pass.
 *
 * On completion, enqueues a book re-fill so the note/book-index re-renders with
 * the translated atoms (same #958-style lazy re-reflection as v2 generation).
 */

import PgBoss from 'pg-boss';
import { logger } from '@/utils/logger';
import { getPrismaClient } from '@/modules/database/client';
import { getMandalaManager } from '@/modules/mandala/manager';
import { getJobQueue } from '../manager';
import {
  JOB_NAMES,
  TRANSLATE_MANDALA_BULK_OPTIONS,
  type TranslateMandalaBulkPayload,
} from '../types';
import { richSummaryWorkOptions } from './rich-summary-work-options';
import { enqueueMandalaBookFill } from './mandala-book-fill';
import { bookRefillEnqueueOptions } from './book-refill-debounce';

const log = logger.child({ module: 'queue/translate-mandala-bulk' });

// Low volume (one job per panel-close); trap-proof option shape so raising this
// later actually parallelizes (CP498 teamSize:1 serial trap). Named constant.
const TRANSLATE_BULK_CONCURRENCY = 2;

export async function registerTranslateMandalaBulkWorker(): Promise<void> {
  const boss = getJobQueue().getInstance();
  await boss.work<TranslateMandalaBulkPayload>(
    JOB_NAMES.TRANSLATE_MANDALA_BULK,
    richSummaryWorkOptions(TRANSLATE_BULK_CONCURRENCY),
    handleTranslateMandalaBulk
  );
  log.info('translate-mandala-bulk worker registered', {
    concurrency: TRANSLATE_BULK_CONCURRENCY,
  });
}

export async function handleTranslateMandalaBulk(
  job: PgBoss.Job<TranslateMandalaBulkPayload>
): Promise<void> {
  const { userId, mandalaId } = job.data ?? ({} as TranslateMandalaBulkPayload);
  if (!userId || !mandalaId) {
    log.warn('translate-mandala-bulk: missing userId/mandalaId, dropping', { jobId: job.id });
    return;
  }

  const prisma = getPrismaClient();

  // Mandala language = display language. Only ko/en supported.
  const mandala = await getMandalaManager().getMandalaById(userId, mandalaId);
  const targetLang: 'ko' | 'en' | null = mandala ? (mandala.language === 'en' ? 'en' : 'ko') : null;
  if (!targetLang) {
    log.warn('translate-mandala-bulk: mandala not found, dropping', { jobId: job.id, mandalaId });
    return;
  }

  // Placed video ids across both user-scoped tables (cell_index >= 0).
  const [videoStates, localCards] = await Promise.all([
    prisma.userVideoState.findMany({
      where: { user_id: userId, mandala_id: mandalaId, cell_index: { gte: 0 } },
      select: { video: { select: { youtube_video_id: true } } },
    }),
    prisma.user_local_cards.findMany({
      where: { user_id: userId, mandala_id: mandalaId, cell_index: { gte: 0 } },
      select: { video_id: true },
    }),
  ]);
  const videoIds = Array.from(
    new Set(
      [
        ...videoStates.map((r) => r.video?.youtube_video_id),
        ...localCards.map((r) => r.video_id),
      ].filter((v): v is string => Boolean(v))
    )
  );
  if (videoIds.length === 0) {
    log.info('translate-mandala-bulk: no placed videos', { jobId: job.id, mandalaId });
    return;
  }

  // Candidates = complete v2 whose source language differs from the mandala
  // language. The actual dedup (translations[lang] exists) + failure-cap is
  // applied per-row below via the translator's own guards.
  const rows = await prisma.video_rich_summaries.findMany({
    where: {
      video_id: { in: videoIds },
      template_version: 'v2',
      source_language: { not: targetLang },
    },
    select: {
      video_id: true,
      one_liner: true,
      core: true,
      analysis: true,
      segments: true,
      translations: true,
      source_language: true,
    },
  });

  // Lazy import keeps the queue boot path free of the translator import chain.
  const { getStoredTranslation, translateAndStore } =
    await import('@/modules/skills/rich-summary-translator');

  let translated = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of rows) {
    // No usable atoms (segments null) → nothing to translate.
    if (row.segments == null) {
      skipped += 1;
      continue;
    }
    // Dedup — global translation already present ⇒ reuse, no LLM call.
    if (getStoredTranslation(row.translations, targetLang)) {
      skipped += 1;
      continue;
    }
    const out = await translateAndStore({
      videoId: row.video_id,
      targetLang,
      payload: {
        one_liner: row.one_liner ?? null,
        core: row.core ?? null,
        analysis: row.analysis ?? null,
        segments: row.segments ?? null,
      },
      translations: row.translations,
    });
    if (out) translated += 1;
    else failed += 1;
  }

  log.info('translate-mandala-bulk done', {
    jobId: job.id,
    mandalaId,
    targetLang,
    candidates: rows.length,
    translated,
    skipped,
    failed,
  });

  // Re-reflect — when any translation was stored, re-fill the book so the note /
  // book-index renders the translated atoms (PR-T2 reads translations[lang]).
  if (translated > 0) {
    await enqueueMandalaBookFill(
      { userId, mandalaId, trigger: 'translate-bulk-complete' },
      bookRefillEnqueueOptions(mandalaId)
    ).catch((err) => {
      log.warn('translate-mandala-bulk: book re-fill enqueue failed (non-fatal)', {
        mandalaId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
}

/** Enqueue a bulk-translate job for one mandala. Returns the pg-boss job id (or null). */
export async function enqueueTranslateMandalaBulk(
  payload: TranslateMandalaBulkPayload,
  options?: PgBoss.SendOptions
): Promise<string | null> {
  const boss = getJobQueue().getInstance();
  return boss.send(JOB_NAMES.TRANSLATE_MANDALA_BULK, payload, {
    ...TRANSLATE_MANDALA_BULK_OPTIONS,
    ...options,
  });
}
