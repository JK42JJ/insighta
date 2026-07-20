/**
 * Curation API routes (Growth Hub, 2026-07-16).
 *
 * A curation = weekly topic subscription that builds a relevance-ordered video
 * feed (NO note/book_json). Create → enqueue an immediate build ("immediate", James)
 * plus the recurring weekly job refreshes it.
 *
 * NOTE: the build worker's source selection is still a scaffold — creating a
 * curation persists the subscription and enqueues a build, but the build's
 * discover source (topic → videos, mandala-independent) is D5-pending. The
 * subscription/list endpoints below are complete and safe to ship behind the
 * Growth Hub flag; the build fills in once the source path lands.
 */

import { FastifyPluginCallback } from 'fastify';
import { getPrismaClient } from '../../modules/database';
import { enqueueCurationBuild } from '../../modules/queue/handlers/curation-build';

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
    const sub = await prisma.curation_subscriptions.create({
      data: {
        user_id: userId,
        topic,
        cadence: 'weekly',
        source,
        mandala_id: mandalaId,
        is_active: true,
        // recurring weekly refresh starts a week out; the FIRST build runs now.
        next_run_at: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    // "immediate" — first build enqueued at create time (not waiting for weekly cron).
    const jobId = await enqueueCurationBuild({
      subscriptionId: sub.id,
      weekOf: mondayOf(now),
    });

    return reply.code(201).send({
      status: 'ok',
      data: { id: sub.id, topic: sub.topic, source: sub.source, buildJobId: jobId },
    });
  });

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
    return reply.send({ status: 'ok', data: { curations: rows } });
  });

  fastify.log.info('curation routes registered');
  done();
};

export default curationRoutes;
