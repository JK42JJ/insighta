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
import { MS_PER_DAY } from '@/utils/time-constants';
import { config } from '../../../config';
import { nextKstWeekdayAt } from '@/utils/kst';
import { collectChannelUploads } from '@/modules/curation/channel-uploads';
import { computeCardRelevance } from '@/modules/relevance/compute-card-relevance';
import { CURATION_RELEVANCE_FLOOR } from '@/modules/curation/config';
import { getPoolTitles } from '@/modules/curation/pool-titles';
import { curationPickPlan } from '@/modules/curation/config';
import { fetchFreshTopicVideos } from '@/modules/curation/weekly-fresh';
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

const log = logger.child({ module: 'queue/curation-build' });

export interface CurationBuildPayload {
  subscriptionId: string;
  /** ISO date (Monday) this build belongs to — the curation_items.week_of key. */
  weekOf: string;
  /** Fresh-append pass for immediate builds (serve-first follow-up). */
  deep?: boolean;
  /**
   * Build context (2026-08-03 redesign): 'immediate' = create-time, a user is
   * waiting → instant pool serve + deep follow-up. Anything else (incl. legacy
   * in-flight jobs without the field) = weekly → fresh-first inline.
   */
  mode?: 'immediate' | 'weekly';
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

/**
 * Fresh append for IMMEDIATE builds (the deep job): the create-time build
 * pool-serves instantly (the #1298 rationale — a user is waiting), then this
 * appends the week's fresh uploads behind. Weekly scheduled builds do NOT come
 * through here — their fresh leg runs inline and FIRST (weekly-fresh.ts).
 */
async function deepEnrichCuration(
  subscriptionId: string,
  topic: string,
  weekDate: Date,
  prisma: ReturnType<typeof getPrismaClient>,
  sub: { id: string; user_id: string; topic: string }
): Promise<void> {
  // History exclusion rides the live search too: a video served in ANY prior
  // week must not come back through the enrichment door.
  const everServed = new Set((await servedHistory(prisma, sub)).map((h) => h.videoId));
  const existing = await prisma.curation_items.findMany({
    where: { subscription_id: subscriptionId, week_of: weekDate },
    select: { video_id: true },
  });
  for (const e of existing) everServed.add(e.video_id);
  const room = QUEUE_CONFIG.CURATION_TARGET_VIDEOS - existing.length;
  if (room <= 0) return;
  const fresh = await fetchFreshTopicVideos({
    topic,
    weekDate,
    excludeVideoIds: everServed,
    limit: room,
  });
  if (!fresh.picks.length) {
    log.info('curation deep enrich: no fresh uploads this window', { subscriptionId, topic });
    return;
  }
  const additions = fresh.picks.map((p, i) => ({
    subscription_id: subscriptionId,
    video_id: p.videoId,
    relevance_pct: p.relevancePct,
    position: existing.length + i,
    week_of: weekDate,
  }));
  await prisma.curation_items.createMany({ data: additions });
  log.info('curation deep enrich complete', {
    subscriptionId,
    topic,
    added: additions.length,
    windowDays: fresh.windowDays,
  });
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
      // Topic mode. Two build modes with different primary sources (2026-08-03
      // redesign, restores design §6):
      //
      //   weekly (scheduled, no one waiting) — PRIMARY = live v5 search over
      //   THIS WEEK'S uploads (fetchFreshTopicVideos: fit-gated, pool-upserted
      //   = render-safe, embedded best-effort). The pool rungs only FILL the
      //   remainder. The #1298 pool-KNN swap was justified by the CREATE-time
      //   wait ("curation building never finished") — a constraint the weekly
      //   background path never had.
      //
      //   immediate (create-time, user waiting) — instant pool-KNN serve as
      //   #1298 shipped it; the fresh leg follows via the deep job.
      //
      // Both accumulate through CURATION_PICK_RUNGS with history exclusion and
      // the shrinking-horizon floor (empty-week incident, same day) so a niche
      // topic can neither repeat itself nor drain to zero.
      const history = await servedHistory(prisma, sub, new Date(weekOf));
      const acc = new Map<string, { videoId: string; relevancePct: number }>();
      const isWeekly = job.data.mode !== 'immediate';
      let freshMeta: { windowDays: number; fitDropped: number; picks: number } | null = null;
      if (isWeekly) {
        const everServed = new Set(history.map((h) => h.videoId));
        const fresh = await fetchFreshTopicVideos({
          topic: sub.topic,
          weekDate: new Date(weekOf),
          excludeVideoIds: everServed,
          limit: QUEUE_CONFIG.CURATION_TARGET_VIDEOS,
        });
        for (const p of fresh.picks) acc.set(p.videoId, p);
        freshMeta = {
          windowDays: fresh.windowDays,
          fitDropped: fresh.fitDropped,
          picks: fresh.picks.length,
        };
      }
      if (acc.size < QUEUE_CONFIG.CURATION_TARGET_VIDEOS) {
        const [centerEmbedding] = await embedBatch([sub.topic]);
        if (!centerEmbedding && acc.size === 0) {
          log.warn('curation build: topic embed failed', { subscriptionId, topic: sub.topic });
          return;
        }
        if (centerEmbedding) {
          const plan = curationPickPlan(new Date(weekOf));
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
          if (rungStats.length) log.info('curation pool fill', { subscriptionId, rungStats });
        }
      }
      picked = Array.from(acc.values());

      // One judge, at the one place every leg arrives.
      //
      // The fit gate used to live inside the fresh leg only, so anything the
      // pool ladder contributed entered with no topic judgement at all —
      // measured 2026-08-04 on a "파이썬" subscription: 16 of 17 items came
      // from the ladder at cosine >= 0.35, and nine of them were unrelated
      // (Spanish lessons, a makeup exam course, guitar practice, a lofi
      // playlist). Duplicating the gate per leg is what let it be missed; the
      // guarantee moves to the chokepoint instead.
      //
      // fail-CLOSED. An unjudged video is one we do not know about, and the
      // rule is that garbage does not enter even at the cost of a thin week.
      // The fresh leg's own fail-open (keep at floor on judge error) is the
      // opposite of that and is retired by this.
      picked = await gateByFit(prisma, sub.topic, picked);

      // The weekly contract, finally measurable: how much of the week is new.
      const histSet = new Set(history.map((h) => h.videoId));
      const repeats = picked.filter((p) => histSet.has(p.videoId)).length;
      log.info('curation build (topic mode)', {
        subscriptionId,
        buildMode: isWeekly ? 'weekly' : 'immediate',
        historySize: history.length,
        fresh: freshMeta,
        picked: picked.length,
        weeklyNoveltyPct: picked.length
          ? Math.round(((picked.length - repeats) / picked.length) * 100)
          : null,
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
    // Fresh follow-up is only needed for IMMEDIATE builds (the weekly path ran
    // its fresh leg inline and first). Channel mode never (§2-d honest quiet week).
    if (!channelMode && job.data.mode === 'immediate') {
      await enqueueCurationBuild(
        { subscriptionId, weekOf, deep: true, mode: 'immediate' },
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

/**
 * Drop every pick the topic judge does not pass. Runs on the assembled week,
 * whichever leg produced each item.
 *
 * Titles come from video_pool because that is the same row the deck renders
 * from — judging a title the user will never see would be judging the wrong
 * thing. A pick with no pool row cannot render anyway, so it is dropped here
 * rather than surviving as a ghost card.
 */
async function gateByFit(
  prisma: ReturnType<typeof getPrismaClient>,
  topic: string,
  picks: Array<{ videoId: string; relevancePct: number }>
): Promise<Array<{ videoId: string; relevancePct: number }>> {
  if (!picks.length) return picks;

  const titles = await getPoolTitles(
    prisma,
    picks.map((p) => p.videoId)
  );

  const kept: Array<{ videoId: string; relevancePct: number }> = [];
  let noTitle = 0;
  let judgeFailed = 0;
  let belowFloor = 0;

  for (const pick of picks) {
    const title = titles.get(pick.videoId);
    if (!title) {
      noTitle += 1;
      continue;
    }
    const r = await computeCardRelevance({
      videoId: pick.videoId,
      title,
      centerGoal: topic,
      language: 'ko',
    });
    if (!r.ok) {
      judgeFailed += 1;
      continue;
    }
    if (r.relevancePct < CURATION_RELEVANCE_FLOOR) {
      belowFloor += 1;
      continue;
    }
    // One scale from here on. The ladder used to store cosine x 100 in the same
    // column the fresh leg filled with a judge score, so the ordering mixed two
    // units that do not compare.
    kept.push({ videoId: pick.videoId, relevancePct: r.relevancePct });
  }

  log.info('curation fit gate', {
    topic,
    inPicks: picks.length,
    kept: kept.length,
    noTitle,
    judgeFailed,
    belowFloor,
    floor: CURATION_RELEVANCE_FLOOR,
  });
  return kept.sort((a, b) => b.relevancePct - a.relevancePct);
}

/** Test seam — the gate is internal to the build, but it is the one piece
 *  whose behaviour a reviewer needs pinned independently of a live queue. */
export const __testing = { gateByFit };
