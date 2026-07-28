/**
 * Curation API routes (Growth Hub, 2026-07-16).
 *
 * A curation = weekly topic subscription that builds a relevance-ordered video
 * feed (NO note/book_json). Create → enqueue an immediate build ("immediate", James)
 * plus the recurring weekly job refreshes it.
 *
 * Personalized flow (2026-07-20): GET /suggest returns 3 topics scored from the
 * user's YouTube interest profile × trend pool; POST / creates the chosen curation
 * (immediate build) and records the selection in the append-only proposal log
 * (reinforcement). The build worker discovers a topic's videos mandala-free via
 * runV5Executor. Design: docs/design/growth-hub-curation-personalized-2026-07-20.md.
 */

import { FastifyPluginCallback } from 'fastify';
import { getPrismaClient } from '../../modules/database';
import { enqueueCurationBuild } from '../../modules/queue/handlers/curation-build';
import { MS_PER_DAY } from '../../utils/time-constants';
import { suggestTopics } from '../../modules/curation/suggest';
import { maybeTriggerProfileBuild } from '../../modules/curation/interest-profile';
import { getAccessToken } from '../../modules/youtube/api';
import { curationWeekKey } from '../../modules/queue/handlers/curation-weekly';
import { getCurationLimit, getCurationChannelLimit, type Tier } from '../../config/quota';
import { resolveChannel, resolveChannelIds } from '../../modules/curation/channel-resolve';
import { resolveVideosApiKeys } from '../../skills/plugins/video-discover/v2/youtube-client';
import { isValidWeekday, nextKstWeekdayAt } from '../../utils/kst';
import { QUEUE_CONFIG } from '../../modules/queue/types';

/** This week's snapshot key. Single source (was duplicated here and in the
 *  weekly handler); resolves on the KST calendar once the schedule flag is on. */
const mondayOf = (d: Date): string => curationWeekKey(d);

const ALLOWED_SOURCES = new Set(['discover', 'youtube_subs', 'hybrid']);

/**
 * Tier for the curation quota. An approved beta application counts as pro for
 * the duration of the closed beta — the testers were invited to exercise the
 * product, so holding them to the free ceiling defeats the point. Redeeming an
 * invite ticket does not: `invited_by` non-null means a member spent a ticket on
 * them, which is a signup path, not a plan.
 */
async function resolveCurationTier(
  prisma: ReturnType<typeof getPrismaClient>,
  userId: string
): Promise<Tier> {
  const sub = await prisma.user_subscriptions.findUnique({
    where: { user_id: userId },
    select: { tier: true },
  });
  const tier = (sub?.tier ?? 'free') as Tier;
  if (tier !== 'free') return tier;

  const user = await prisma.users.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user?.email) return 'free';
  const approved = await prisma.beta_applications.findFirst({
    where: { email: user.email, status: { in: ['invited', 'joined'] }, invited_by: null },
    select: { id: true },
  });
  return approved ? 'pro' : 'free';
}

/** Store a resolved channel against a subscription. Idempotent: re-adding
 *  refreshes the display snapshot and leaves `added_via` as first recorded. */
async function attachChannel(
  prisma: ReturnType<typeof getPrismaClient>,
  subscriptionId: string,
  ch: NonNullable<Awaited<ReturnType<typeof resolveChannel>>>,
  addedVia: 'manual' | 'picked'
) {
  return prisma.curation_channels.upsert({
    where: {
      subscription_id_channel_id: { subscription_id: subscriptionId, channel_id: ch.channelId },
    },
    create: {
      subscription_id: subscriptionId,
      channel_id: ch.channelId,
      uploads_playlist_id: ch.uploadsPlaylistId,
      channel_title: ch.title,
      thumbnail_url: ch.thumbnailUrl,
      added_via: addedVia,
    },
    update: {
      uploads_playlist_id: ch.uploadsPlaylistId,
      channel_title: ch.title,
      thumbnail_url: ch.thumbnailUrl,
    },
    select: {
      id: true,
      channel_id: true,
      channel_title: true,
      thumbnail_url: true,
      added_via: true,
      last_seen_at: true,
    },
  });
}

/** Infinity is not JSON — the wire form for "unlimited" is null. */
const quotaValue = (n: number): number | null => (Number.isFinite(n) ? n : null);

/**
 * 404 unless the caller owns :id. Returns the subscription id + owner so the
 * channel routes below never re-query it, and replies on failure so callers can
 * `if (!owned) return;`.
 */
async function requireOwnedSubscription(
  request: { user?: unknown; params: { id: string } },
  reply: {
    code: (n: number) => { send: (b: unknown) => unknown };
  }
): Promise<{ id: string; userId: string } | null> {
  if (!request.user || !('userId' in (request.user as object))) {
    reply.code(401).send({ status: 'error', code: 'UNAUTHORIZED' });
    return null;
  }
  const userId = (request.user as { userId: string }).userId;
  const prisma = getPrismaClient();
  const sub = await prisma.curation_subscriptions.findUnique({
    where: { id: request.params.id },
    select: { id: true, user_id: true },
  });
  if (!sub || sub.user_id !== userId) {
    reply.code(404).send({ status: 'error', code: 'CURATION_NOT_FOUND' });
    return null;
  }
  return { id: sub.id, userId };
}

export const curationRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  /** POST /curations — create a weekly curation subscription + immediate build. */
  fastify.post('/', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!request.user || !('userId' in request.user)) {
      return reply.code(401).send({ status: 'error', code: 'UNAUTHORIZED' });
    }
    const userId = request.user.userId;
    const body = (request.body ?? {}) as {
      topic?: unknown;
      source?: unknown;
      mandalaId?: unknown;
      channelInput?: unknown;
    };

    // Channel-first creation. "I want only the channels I pick, and only what
    // they upload each week" is a way of STARTING a curation, not something you
    // bolt onto one you already made -- the first build has to know, or the
    // user gets a week of discovered videos they never asked for.
    //
    // Resolving here (rather than making the client create-then-attach) keeps it
    // one call and means the subscription is named after the real channel, never
    // after whatever the user pasted.
    const channelInput = typeof body.channelInput === 'string' ? body.channelInput.trim() : '';
    let resolvedChannel: Awaited<ReturnType<typeof resolveChannel>> = null;
    if (channelInput) {
      resolvedChannel = await resolveChannel(channelInput, resolveVideosApiKeys(process.env));
      if (!resolvedChannel) {
        return reply.code(404).send({
          status: 'error',
          code: 'CHANNEL_NOT_FOUND',
          message: 'Could not resolve that channel',
        });
      }
      if (!resolvedChannel.uploadsPlaylistId) {
        return reply.code(422).send({
          status: 'error',
          code: 'CHANNEL_HAS_NO_UPLOADS',
          message: 'That channel exposes no uploads playlist',
        });
      }
    }

    const topic = resolvedChannel
      ? (resolvedChannel.title ?? resolvedChannel.channelId)
      : typeof body.topic === 'string'
        ? body.topic.trim()
        : '';
    if (topic.length < 2) {
      return reply.code(400).send({ status: 'error', code: 'TOPIC_REQUIRED' });
    }
    const source = resolvedChannel
      ? 'youtube_subs'
      : typeof body.source === 'string' && ALLOWED_SOURCES.has(body.source)
        ? body.source
        : 'discover';
    const mandalaId = typeof body.mandalaId === 'string' ? body.mandalaId : null;

    const prisma = getPrismaClient();
    const now = new Date();
    // Dedup (normalized exact match ONLY — trim/lowercase; no similarity matching:
    // two similar-but-different topics stay separate). Re-picking an existing
    // topic returns the existing subscription instead of stacking duplicates.
    const allActive = await prisma.curation_subscriptions.findMany({
      where: { user_id: userId, is_active: true },
      select: { id: true, topic: true, source: true },
    });
    const norm = (s: string) => s.trim().toLowerCase();
    const dup = allActive.find((s) => norm(s.topic) === norm(topic));
    if (dup) {
      // Re-adding the same channel attaches it to the existing row rather than
      // returning a curation that does not actually follow it.
      if (resolvedChannel) {
        await attachChannel(prisma, dup.id, resolvedChannel, 'manual');
      }
      return reply.send({
        status: 'ok',
        data: { id: dup.id, topic: dup.topic, source: dup.source, buildJobId: null },
      });
    }

    // Quota. Counted by DISTINCT normalised topic, never by row: prod holds
    // legacy duplicates (one account has 21 active rows for 5 topics), and a row
    // count would lock those users out on the spot.
    const tier = await resolveCurationTier(prisma, userId);
    const limit = getCurationLimit(tier);
    const distinctTopics = new Set(allActive.map((s) => norm(s.topic))).size;
    if (distinctTopics >= limit) {
      return reply.code(403).send({
        status: 'error',
        code: 'QUOTA_EXCEEDED',
        data: { tier, limit, current: distinctTopics },
      });
    }
    const sub = await prisma.curation_subscriptions.create({
      data: {
        user_id: userId,
        topic,
        cadence: 'weekly',
        source,
        mandala_id: mandalaId,
        is_active: true,
        // recurring weekly refresh starts a week out; the FIRST build runs now.
        next_run_at: new Date(now.getTime() + 7 * MS_PER_DAY),
      },
    });

    // The channel row must exist BEFORE the first build is enqueued: the builder
    // decides between channel and topic mode by whether any channels are
    // followed, so attaching afterwards would make week one a discover week.
    if (resolvedChannel) {
      await attachChannel(prisma, sub.id, resolvedChannel, 'manual');
    }

    // "immediate" — first build enqueued at create time (not waiting for weekly cron).
    const jobId = await enqueueCurationBuild({
      subscriptionId: sub.id,
      weekOf: mondayOf(now),
    });

    // Reinforcement (N1): mark this topic SELECTED in the current week's proposal log
    // if it came from a suggestion. updateMany no-ops when absent (manually typed topic)
    // — the append-only log stays the reinforcement SSOT; nothing mutable to roll back.
    await prisma.curation_proposals.updateMany({
      where: { user_id: userId, week_of: new Date(mondayOf(now)) },
      data: { selected_topic: topic },
    });

    return reply.code(201).send({
      status: 'ok',
      data: { id: sub.id, topic: sub.topic, source: sub.source, buildJobId: jobId },
    });
  });

  /**
   * GET /curations/suggest — personalized 3-topic proposals (interest × trend).
   * Reads the async-built interest profile (never builds inline — B4). If the
   * profile isn't ready, kicks a build off in the background and returns 202.
   */
  fastify.get<{ Querystring: { exclude?: string } }>(
    '/suggest',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      if (!request.user || !('userId' in request.user)) {
        return reply.code(401).send({ status: 'error', code: 'UNAUTHORIZED' });
      }
      const userId = request.user.userId;
      // "re-tune" support: exclude the previously proposed topics and RE-SCORE
      // (client-side filtering would just surface ranks 4-6 without re-scoring).
      const exclude = (request.query.exclude ?? '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const result = await suggestTopics(userId, exclude);
      if (result.status === 'building') {
        // Not connected (no YouTube token) → return empty so the FE shows the connect
        // gate, instead of spinning "analyzing" forever and re-firing a doomed build
        // every poll (P1: getUserSubscriptions throws YOUTUBE_NOT_CONNECTED for token-less users).
        const connected = (await getAccessToken(userId)) !== null;
        if (!connected) {
          return reply.send({ status: 'ok', data: { proposals: [] } });
        }
        await maybeTriggerProfileBuild(userId);
        return reply.code(202).send({ status: 'building' });
      }

      // Log the proposals (dedup by user_id + week_of) — the reinforcement input.
      // Revisits no-op (do NOT overwrite an existing week's proposals/selection).
      const prisma = getPrismaClient();
      const weekOf = new Date(mondayOf(new Date()));
      await prisma.curation_proposals.upsert({
        where: { user_id_week_of: { user_id: userId, week_of: weekOf } },
        create: { user_id: userId, week_of: weekOf, proposed: result.proposals as object },
        update: {},
      });
      return reply.send({ status: 'ok', data: { proposals: result.proposals } });
    }
  );

  /** GET /curations — list the caller's active curations. */
  fastify.get('/', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!request.user || !('userId' in request.user)) {
      return reply.code(401).send({ status: 'error', code: 'UNAUTHORIZED' });
    }
    const prisma = getPrismaClient();
    const rows = await prisma.curation_subscriptions.findMany({
      where: { user_id: request.user.userId, is_active: true },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        topic: true,
        display_title: true,
        source: true,
        weekday: true,
        last_run_at: true,
        next_run_at: true,
      },
    });
    // Display-dedup by normalized topic (newest wins) — legacy duplicate rows stay in
    // the DB untouched (reversible); POST now prevents new ones.
    const seen = new Set<string>();
    const deduped = rows.filter((r) => {
      const k = r.topic.trim().toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    // Latest-week item count + week key per subscription — the row meta
    // (new-N / M-of-N) needs N without N extra item calls.
    const counts = await prisma.curation_items.groupBy({
      by: ['subscription_id', 'week_of'],
      where: { subscription_id: { in: deduped.map((r) => r.id) } },
      _count: { video_id: true },
    });
    const watched = await prisma.curation_items.groupBy({
      by: ['subscription_id', 'week_of'],
      where: { subscription_id: { in: deduped.map((r) => r.id) }, watched_at: { not: null } },
      _count: { video_id: true },
    });
    const watchedBy = new Map(
      watched.map((w) => [
        w.subscription_id + ':' + w.week_of.toISOString().slice(0, 10),
        w._count.video_id,
      ])
    );
    const latest = new Map<string, { week: string; count: number }>();
    for (const c of counts) {
      const wk = c.week_of.toISOString().slice(0, 10);
      const cur = latest.get(c.subscription_id);
      if (!cur || wk > cur.week)
        latest.set(c.subscription_id, { week: wk, count: c._count.video_id });
    }
    const withCounts = deduped.map((r) => {
      const l = latest.get(r.id);
      return {
        ...r,
        week_of: l?.week ?? null,
        item_count: l?.count ?? 0,
        watched_count: l ? (watchedBy.get(r.id + ':' + l.week) ?? 0) : 0,
      };
    });
    return reply.send({ status: 'ok', data: { curations: withCounts } });
  });

  /**
   * GET /curations/:id/channels — the channels this curation follows.
   * Empty for topic-mode curations; the dial uses that to pick which editor to show.
   */
  fastify.get<{ Params: { id: string } }>(
    '/:id/channels',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const owned = await requireOwnedSubscription(request, reply);
      if (!owned) return;
      const prisma = getPrismaClient();
      const channels = await prisma.curation_channels.findMany({
        where: { subscription_id: owned.id },
        orderBy: { created_at: 'asc' },
        select: {
          id: true,
          channel_id: true,
          channel_title: true,
          thumbnail_url: true,
          added_via: true,
          last_seen_at: true,
        },
      });
      const tier = await resolveCurationTier(prisma, owned.userId);
      return reply.send({
        status: 'ok',
        data: { channels, limit: quotaValue(getCurationChannelLimit(tier)), tier },
      });
    }
  );

  /**
   * POST /curations/:id/channels — follow a channel.
   *
   * Two entry points, one route (design §2-a option 3):
   *   { input: "@nomadcoders" | url | UC... }   pasted by hand   -> added_via 'manual'
   *   { channelId: "UC..." }                    picked from subs -> added_via 'picked'
   *
   * Both go through channels.list (1 unit) because the row stores the uploads
   * playlist id from the response rather than deriving UC->UU. Idempotent: a
   * channel already followed returns 200 with the existing row.
   */
  fastify.post<{ Params: { id: string }; Body: { input?: unknown; channelId?: unknown } }>(
    '/:id/channels',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const owned = await requireOwnedSubscription(request, reply);
      if (!owned) return;
      const prisma = getPrismaClient();
      const body = request.body ?? {};
      const pasted = typeof body.input === 'string' ? body.input.trim() : '';
      const picked = typeof body.channelId === 'string' ? body.channelId.trim() : '';
      if (!pasted && !picked) {
        return reply.code(400).send({ status: 'error', code: 'CHANNEL_INPUT_REQUIRED' });
      }

      const tier = await resolveCurationTier(prisma, owned.userId);
      const limit = getCurationChannelLimit(tier);
      const current = await prisma.curation_channels.count({
        where: { subscription_id: owned.id },
      });
      if (current >= limit) {
        return reply.code(403).send({
          status: 'error',
          code: 'CHANNEL_QUOTA_EXCEEDED',
          message: 'Channel limit reached for this plan',
          data: { tier, limit: quotaValue(limit), current },
        });
      }

      const apiKeys = resolveVideosApiKeys(process.env);
      const resolved = picked
        ? (await resolveChannelIds([picked], apiKeys)).get(picked)
        : await resolveChannel(pasted, apiKeys);
      if (!resolved) {
        return reply.code(404).send({
          status: 'error',
          code: 'CHANNEL_NOT_FOUND',
          message: 'Could not resolve that channel',
        });
      }

      // A channel with no uploads playlist cannot be built from — reject at the
      // door rather than storing a row the weekly build silently skips.
      if (!resolved.uploadsPlaylistId) {
        return reply.code(422).send({
          status: 'error',
          code: 'CHANNEL_HAS_NO_UPLOADS',
          message: 'That channel exposes no uploads playlist',
        });
      }

      const row = await attachChannel(prisma, owned.id, resolved, picked ? 'picked' : 'manual');
      return reply.send({ status: 'ok', data: { channel: row } });
    }
  );

  /** DELETE /curations/:id/channels/:channelId — stop following one channel. */
  fastify.delete<{ Params: { id: string; channelId: string } }>(
    '/:id/channels/:channelId',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const owned = await requireOwnedSubscription(request, reply);
      if (!owned) return;
      const prisma = getPrismaClient();
      const removed = await prisma.curation_channels.deleteMany({
        where: { subscription_id: owned.id, channel_id: request.params.channelId },
      });
      if (removed.count === 0) {
        return reply.code(404).send({ status: 'error', code: 'CHANNEL_NOT_FOUND' });
      }
      return reply.send({ status: 'ok', data: { removed: removed.count } });
    }
  );

  /**
   * GET /curations/:id/items?week=YYYY-MM-DD — this curation's weekly video feed
   * (video-only). Defaults to the latest built week. Ownership-checked.
   */
  fastify.get<{ Params: { id: string }; Querystring: { week?: string } }>(
    '/:id/items',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      if (!request.user || !('userId' in request.user)) {
        return reply.code(401).send({ status: 'error', code: 'UNAUTHORIZED' });
      }
      const prisma = getPrismaClient();
      const sub = await prisma.curation_subscriptions.findUnique({
        where: { id: request.params.id },
        select: { user_id: true },
      });
      if (!sub || sub.user_id !== request.user.userId) {
        return reply.code(404).send({ status: 'error', code: 'CURATION_NOT_FOUND' });
      }

      // Resolve the target week: explicit ?week, else the newest built snapshot.
      let weekOf: Date | null = null;
      if (request.query.week) {
        const d = new Date(request.query.week);
        if (!Number.isNaN(d.getTime())) weekOf = d;
      }
      if (!weekOf) {
        const latest = await prisma.curation_items.findFirst({
          where: { subscription_id: request.params.id },
          orderBy: { week_of: 'desc' },
          select: { week_of: true },
        });
        weekOf = latest?.week_of ?? null;
      }
      if (!weekOf) {
        return reply.send({ status: 'ok', data: { week_of: null, items: [] } });
      }

      const items = await prisma.curation_items.findMany({
        where: { subscription_id: request.params.id, week_of: weekOf },
        orderBy: { position: 'asc' },
        select: { video_id: true, relevance_pct: true, position: true },
      });
      // Join pool metadata (title/channel/duration/thumbnail) for the deck UI —
      // items carry only ids; the deck must never fabricate durations (99999 bug).
      const metas = await prisma.video_pool.findMany({
        where: { video_id: { in: items.map((i) => i.video_id) } },
        select: {
          video_id: true,
          title: true,
          channel_name: true,
          duration_seconds: true,
          thumbnail_url: true,
          view_count: true,
        },
      });
      const metaById = new Map(metas.map((m) => [m.video_id, m]));
      const enriched = items.map((i) => {
        const m = metaById.get(i.video_id);
        return {
          ...i,
          title: m?.title ?? null,
          channel: m?.channel_name ?? null,
          duration_sec: m?.duration_seconds ?? null,
          thumbnail: m?.thumbnail_url ?? null,
          views: m?.view_count != null ? Number(m.view_count) : null, // BigInt -> number for the meta line
        };
      });
      return reply.send({
        status: 'ok',
        data: { week_of: weekOf.toISOString().slice(0, 10), items: enriched },
      });
    }
  );

  /**
   * PATCH /curations/:id/items/:videoId/watched — mark this week's item watched
   * (watched_at=now, idempotent: an existing mark is kept). Ownership-checked.
   */
  fastify.patch<{ Params: { id: string; videoId: string } }>(
    '/:id/items/:videoId/watched',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      if (!request.user || !('userId' in request.user)) {
        return reply.code(401).send({ status: 'error', code: 'UNAUTHORIZED' });
      }
      const prisma = getPrismaClient();
      const sub = await prisma.curation_subscriptions.findUnique({
        where: { id: request.params.id },
        select: { user_id: true },
      });
      if (!sub || sub.user_id !== request.user.userId) {
        return reply.code(404).send({ status: 'error', code: 'CURATION_NOT_FOUND' });
      }
      const updated = await prisma.curation_items.updateMany({
        where: {
          subscription_id: request.params.id,
          video_id: request.params.videoId,
          watched_at: null,
        },
        data: { watched_at: new Date() },
      });
      return reply.send({ status: 'ok', data: { marked: updated.count > 0 } });
    }
  );

  /**
   * PATCH /curations/weekday — set the KST delivery day for ALL of the caller's
   * active curations (one dial, not per-topic: "my edition arrives on <day>").
   * next_run_at is display-only under the KST schedule, so it is realigned here
   * to keep the list copy honest.
   */
  fastify.patch<{ Body: { weekday?: unknown } }>(
    '/weekday',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      if (!request.user || !('userId' in request.user)) {
        return reply.code(401).send({ status: 'error', code: 'UNAUTHORIZED' });
      }
      const weekday = (request.body ?? {}).weekday;
      if (!isValidWeekday(weekday)) {
        return reply.code(400).send({ status: 'error', code: 'INVALID_WEEKDAY' });
      }
      const prisma = getPrismaClient();
      const nextRun = nextKstWeekdayAt(
        weekday,
        new Date(),
        QUEUE_CONFIG.CURATION_DELIVERY_HOUR_KST,
        QUEUE_CONFIG.CURATION_DELIVERY_MINUTE_KST
      );
      const updated = await prisma.curation_subscriptions.updateMany({
        where: { user_id: request.user.userId, is_active: true },
        data: { weekday, next_run_at: nextRun },
      });
      return reply.send({
        status: 'ok',
        data: { weekday, updated: updated.count, nextRunAt: nextRun.toISOString() },
      });
    }
  );

  /**
   * PATCH /curations/:id — rename.
   *
   * Writes display_title, never topic. topic doubles as the discover query, so
   * renaming through it would quietly change which videos arrive next week; a
   * rename has to be able to mean only "call it this". An empty string clears
   * the override and the original name comes back.
   */
  fastify.patch<{ Params: { id: string }; Body: { title?: unknown } }>(
    '/:id',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const owned = await requireOwnedSubscription(request, reply);
      if (!owned) return;
      const raw = typeof request.body?.title === 'string' ? request.body.title.trim() : null;
      if (raw === null) {
        return reply.code(400).send({ status: 'error', code: 'TITLE_REQUIRED' });
      }
      if (raw.length > 60) {
        return reply.code(400).send({ status: 'error', code: 'TITLE_TOO_LONG' });
      }
      const prisma = getPrismaClient();
      // Rename every row of a display-deduped topic, or the legacy duplicates
      // keep the old name and it reappears on the next list.
      const sub = await prisma.curation_subscriptions.findUnique({
        where: { id: owned.id },
        select: { topic: true },
      });
      const key = (sub?.topic ?? '').trim().toLowerCase();
      const siblings = await prisma.curation_subscriptions.findMany({
        where: { user_id: owned.userId, is_active: true },
        select: { id: true, topic: true },
      });
      const ids = siblings.filter((x) => x.topic.trim().toLowerCase() === key).map((x) => x.id);
      const updated = await prisma.curation_subscriptions.updateMany({
        where: { id: { in: ids.length ? ids : [owned.id] } },
        data: { display_title: raw.length ? raw : null },
      });
      return reply.send({
        status: 'ok',
        data: { id: owned.id, title: raw.length ? raw : null, updated: updated.count },
      });
    }
  );

  /** DELETE /curations/:id — unsubscribe (is_active=false; reversible, items kept). */
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      if (!request.user || !('userId' in request.user)) {
        return reply.code(401).send({ status: 'error', code: 'UNAUTHORIZED' });
      }
      const prisma = getPrismaClient();
      const sub = await prisma.curation_subscriptions.findUnique({
        where: { id: request.params.id },
        select: { user_id: true, topic: true },
      });
      if (!sub || sub.user_id !== request.user.userId) {
        return reply.code(404).send({ status: 'error', code: 'CURATION_NOT_FOUND' });
      }
      // Unsubscribe the WHOLE curation: deactivate this sub AND every same-topic
      // duplicate. GET display-dedups legacy duplicate rows by normalized topic, so
      // deactivating only the shown id leaves older duplicates active and the topic
      // reappears (looks like it removes one item at a time). Normalized match in JS
      // because the dedup key is trim().toLowerCase() (not expressible in a where).
      const key = sub.topic.trim().toLowerCase();
      const active = await prisma.curation_subscriptions.findMany({
        where: { user_id: request.user.userId, is_active: true },
        select: { id: true, topic: true },
      });
      const ids = active.filter((r) => r.topic.trim().toLowerCase() === key).map((r) => r.id);
      await prisma.curation_subscriptions.updateMany({
        where: { id: { in: ids } },
        data: { is_active: false },
      });
      return reply.send({ status: 'ok', data: { id: request.params.id, deactivated: ids.length } });
    }
  );

  fastify.log.info('curation routes registered');
  done();
};

export default curationRoutes;
