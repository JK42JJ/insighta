/**
 * Weekly curation build — durable worker (Growth Hub, 2026-07-20).
 * Design: docs/design/growth-hub-curation-personalized-2026-07-20.md (§6).
 *
 * Flow (video-only, no note/book_json):
 *   subscription → runV5Executor(centerGoal=topic, mandala-free) → computeCardRelevance
 *   per card (centerGoal=topic) → relevance floor (off-topic drop) → top TARGET
 *   → write curation_items with a week_of snapshot (replace this week only —
 *   data-reversibility hard rule).
 *
 * P0 scope decisions (§6):
 *   - Discovery = runV5Executor with empty subGoals (B1: validated by one live run
 *     before flag-on). Legacy video-discover/executor needs a mandala → unusable.
 *   - rich_summary is REUSE-ONLY: video_rich_summaries is a video-keyed GLOBAL table
 *     (leaks across goals), so this build NEVER writes it (B2). Existing segments =
 *     core clips; absent = full-video playback (N4). Generation-if-absent = P1.
 *   - SEPARATE from mandala_books → never touches book-fill-gate (no barrier risk).
 */

import type PgBoss from 'pg-boss';
import { logger } from '@/utils/logger';
import { getPrismaClient } from '@/modules/database/client';
import { JOB_NAMES, QUEUE_CONFIG } from '../types';
import { getJobQueue } from '../manager';
import { runV5Executor } from '@/skills/plugins/video-discover/v5/executor';
import { MS_PER_DAY } from '@/utils/time-constants';
import { CURATION_PUBLISHED_AFTER_DAYS } from '@/modules/curation/config';

const log = logger.child({ module: 'queue/curation-build' });

export interface CurationBuildPayload {
  subscriptionId: string;
  /** ISO date (Monday) this build belongs to — the curation_items.week_of key. */
  weekOf: string;
}

/** teamSize per the pg-boss trap (CP498) — explicit, low concurrency. */
const WORKER = { teamSize: 2, teamConcurrency: 2 } as const;

export async function enqueueCurationBuild(
  payload: CurationBuildPayload,
  options?: PgBoss.SendOptions
): Promise<string | null> {
  const boss = getJobQueue().getInstance();
  // singletonKey per subscription dedups concurrent enqueues (weekly + immediate-on-create).
  return boss.send(JOB_NAMES.CURATION_BUILD, payload, {
    singletonKey: payload.subscriptionId,
    ...options,
  });
}

export async function registerCurationBuildWorker(): Promise<void> {
  const boss = getJobQueue().getInstance();
  await boss.work<CurationBuildPayload>(JOB_NAMES.CURATION_BUILD, WORKER, async (job) => {
    const { subscriptionId, weekOf } = job.data;
    const prisma = getPrismaClient();
    const sub = await prisma.curation_subscriptions.findUnique({ where: { id: subscriptionId } });
    if (!sub || !sub.is_active) {
      log.info('curation build skipped (missing/inactive)', { subscriptionId });
      return;
    }

    // build-1 — discover topic → videos, mandala-free. runV5Executor takes a
    // centerGoal STRING (no mandala). subGoals empty → v5 generates queries from
    // centerGoal alone (B1: the empty-subGoals path is validated by one live run
    // before flag-on). publishedAfter biases recent supply = the P0 rising signal.
    const publishedAfter = new Date(Date.now() - CURATION_PUBLISHED_AFTER_DAYS * MS_PER_DAY)
      .toISOString()
      .slice(0, 10);
    const v5 = await runV5Executor({
      centerGoal: sub.topic,
      subGoals: [],
      focusTags: [],
      targetLevel: '',
      language: 'ko',
      includeEnCards: false,
      excludeVideoIds: new Set<string>(),
      env: process.env,
      publishedAfter,
    });

    // build-2/3 — v5 already ranks by relevance (score 0-1, sorted desc) and applies
    // trust/channel/book gating. Use that ranking DIRECTLY — no per-card relevance
    // re-computation. The old per-card computeCardRelevance (an extra LLM call per
    // video) stalled the build for minutes; the existing search path returns in ~6s.
    const picked: Array<{ videoId: string; relevancePct: number }> = v5.cards
      .slice(0, QUEUE_CONFIG.CURATION_TARGET_VIDEOS)
      .map((card) => ({
        videoId: card.videoId,
        relevancePct: Math.max(1, Math.min(100, Math.round((card.score ?? 0) * 100))),
      }));

    // build-4 — rich-summary is REUSE-ONLY for P0. video_rich_summaries is a
    // video-keyed GLOBAL table (leaks across goals), so the build never writes it
    // (B2): existing segments serve as core clips, absent → full-video playback
    // (N4). centerGoal-direct generation-if-absent = P1.

    // build-5 — snapshot this week's items. Replace THIS week only (idempotent
    // re-run); prior weeks are kept (data-reversibility). No mandala_books touched.
    const weekDate = new Date(weekOf);
    await prisma.$transaction([
      prisma.curation_items.deleteMany({
        where: { subscription_id: subscriptionId, week_of: weekDate },
      }),
      ...(picked.length
        ? [
            prisma.curation_items.createMany({
              data: picked.map((p, i) => ({
                subscription_id: subscriptionId,
                video_id: p.videoId,
                relevance_pct: p.relevancePct,
                position: i,
                week_of: weekDate,
              })),
            }),
          ]
        : []),
    ]);

    // build-6 — advance the weekly cadence.
    await prisma.curation_subscriptions.update({
      where: { id: subscriptionId },
      data: { last_run_at: new Date(), next_run_at: new Date(Date.now() + 7 * MS_PER_DAY) },
    });

    log.info('curation build complete', {
      subscriptionId,
      weekOf,
      topic: sub.topic,
      discovered: v5.cards.length,
      picked: picked.length,
      belowMin: picked.length < QUEUE_CONFIG.CURATION_MIN_VIDEOS,
    });
  });
}
