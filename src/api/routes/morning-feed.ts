/**
 * Morning feed routes (오늘의 픽). Same gate as the morning cards: flag MOBILE_MORNING_CARDS off -> 404;
 * flag on -> 403 unless the account is on the test list. stg only.
 */
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getPrismaClient } from '@/modules/database/client';
import { isMorningCardsEnabled, isMorningCardsTestUser } from '@/config/morning-cards';
import {
  cancelLastFeedJudgment,
  fetchFeed,
  fetchHistory,
  fetchInsight,
  fetchWatchInsight,
  fetchWatchTodayBatches,
  getOrCreateWatchBatch,
  recordWatch,
  FeedValidationError,
  isFeedCell,
  saveFeedJudgment,
  type FeedDb,
} from '@/modules/morning-feed/feed';
import { listPages, readHomePages, readPage, isRealDate } from '@/modules/morning-feed/pages';
import { withAmbient } from '@/modules/morning-feed/thumb-ambient';
import { userIdOf } from '@/api/utils/request-user';

export interface MorningFeedRouteDeps {
  getDb: () => FeedDb;
  /** Adds the immersive-playback background colour to the batch cards (thumbnail, server side). */
  addAmbient?: typeof withAmbient;
}

const defaultDeps: MorningFeedRouteDeps = {
  getDb: () => getPrismaClient(),
  addAmbient: withAmbient,
};

interface JudgmentBody {
  video_id?: unknown;
  cell?: unknown;
  verdict?: unknown;
  shown_position?: unknown;
  /** Optional: 'watch' from the watch screen; the swipe deck sends nothing. */
  surface?: unknown;
}

interface WatchBatchBody {
  cell?: unknown;
}

interface InsightQuery {
  cell?: unknown;
}

interface WatchBody {
  video_id?: unknown;
  watched_seconds?: unknown;
  last_position?: unknown;
}

async function flagGate(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!isMorningCardsEnabled()) {
    return reply.code(404).send({ status: 'error', error: 'not_found' });
  }
}

export function createMorningFeedRoutes(deps: MorningFeedRouteDeps = defaultDeps) {
  return async function morningFeedRoutes(fastify: FastifyInstance): Promise<void> {
    const guard = (request: FastifyRequest, reply: FastifyReply): string | null => {
      const userId = userIdOf(request);
      if (!userId) {
        void reply.code(401).send({ status: 'error', error: 'unauthenticated' });
        return null;
      }
      if (!isMorningCardsTestUser(userId)) {
        void reply.code(403).send({ status: 'error', error: 'forbidden' });
        return null;
      }
      return userId;
    };

    fastify.get('/', { onRequest: [flagGate, fastify.authenticate] }, async (request, reply) => {
      const userId = guard(request, reply);
      if (!userId) return reply;
      const data = await fetchFeed(deps.getDb(), userId);
      return reply.send({ status: 'ok', data });
    });

    fastify.post<{ Body: JudgmentBody }>(
      '/judgments',
      { onRequest: [flagGate, fastify.authenticate] },
      async (request, reply) => {
        const userId = guard(request, reply);
        if (!userId) return reply;
        const body = request.body ?? {};
        try {
          await saveFeedJudgment(deps.getDb(), {
            user_id: userId,
            video_id: String(body.video_id ?? ''),
            cell: String(body.cell ?? ''),
            verdict: String(body.verdict ?? ''),
            shown_position: body.shown_position as number,
            ...(body.surface === undefined ? {} : { surface: body.surface }),
          });
          return reply.code(201).send({ status: 'ok' });
        } catch (err) {
          if (err instanceof FeedValidationError) {
            return reply.code(400).send({ status: 'error', error: 'invalid_judgment' });
          }
          throw err;
        }
      }
    );

    fastify.post<{ Body: WatchBody }>(
      '/watch',
      { onRequest: [flagGate, fastify.authenticate] },
      async (request, reply) => {
        const userId = guard(request, reply);
        if (!userId) return reply;
        const body = request.body ?? {};
        try {
          await recordWatch(deps.getDb(), userId, {
            video_id: String(body.video_id ?? ''),
            watched_seconds: body.watched_seconds as number,
            last_position: body.last_position as number,
          });
          return reply.code(201).send({ status: 'ok' });
        } catch (err) {
          if (err instanceof FeedValidationError) {
            return reply.code(400).send({ status: 'error', error: 'invalid_watch' });
          }
          throw err;
        }
      }
    );

    fastify.get<{ Querystring: InsightQuery }>(
      '/insight',
      { onRequest: [flagGate, fastify.authenticate] },
      async (request, reply) => {
        const userId = guard(request, reply);
        if (!userId) return reply;
        // ?cell=<cell label>: only that goal's judgments (watch screen). Absent = all cells.
        const rawCell: unknown = request.query?.cell;
        let cell: string | undefined;
        if (rawCell !== undefined) {
          if (!isFeedCell(rawCell)) {
            return reply.code(400).send({ status: 'error', error: 'invalid_insight' });
          }
          cell = rawCell;
        }
        try {
          const data = await fetchInsight(
            deps.getDb(),
            userId,
            new Date(),
            cell === undefined ? {} : { cell }
          );
          return reply.send({ status: 'ok', data });
        } catch (err) {
          if (err instanceof FeedValidationError) {
            return reply.code(400).send({ status: 'error', error: 'invalid_insight' });
          }
          throw err;
        }
      }
    );

    // Watch screen: today's batch of one goal (created on first request, then returned as stored)
    fastify.post<{ Body: WatchBatchBody }>(
      '/watch/batch',
      { onRequest: [flagGate, fastify.authenticate] },
      async (request, reply) => {
        const userId = guard(request, reply);
        if (!userId) return reply;
        const cell: unknown = (request.body ?? {}).cell;
        if (!isFeedCell(cell)) {
          return reply.code(400).send({ status: 'error', error: 'invalid_batch' });
        }
        const started = Date.now();
        const batch = await getOrCreateWatchBatch(deps.getDb(), userId, cell, new Date());
        const batchMs = Date.now() - started;
        // the colour is added after the batch is read; the batch itself is not changed
        const items = deps.addAmbient ? await deps.addAmbient(batch.items) : batch.items;
        request.log.info(
          { batchMs, ambientMs: Date.now() - started - batchMs, items: items.length },
          'watch batch timing'
        );
        return reply.send({ status: 'ok', data: { ...batch, items } });
      }
    );

    // Watch screen chips: per goal, today's batch size and answers, or what a new batch would get
    fastify.get(
      '/watch/today',
      { onRequest: [flagGate, fastify.authenticate] },
      async (request, reply) => {
        const userId = guard(request, reply);
        if (!userId) return reply;
        const data = await fetchWatchTodayBatches(deps.getDb(), userId, new Date());
        return reply.send({ status: 'ok', data });
      }
    );

    // Watch screen insight: today's batch of one goal only (the deck's GET /insight is unchanged)
    fastify.get<{ Querystring: InsightQuery }>(
      '/watch/insight',
      { onRequest: [flagGate, fastify.authenticate] },
      async (request, reply) => {
        const userId = guard(request, reply);
        if (!userId) return reply;
        const cell: unknown = request.query?.cell;
        if (!isFeedCell(cell)) {
          return reply.code(400).send({ status: 'error', error: 'invalid_insight' });
        }
        const data = await fetchWatchInsight(deps.getDb(), userId, cell, new Date());
        return reply.send({ status: 'ok', data });
      }
    );

    // 이전 주제: per goal, the latest earlier KST day with a watch batch and that batch's size
    fastify.get(
      '/history',
      { onRequest: [flagGate, fastify.authenticate] },
      async (request, reply) => {
        const userId = guard(request, reply);
        if (!userId) return reply;
        const data = await fetchHistory(deps.getDb(), userId, new Date());
        return reply.send({ status: 'ok', data });
      }
    );

    // Pages: read-only domain pages (imported by script). Home = last domain's page + other domains.
    fastify.get(
      '/pages/home',
      { onRequest: [flagGate, fastify.authenticate] },
      async (request, reply) => {
        const userId = guard(request, reply);
        if (!userId) return reply;
        const data = await readHomePages(deps.getDb(), userId, new Date());
        return reply.send({ status: 'ok', data });
      }
    );

    fastify.get<{ Querystring: { cell?: unknown; date?: unknown } }>(
      '/pages/list',
      { onRequest: [flagGate, fastify.authenticate] },
      async (request, reply) => {
        const userId = guard(request, reply);
        if (!userId) return reply;
        const { cell } = request.query;
        if (!isFeedCell(cell)) {
          return reply.code(400).send({ status: 'error', error: 'invalid_page' });
        }
        const data = await listPages(deps.getDb(), userId, cell);
        return reply.send({ status: 'ok', data });
      }
    );

    fastify.get<{ Querystring: { cell?: unknown; date?: unknown } }>(
      '/pages',
      { onRequest: [flagGate, fastify.authenticate] },
      async (request, reply) => {
        const userId = guard(request, reply);
        if (!userId) return reply;
        const { cell, date } = request.query;
        if (!isFeedCell(cell)) {
          return reply.code(400).send({ status: 'error', error: 'invalid_page' });
        }
        if (!isRealDate(date)) {
          return reply.code(400).send({ status: 'error', error: 'invalid_page' });
        }
        const data = await readPage(deps.getDb(), userId, cell, date);
        return reply.send({ status: 'ok', data });
      }
    );

    fastify.delete(
      '/judgments/last',
      { onRequest: [flagGate, fastify.authenticate] },
      async (request, reply) => {
        const userId = guard(request, reply);
        if (!userId) return reply;
        const canceled = await cancelLastFeedJudgment(deps.getDb(), userId);
        return reply.send({ status: 'ok', data: { canceled } });
      }
    );
  };
}

export const morningFeedRoutes = createMorningFeedRoutes();
