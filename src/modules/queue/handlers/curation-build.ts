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
import { matchFromVideoPoolByCenterGoal } from '@/skills/plugins/video-discover/v3/cache-matcher';
import { embedBatch } from '@/skills/plugins/iks-scorer/embedding';
import { runV5Executor } from '@/skills/plugins/video-discover/v5/executor';
import { MS_PER_DAY } from '@/utils/time-constants';

const log = logger.child({ module: 'queue/curation-build' });

export interface CurationBuildPayload {
  subscriptionId: string;
  /** ISO date (Monday) this build belongs to — the curation_items.week_of key. */
  weekOf: string;
  /** Background live-search enrichment for thin-pool topics (serve-first, §fallback). */
  deep?: boolean;
}

/**
 * Background enrichment for thin-pool (niche) topics: the fast pool-cosine result was
 * already served; this runs the (slow but async) live v5 search and APPENDS new videos
 * to the week — never blocks the user. Serve-first pattern.
 */
async function deepEnrichCuration(
  subscriptionId: string,
  topic: string,
  weekDate: Date,
  prisma: ReturnType<typeof getPrismaClient>
): Promise<void> {
  const v5 = await runV5Executor({
    centerGoal: topic,
    subGoals: [],
    focusTags: [],
    targetLevel: '',
    language: 'ko',
    includeEnCards: false,
    excludeVideoIds: new Set<string>(),
    env: process.env,
  });
  const existing = await prisma.curation_items.findMany({
    where: { subscription_id: subscriptionId, week_of: weekDate },
    select: { video_id: true },
  });
  const room = QUEUE_CONFIG.CURATION_TARGET_VIDEOS - existing.length;
  if (room <= 0) return;
  const have = new Set(existing.map((e) => e.video_id));
  const additions = v5.cards
    .filter((c) => !have.has(c.videoId))
    .slice(0, room)
    .map((c, i) => ({
      subscription_id: subscriptionId,
      video_id: c.videoId,
      relevance_pct: Math.max(1, Math.min(100, Math.round((c.score ?? 0) * 100))),
      position: existing.length + i,
      week_of: weekDate,
    }));
  if (additions.length) await prisma.curation_items.createMany({ data: additions });
  log.info('curation deep enrich complete', { subscriptionId, topic, added: additions.length });
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

    // Background enrichment pass (thin-pool topics) — append live-search results, don't
    // touch cadence or replace the week. The fast pool result is already live.
    if (job.data.deep) {
      await deepEnrichCuration(subscriptionId, sub.topic, new Date(weekOf), prisma);
      return;
    }

    // build-1/2/3 — INSTANT pool-cosine KNN (reuses add-cards Layer1,
    // matchFromVideoPoolByCenterGoal). Embed the topic ONCE (~0.5s) → pgvector cosine
    // on video_pool_embeddings → top-N. NO live search / candidate embed / LLM picker;
    // runV5Executor's full pipeline (LLM×2 + search.list fanout + bulk embed) stalled
    // the build 20s+. ~1-2s. Thin-pool niche topics → async v5 enrichment = follow-up.
    const [centerEmbedding] = await embedBatch([sub.topic]);
    if (!centerEmbedding) {
      log.warn('curation build: topic embed failed', { subscriptionId, topic: sub.topic });
      return;
    }
    const matches = await matchFromVideoPoolByCenterGoal({
      centerEmbedding,
      subGoals: [],
      language: 'ko',
      limit: QUEUE_CONFIG.CURATION_TARGET_VIDEOS,
    });
    const picked: Array<{ videoId: string; relevancePct: number }> = matches.map((m) => ({
      videoId: m.videoId,
      relevancePct: Math.max(1, Math.min(100, Math.round((m.score ?? 0) * 100))),
    }));

    // build-4 — rich-summary is REUSE-ONLY for P0. video_rich_summaries is a
    // video-keyed GLOBAL table (leaks across goals), so the build never writes it
    // (B2): existing segments serve as core clips, absent → full-video playback
    // (N4). centerGoal-direct generation-if-absent = P1.

    // build-5 — snapshot this week's items. Replace THIS week only (idempotent
    // re-run); prior weeks are kept (data-reversibility). No mandala_books touched.
    // Same-week rebuild PRESERVES watched_at for retained video_ids (supervisor
    // caveat: delete-recreate must not turn "in progress" back into "new") — a
    // NEW week's rows are born NULL, which is the intended weekly reset.
    const weekDate = new Date(weekOf);
    const prevWatched = new Map(
      (
        await prisma.curation_items.findMany({
          where: { subscription_id: subscriptionId, week_of: weekDate, watched_at: { not: null } },
          select: { video_id: true, watched_at: true },
        })
      ).map((r) => [r.video_id, r.watched_at])
    );
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
                watched_at: prevWatched.get(p.videoId) ?? null,
              })),
            }),
          ]
        : []),
    ]);

    // Thin pool (niche topic) → enqueue a background live-search enrichment (serve-first:
    // the fast pool result is already served; v5 appends more behind). Separate singleton
    // key so it doesn't collide with the weekly/immediate fast build.
    if (picked.length < QUEUE_CONFIG.CURATION_MIN_VIDEOS) {
      await enqueueCurationBuild(
        { subscriptionId, weekOf, deep: true },
        { singletonKey: `${subscriptionId}:deep` }
      );
    }

    // build-6 — advance the weekly cadence.
    await prisma.curation_subscriptions.update({
      where: { id: subscriptionId },
      data: { last_run_at: new Date(), next_run_at: new Date(Date.now() + 7 * MS_PER_DAY) },
    });

    log.info('curation build complete', {
      subscriptionId,
      weekOf,
      topic: sub.topic,
      poolMatches: matches.length,
      picked: picked.length,
      belowMin: picked.length < QUEUE_CONFIG.CURATION_MIN_VIDEOS,
    });
  });
}
