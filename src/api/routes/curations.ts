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

/** ISO date (YYYY-MM-DD) of this week's Monday — curation_items.week_of key. */
function mondayOf(d: Date): string {
  const day = d.getUTCDay();
  const diff = (day === 0 ? -6 : 1) - day;
  const mon = new Date(d);
  mon.setUTCDate(d.getUTCDate() + diff);
  return mon.toISOString().slice(0, 10);
}

const ALLOWED_SOURCES = new Set(['discover', 'youtube_subs', 'hybrid']);

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
    };
    const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
    if (topic.length < 2) {
      return reply.code(400).send({ status: 'error', code: 'TOPIC_REQUIRED' });
    }
    const source =
      typeof body.source === 'string' && ALLOWED_SOURCES.has(body.source)
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
      return reply.send({
        status: 'ok',
        data: { id: dup.id, topic: dup.topic, source: dup.source, buildJobId: null },
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
      select: { id: true, topic: true, source: true, last_run_at: true, next_run_at: true },
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
    const latest = new Map<string, { week: string; count: number }>();
    for (const c of counts) {
      const wk = c.week_of.toISOString().slice(0, 10);
      const cur = latest.get(c.subscription_id);
      if (!cur || wk > cur.week) latest.set(c.subscription_id, { week: wk, count: c._count.video_id });
    }
    const withCounts = deduped.map((r) => ({
      ...r,
      week_of: latest.get(r.id)?.week ?? null,
      item_count: latest.get(r.id)?.count ?? 0,
    }));
    return reply.send({ status: 'ok', data: { curations: withCounts } });
  });

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
        };
      });
      return reply.send({
        status: 'ok',
        data: { week_of: weekOf.toISOString().slice(0, 10), items: enriched },
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
        select: { user_id: true },
      });
      if (!sub || sub.user_id !== request.user.userId) {
        return reply.code(404).send({ status: 'error', code: 'CURATION_NOT_FOUND' });
      }
      await prisma.curation_subscriptions.update({
        where: { id: request.params.id },
        data: { is_active: false },
      });
      return reply.send({ status: 'ok', data: { id: request.params.id } });
    }
  );

  fastify.log.info('curation routes registered');
  done();
};

export default curationRoutes;
