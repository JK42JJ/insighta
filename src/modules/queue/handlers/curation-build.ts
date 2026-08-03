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
import { Prisma } from '@prisma/client';
import { matchFromVideoPoolByCenterGoal } from '@/skills/plugins/video-discover/v3/cache-matcher';
import {
  embedBatch,
  vectorToLiteral,
  QWEN3_EMBED_MODEL,
} from '@/skills/plugins/iks-scorer/embedding';
import { runV5Executor } from '@/skills/plugins/video-discover/v5/executor';
import { MS_PER_DAY } from '@/utils/time-constants';
import { config } from '../../../config';
import { nextKstWeekdayAt } from '@/utils/kst';
import { collectChannelUploads } from '@/modules/curation/channel-uploads';
import { curationPickPlan } from '@/modules/curation/config';
import { resolveVideosApiKeys } from '@/skills/plugins/video-discover/v2/youtube-client';

/**
 * How far back channel mode looks: the last seven days, every time.
 *
 * It used to look forward from `weekOf`, which is the Monday the build belongs
 * to — so the Monday-morning build asked for videos uploaded since a moment
 * that had just happened and got a nearly empty week, and the build that runs
 * when someone adds a channel on a Friday got four days. Measured 2026-07-28:
 * a two-channel curation built one item.
 *
 * Seven days is what a weekly delivery means, so seven days is what it asks for.
 */
const CHANNEL_LOOKBACK_DAYS = 7;

/** Deep-pass widened retry window when the 7-day live search comes back empty
 *  (niche topics; empty-week floor, 2026-08-03). One retry only — quota. */
const CURATION_DEEP_RETRY_DAYS = 30;

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
/**
 * Everything this user has been served for this topic, across the WHOLE
 * subscription family (legacy duplicate rows were deactivated 2026-08-03, but
 * their items are history too — a repeat through a deactivated twin is still
 * a repeat to the user). `excludeWeekOf` keeps the current week rebuildable.
 */
async function servedHistory(
  prisma: ReturnType<typeof getPrismaClient>,
  sub: { id: string; user_id: string; topic: string },
  excludeWeekOf?: Date
): Promise<Array<{ videoId: string; weekOf: Date }>> {
  const norm = (s: string) => s.trim().toLowerCase();
  const siblings = await prisma.curation_subscriptions.findMany({
    where: { user_id: sub.user_id },
    select: { id: true, topic: true },
  });
  const familyIds = siblings.filter((s) => norm(s.topic) === norm(sub.topic)).map((s) => s.id);
  const rows = await prisma.curation_items.findMany({
    where: {
      subscription_id: { in: familyIds.length ? familyIds : [sub.id] },
      ...(excludeWeekOf ? { week_of: { not: excludeWeekOf } } : {}),
    },
    // MOST RECENT week per video: the rung horizon asks "was this served
    // recently", so keep the newest sighting of each video_id.
    select: { video_id: true, week_of: true },
    orderBy: [{ video_id: 'asc' }, { week_of: 'desc' }],
    distinct: ['video_id'],
  });
  return rows.map((r) => ({ videoId: r.video_id, weekOf: r.week_of }));
}

async function deepEnrichCuration(
  subscriptionId: string,
  topic: string,
  weekDate: Date,
  prisma: ReturnType<typeof getPrismaClient>,
  sub: { id: string; user_id: string; topic: string }
): Promise<void> {
  // History exclusion rides the live search too (weekly-novelty fix): a video
  // served in ANY prior week must not come back through the enrichment door.
  const everServed = new Set((await servedHistory(prisma, sub)).map((h) => h.videoId));
  // Layer B (weekly supply, 2026-08-03): the live search asks for THIS WEEK'S
  // uploads — publishedAfter = the trailing week before weekDate (the same
  // seven-days-is-a-week rule channel mode uses). v5 internally upserts its
  // picks into video_pool (reusePickedToPool), so each weekly deep run also
  // feeds next week's pool rungs. Niche topics can yield zero in a 7-day
  // window — one widened retry (30d) before accepting a quiet enrichment
  // (empty-week floor, revised 2026-08-03).
  const runSearch = (days: number) =>
    runV5Executor({
      centerGoal: topic,
      subGoals: [],
      focusTags: [],
      targetLevel: '',
      language: 'ko',
      includeEnCards: false,
      excludeVideoIds: everServed,
      publishedAfter: new Date(weekDate.getTime() - days * MS_PER_DAY).toISOString(),
      env: process.env,
    });
  let v5 = await runSearch(CHANNEL_LOOKBACK_DAYS);
  if (!v5.cards.length) v5 = await runSearch(CURATION_DEEP_RETRY_DAYS);
  const existing = await prisma.curation_items.findMany({
    where: { subscription_id: subscriptionId, week_of: weekDate },
    select: { video_id: true },
  });
  // Fresh uploads REPLACE the tail of the pool-picked week rather than only
  // topping it up: reserve room for at least CURATION_FRESH_RESERVE items.
  const have = new Set(existing.map((e) => e.video_id));
  const fresh = v5.cards.filter((c) => !have.has(c.videoId));
  let room = QUEUE_CONFIG.CURATION_TARGET_VIDEOS - existing.length;
  if (fresh.length && room < QUEUE_CONFIG.CURATION_FRESH_RESERVE) {
    const evict = Math.min(
      QUEUE_CONFIG.CURATION_FRESH_RESERVE - room,
      Math.min(fresh.length, existing.length)
    );
    if (evict > 0) {
      // Evict the lowest-positioned (least relevant) unwatched pool picks.
      const evictable = await prisma.curation_items.findMany({
        where: { subscription_id: subscriptionId, week_of: weekDate, watched_at: null },
        orderBy: { position: 'desc' },
        take: evict,
        select: { id: true },
      });
      if (evictable.length) {
        await prisma.curation_items.deleteMany({
          where: { id: { in: evictable.map((e) => e.id) } },
        });
        room += evictable.length;
      }
    }
  }
  if (room <= 0) return;
  const tail = await prisma.curation_items.count({
    where: { subscription_id: subscriptionId, week_of: weekDate },
  });
  const additions = fresh.slice(0, room).map((c, i) => ({
    subscription_id: subscriptionId,
    video_id: c.videoId,
    relevance_pct: Math.max(1, Math.min(100, Math.round((c.score ?? 0) * 100))),
    position: tail + i,
    week_of: weekDate,
  }));
  if (additions.length) await prisma.curation_items.createMany({ data: additions });
  // Embed the fresh arrivals NOW (reuse-from-v5 defers embeddings, which is why
  // the pool held 0 embedded videos published within 7d): next week's 7d KNN
  // rung only works if this week's supply lands with vectors.
  await embedPoolVideos(
    prisma,
    additions.map((a) => a.video_id)
  );
  log.info('curation deep enrich complete', {
    subscriptionId,
    topic,
    added: additions.length,
    freshCandidates: fresh.length,
  });
}

/**
 * Embed pool rows that arrived without vectors (reuse-from-v5 defers this).
 * Mirrors the promote-from-* embedding write: title+description text,
 * ON CONFLICT DO NOTHING, best-effort per video.
 */
async function embedPoolVideos(
  prisma: ReturnType<typeof getPrismaClient>,
  videoIds: string[]
): Promise<void> {
  if (!videoIds.length) return;
  try {
    const rows = await prisma.video_pool.findMany({
      where: { video_id: { in: videoIds } },
      select: { video_id: true, title: true, description: true },
    });
    if (!rows.length) return;
    const texts = rows.map((r) => `${r.title}\n${(r.description ?? '').slice(0, 500)}`);
    const vecs = await embedBatch(texts);
    for (let i = 0; i < rows.length; i++) {
      const vec = vecs[i];
      const row = rows[i];
      if (!vec || vec.length === 0 || !row) continue;
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO public.video_pool_embeddings (video_id, embedding, text_input, model_version)
        VALUES (${row.video_id}, ${vectorToLiteral(vec)}::vector, ${texts[i]}, ${QWEN3_EMBED_MODEL})
        ON CONFLICT (video_id, model_version) DO NOTHING
      `);
    }
  } catch (err) {
    log.warn('curation embedPoolVideos failed (non-fatal)', {
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
  }
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
      await deepEnrichCuration(subscriptionId, sub.topic, new Date(weekOf), prisma, sub);
      return;
    }

    // build-1/2/3 — how the week's videos are chosen. This is the ONLY thing the
    // source branch changes; the snapshot write, watched_at preservation and
    // cadence advance below are shared verbatim.
    // `source` alone is NOT the signal: selectCuration has always created every
    // curation with source='youtube_subs' (mobile/index.html), so gating on it
    // would flip every existing topic curation into channel mode the moment the
    // flag went on -- and each would get an empty week, because none of them
    // follow any channels. Followed channels are the honest signal: they only
    // exist when the user added them.
    const followed =
      config.curationChannelSource.enabled && !job.data.deep
        ? await prisma.curation_channels.findMany({
            where: { subscription_id: subscriptionId },
            select: { channel_id: true, uploads_playlist_id: true },
          })
        : [];
    const channelMode = followed.length > 0;

    let picked: Array<{ videoId: string; relevancePct: number }>;

    if (channelMode) {
      // Channel mode — the user named the channels, so there is nothing to
      // discover and nothing to score. Interleaved so one prolific channel
      // cannot fill the week.
      //
      const since = new Date(Date.now() - CHANNEL_LOOKBACK_DAYS * MS_PER_DAY);
      const channels = followed;
      picked = await collectChannelUploads({
        channels,
        since,
        limit: QUEUE_CONFIG.CURATION_TARGET_VIDEOS,
        apiKeys: resolveVideosApiKeys(process.env),
      });
      log.info('curation build (channel mode)', {
        subscriptionId,
        channels: channels.length,
        picked: picked.length,
      });
    } else {
      // Topic mode — INSTANT pool-cosine KNN (reuses add-cards Layer1,
      // matchFromVideoPoolByCenterGoal). Embed the topic ONCE (~0.5s) → pgvector cosine
      // on video_pool_embeddings → top-N. NO live search / candidate embed / LLM picker;
      // runV5Executor's full pipeline (LLM×2 + search.list fanout + bulk embed) stalled
      // the build 20s+. ~1-2s. Thin-pool niche topics → async v5 enrichment = follow-up.
      //
      // Weekly novelty + empty-week floor (2026-08-03, revised after the
      // empty-week incident): the pick walks CURATION_PICK_RUNGS and
      // ACCUMULATES, freshest-first, until the week is full — this week's
      // uploads > fresh > never-served > less-aligned never-served >
      // long-ago-served re-entry. The last rungs shrink the exclusion horizon
      // (a month-old good video returning beats a thin week), so a niche
      // topic can no longer drain itself to zero.
      const [centerEmbedding] = await embedBatch([sub.topic]);
      if (!centerEmbedding) {
        log.warn('curation build: topic embed failed', { subscriptionId, topic: sub.topic });
        return;
      }
      const history = await servedHistory(prisma, sub, new Date(weekOf));
      const plan = curationPickPlan(new Date(weekOf));
      const acc = new Map<string, { videoId: string; relevancePct: number }>();
      const rungStats: Array<{ rung: number; added: number }> = [];
      for (let r = 0; r < plan.length; r++) {
        if (acc.size >= QUEUE_CONFIG.CURATION_TARGET_VIDEOS) break;
        const step = plan[r]!;
        const excluded = new Set(acc.keys());
        for (const h of history) {
          if (!step.exclusionAfter || h.weekOf >= step.exclusionAfter) excluded.add(h.videoId);
        }
        const matches = await matchFromVideoPoolByCenterGoal({
          centerEmbedding,
          subGoals: [],
          language: 'ko',
          limit: QUEUE_CONFIG.CURATION_TARGET_VIDEOS,
          threshold: step.threshold,
          excludeVideoIds: excluded,
          publishedAfter: step.publishedAfter,
        });
        let added = 0;
        for (const m of matches) {
          if (acc.size >= QUEUE_CONFIG.CURATION_TARGET_VIDEOS) break;
          if (acc.has(m.videoId)) continue;
          acc.set(m.videoId, {
            videoId: m.videoId,
            relevancePct: Math.max(1, Math.min(100, Math.round((m.score ?? 0) * 100))),
          });
          added += 1;
        }
        if (added) rungStats.push({ rung: r, added });
      }
      picked = Array.from(acc.values());
      log.info('curation build (topic mode)', {
        subscriptionId,
        historySize: history.length,
        rungStats,
        picked: picked.length,
      });
    }

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
    // Empty-week floor (2026-08-03 incident): the snapshot is REPLACED only
    // when there is a replacement. picked=0 used to delete the week and write
    // nothing — an empty feed. Now the previous snapshot is preserved and the
    // deep pass still runs behind.
    if (!picked.length) {
      log.warn('curation build: nothing pickable — preserving existing week', {
        subscriptionId,
        topic: sub.topic,
        mode: channelMode ? 'channel' : 'topic',
      });
    } else {
      const prevWatched = new Map(
        (
          await prisma.curation_items.findMany({
            where: {
              subscription_id: subscriptionId,
              week_of: weekDate,
              watched_at: { not: null },
            },
            select: { video_id: true, watched_at: true },
          })
        ).map((r) => [r.video_id, r.watched_at])
      );
      await prisma.$transaction([
        prisma.curation_items.deleteMany({
          where: { subscription_id: subscriptionId, week_of: weekDate },
        }),
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
      ]);
    }

    // Topic mode ALWAYS enqueues the deep pass now (weekly supply, 2026-08-03):
    // it is no longer just a thin-pool fallback — it is where this week's
    // uploads actually come from (v5 live search with publishedAfter=7d,
    // CURATION_FRESH_RESERVE slots guaranteed). Serve-first: the instant pool
    // result is already live; fresh uploads append/replace minutes later.
    //
    // NEVER in channel mode: a quiet week there is the honest answer (§2-d), and
    // topping it up with discovered videos would put channels in the feed that
    // the user did not follow — the exact thing this mode exists to prevent.
    if (!channelMode) {
      await enqueueCurationBuild(
        { subscriptionId, weekOf, deep: true },
        { singletonKey: `${subscriptionId}:deep` }
      );
    }

    // build-6 — advance the cadence. Under the KST schedule `next_run_at` is
    // DISPLAY-ONLY (the weekday column + last_run_at decide what is due), so it is
    // pinned to the next delivery slot instead of "now + 7d", which drifted to
    // whatever time the build happened to run.
    const doneAt = new Date();
    await prisma.curation_subscriptions.update({
      where: { id: subscriptionId },
      data: {
        last_run_at: doneAt,
        next_run_at: config.curationSchedule.kstEnabled
          ? nextKstWeekdayAt(
              sub.weekday,
              doneAt,
              QUEUE_CONFIG.CURATION_DELIVERY_HOUR_KST,
              QUEUE_CONFIG.CURATION_DELIVERY_MINUTE_KST
            )
          : new Date(doneAt.getTime() + 7 * MS_PER_DAY),
      },
    });

    log.info('curation build complete', {
      subscriptionId,
      weekOf,
      topic: sub.topic,
      mode: channelMode ? 'channel' : 'topic',
      picked: picked.length,
      // Only meaningful in topic mode; channel mode has no pool and an empty
      // week is a valid outcome there, not a shortfall.
      belowMin: !channelMode && picked.length < QUEUE_CONFIG.CURATION_MIN_VIDEOS,
    });
  });
}
