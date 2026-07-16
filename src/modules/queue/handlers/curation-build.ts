/**
 * Weekly curation build — durable worker (Growth Hub, 2026-07-16). SCAFFOLD.
 *
 * Flow (all reused parts, no note/book_json/Sonnet):
 *   subscription → discover candidates (by source) → compute-card-relevance
 *   → passesBookGate (off-topic drop) → pick CURATION_TARGET_VIDEOS by relevance
 *   → ensure rich_summary v2 (segment relevance_pct is INLINE → useHighlightReel
 *   works, no separate backfill) → write curation_items with a week_of snapshot
 *   (D2: snapshot not overwrite — data-reversibility hard rule).
 *
 * SEPARATE from mandala_books → never touches book-fill-gate (no barrier risk).
 *
 * The step bodies are TODO on purpose: each wires an existing module
 * (video-discover executor / relevance/compute-card-relevance / config/book-gate
 * passesBookGate / enrich-rich-summary) whose interface must be read before use
 * (CLAUDE.md read-source-before-guessing). Left for a fresh session to implement against
 * the real signatures rather than guessed ones.
 */

import type PgBoss from 'pg-boss';
import { logger } from '@/utils/logger';
import { getPrismaClient } from '@/modules/database/client';
import { JOB_NAMES } from '../types';
import { getJobQueue } from '../manager';

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
  boss.work<CurationBuildPayload>(JOB_NAMES.CURATION_BUILD, WORKER, async (job) => {
    const { subscriptionId, weekOf } = job.data;
    const prisma = getPrismaClient();
    const sub = await prisma.curation_subscriptions.findUnique({ where: { id: subscriptionId } });
    if (!sub || !sub.is_active) {
      log.info('curation build skipped (missing/inactive)', { subscriptionId });
      return;
    }

    // TODO(build-1) discover candidates by sub.source ('discover' | 'youtube_subs' | 'hybrid').
    //   'discover' → reuse video-discover executor with sub.topic.
    //   'youtube_subs' → user's youtube_subscriptions (sync_new_videos) new uploads.
    // TODO(build-2) compute-card-relevance → per-video relevance_pct.
    // TODO(build-3) passesBookGate (src/config/book-gate.ts) — drop off-topic cards.
    // TODO(build-4) pick top CURATION_TARGET_VIDEOS by relevance (order → position).
    // TODO(build-5) ensure rich_summary v2 exists per picked video so segment
    //   relevance_pct is present (enqueueEnrichRichSummary) — powers useHighlightReel.
    // TODO(build-6) write curation_items rows: { subscription_id, video_id,
    //   relevance_pct, position, week_of } (snapshot; do NOT delete prior weeks).
    // TODO(build-7) sub.last_run_at = now, next_run_at += cadence (7d for weekly).
    // TODO(notify)  user-scoped "this week curation arrived" (D3 — email reuse candidate).

    log.info('curation build (SCAFFOLD — steps TODO)', { subscriptionId, weekOf, topic: sub.topic });
  });
}
