/**
 * Enrich Relevance Quick — CP498 PR3b (A-stage).
 *
 * One quick-Haiku relevance score (0-100) per user-scoped card ROW, persisted
 * to that row (UserVideoState.relevance_pct or user_local_cards.relevance_pct).
 *
 * Design invariant (the thing NOT to get wrong): relevance is a RELATION
 * (video × this user's centerGoal), not a property of the video. So the unit
 * of work is the row PK, NEVER the video id — the same video in two rows gets
 * two scores. This worker updates `where: { id: rowId }`; it must never key by
 * video_id. compute-card-relevance.ts is import-pure (no Prisma, no
 * youtube_videos read), so this persist step is the only leak surface.
 *
 * Concurrency: reuses richSummaryWorkOptions(N) (PR2 #865) — teamSize:N +
 * teamRefill so pg-boss actually parallelises (teamSize:1 alone is inert).
 */

import type PgBoss from 'pg-boss';

import { computeCardRelevance } from '@/modules/relevance/compute-card-relevance';
import { getPrismaClient } from '@/modules/database/client';
import { loadRelevanceRubricConfig } from '@/config/relevance-rubric';
import { resolveLanguage } from '@/utils/detect-language';
import { logger } from '@/utils/logger';
import { getJobQueue } from '../manager';
import { JOB_NAMES, RELEVANCE_QUICK_RETRY_OPTIONS, type RelevanceQuickPayload } from '../types';
import { config } from '@/config/index';
import { richSummaryWorkOptions } from './rich-summary-work-options';

/**
 * Register the enrich-relevance-quick worker with pg-boss. Must be called
 * after JobQueue.start().
 */
export async function registerEnrichRelevanceQuickWorker(): Promise<void> {
  const boss = getJobQueue().getInstance();

  // N via env (RELEVANCE_BACKFILL_CONCURRENCY, default 4). Rollback = set to 1.
  const concurrency = config.queue.relevanceBackfillConcurrency;
  await boss.work<RelevanceQuickPayload>(
    JOB_NAMES.ENRICH_RELEVANCE_QUICK,
    richSummaryWorkOptions(concurrency),
    handleEnrichRelevanceQuick
  );

  logger.info('enrich-relevance-quick worker registered', { concurrency });
}

/**
 * Score one card row. no_title ⇒ legitimate skip (null-metadata card) — log
 * and return, do not throw. Other compute failures (provider/validation) throw
 * so pg-boss retries once per RELEVANCE_QUICK_RETRY_OPTIONS.
 */
async function handleEnrichRelevanceQuick(job: PgBoss.Job<RelevanceQuickPayload>): Promise<void> {
  const { table, rowId, title, description, centerGoal, cellGoal } = job.data;

  // CP499+ score pipeline (RELEVANCE_RUBRIC_ENABLED): fetch the row's mandala
  // language and run the PURE 3-axis rubric (CP500+ 축 분리: no freshness term
  // — the volatile-only recency quota is a placement-layer follow-up).
  // Fail-open: a context-fetch failure falls back to the legacy single-axis
  // call. Flag off ⇒ legacy call with NO new selects.
  const rubricEnabled = loadRelevanceRubricConfig().enabled;
  const context = rubricEnabled ? await fetchRelevanceContext(table, rowId, centerGoal) : null;

  const result = await computeCardRelevance({
    title,
    description,
    centerGoal,
    cellGoal,
    ...(context
      ? {
          rubric: true,
          language: context.language,
        }
      : {}),
  });

  if (!result.ok) {
    if (result.reason === 'no_title') {
      logger.info('enrich-relevance-quick: skipped (no_title)', {
        jobId: job.id,
        table,
        rowId,
      });
      return;
    }
    logger.warn('enrich-relevance-quick: compute failed', {
      jobId: job.id,
      table,
      rowId,
      reason: result.reason,
    });
    throw new Error(`relevance_compute_failed: ${result.reason}`);
  }

  const prisma = getPrismaClient();

  // CP500+ R1 bundle — batch gate prune (BATCH_GATE_PRUNE, default OFF).
  // James rule: "the system may delete ONLY what it inserted" — DELETE is
  // guarded by auto_added=true + the user-trace columns, so a MANUALLY added
  // card is preserved regardless of its score (UX 원칙 3), and a traced auto
  // card likewise. uvs only (user_local_cards are user-authored — never).
  // Loop guard: pool-serve refills carry a copied relevance_pct, and the
  // backfill trigger only enqueues relevance_pct IS NULL rows — a pruned
  // cell's refill is never re-scored/re-pruned by this path.
  const rubricCfg = loadRelevanceRubricConfig();
  if (
    table === 'uvs' &&
    rubricCfg.prune &&
    context &&
    result.detail &&
    result.detail.goalContributionPct < rubricCfg.pruneGcMin
  ) {
    const del = await prisma.$queryRaw<{ user_id: string; mandala_id: string | null }[]>`
      DELETE FROM user_video_states
      WHERE id = ${rowId}::uuid AND auto_added = true
        AND pinned_at IS NULL AND user_note IS NULL AND is_watched = false
        AND COALESCE(watch_position_seconds, 0) = 0 AND is_in_ideation = false
      RETURNING user_id::text, mandala_id::text`;
    if (del[0]) {
      logger.info('enrich-relevance-quick: batch-gate pruned (gc below gate)', {
        jobId: job.id,
        rowId,
        gc: result.detail.goalContributionPct,
        gcMin: rubricCfg.pruneGcMin,
      });
      const { user_id, mandala_id } = del[0];
      if (mandala_id) {
        // Fire-and-forget refill — the W1b fill-pending/completed-grace
        // signals cover the "정리되는 중" UX.
        setImmediate(() => {
          void import('./pool-serve-fill')
            .then(({ dispatchPoolServeForMandala }) =>
              dispatchPoolServeForMandala(user_id, mandala_id)
            )
            .catch((err) =>
              logger.warn('batch-gate refill dispatch failed (non-fatal)', {
                mandala_id,
                error: err instanceof Error ? err.message : String(err),
              })
            );
        });
      }
      return; // row deleted — nothing to persist
    }
    // Not eligible (manual card or user-traced) → keep the row AND its score.
  }

  const data = { relevance_pct: result.relevancePct, relevance_at: new Date() };

  // Persist keyed by ROW PK — never by video_id (relation-not-attribute
  // invariant). Each row carries its own centerGoal-scoped score.
  if (table === 'uvs') {
    await prisma.userVideoState.update({ where: { id: rowId }, data });
  } else {
    await prisma.user_local_cards.update({ where: { id: rowId }, data });
  }

  logger.info('enrich-relevance-quick: scored', {
    jobId: job.id,
    table,
    rowId,
    relevancePct: result.relevancePct,
    // relevance_detail = LOG-ONLY for now (James decision 2026-06-11: no
    // speculative column; persist axes only if gate measurement justifies it).
    ...(result.detail ? { detail: result.detail } : {}),
  });
}

export interface RelevanceContext {
  language: 'ko' | 'en';
}

/**
 * CP499+ — per-row scoring context: mandala language (#902 정합). CP500+ 축
 * 분리 removed volatility/published_at from here (freshness is not a score
 * axis; the placement-layer recency quota reads user_mandalas.volatility in
 * its own follow-up). Returns null on any failure so the caller falls back
 * to legacy single-axis scoring (fail-open).
 */
export async function fetchRelevanceContext(
  table: 'uvs' | 'ulc',
  rowId: string,
  goalText?: string
): Promise<RelevanceContext | null> {
  const prisma = getPrismaClient();
  // Read-only single-row lookup, tagged template.
  try {
    const rows =
      table === 'uvs'
        ? await prisma.$queryRaw<{ language: string | null }[]>`
            SELECT m.language
            FROM user_video_states uvs
            LEFT JOIN user_mandalas m ON m.id = uvs.mandala_id
            WHERE uvs.id = ${rowId}::uuid`
        : await prisma.$queryRaw<{ language: string | null }[]>`
            SELECT m.language
            FROM user_local_cards ulc
            LEFT JOIN user_mandalas m ON m.id = ulc.mandala_id
            WHERE ulc.id = ${rowId}::uuid`;
    const row = rows[0];
    if (!row) return null;
    return {
      language: resolveLanguage(row.language, goalText ?? null),
    };
  } catch (err) {
    logger.warn('enrich-relevance-quick: context fetch failed — legacy fallback', {
      table,
      rowId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Enqueue a single relevance-quick job. Returns the pg-boss job id (or null
 * when the queue is unavailable). The trigger counts a null return as skipped.
 */
export async function enqueueRelevanceQuick(
  payload: RelevanceQuickPayload,
  options?: PgBoss.SendOptions
): Promise<string | null> {
  const boss = getJobQueue().getInstance();

  return boss.send(JOB_NAMES.ENRICH_RELEVANCE_QUICK, payload, {
    ...RELEVANCE_QUICK_RETRY_OPTIONS,
    ...options,
  });
}
