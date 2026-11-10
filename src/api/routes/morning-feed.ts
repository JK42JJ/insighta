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
  fetchInsight,
  recordWatch,
  FeedValidationError,
  isFeedCell,
  saveFeedJudgment,
  type FeedDb,
} from '@/modules/morning-feed/feed';
import { userIdOf } from '@/api/utils/request-user';

export interface MorningFeedRouteDeps {
  getDb: () => FeedDb;
}

const defaultDeps: MorningFeedRouteDeps = {
  getDb: () => getPrismaClient(),
};

interface JudgmentBody {
  video_id?: unknown;
  cell?: unknown;
  verdict?: unknown;
  shown_position?: unknown;
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
