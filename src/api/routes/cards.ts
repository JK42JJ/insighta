/**
 * Card Pin / Bookmark Routes (CP457+)
 *
 * REST API endpoints for toggling pin state on grid view cards.
 *
 * Cards in Insighta come from two source tables:
 *   - `user_local_cards`  — user-added / scratchpad / promoted cards
 *   - `user_video_states` — auto-added recommendations (rec_cache → state)
 *
 * Client must pass `source` so we update the correct table. The FE's
 * `InsightCard.sourceTable` field already carries this discriminator.
 *
 * Pin = UX bookmark (save for later) + behavioural signal for ranking.
 * NULL = unpinned, TIMESTAMPTZ = pinned moment. See:
 *   prisma/migrations/pin/001_add_pinned_at.sql (DDL)
 *   prisma/schema.prisma (model fields + partial indexes)
 */

import { FastifyPluginCallback } from 'fastify';
import { getPrismaClient } from '@/modules/database';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'cards-routes' });

type CardSource = 'user_local_cards' | 'user_video_states';

const ALLOWED_SOURCES: ReadonlySet<CardSource> = new Set(['user_local_cards', 'user_video_states']);

export const cardsRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  /**
   * PATCH /api/v1/cards/:id/pin — toggle pin state.
   *
   * Body:
   *   { pinned: boolean, source: 'user_local_cards' | 'user_video_states' }
   *
   * Auth: required (`onRequest: [authenticate]`). UPDATE is scoped by user_id
   *       so a user cannot pin/unpin another user's card even with a valid id.
   *
   * Returns:
   *   200 { status: 'ok', data: { id, pinned, pinnedAt } }
   *   400 INVALID_SOURCE / MISSING_PINNED — body shape issues
   *   404 NOT_FOUND — id+user_id+source row absent
   */
  fastify.patch<{
    Params: { id: string };
    Body: { pinned: boolean; source: CardSource };
  }>('/:id/pin', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!request.user || !('userId' in request.user)) {
      return reply
        .code(401)
        .send({ status: 'error', code: 'UNAUTHORIZED', message: 'Unauthorized' });
    }
    const userId = request.user.userId;
    const { id } = request.params;
    const { pinned, source } =
      request.body ?? ({} as Partial<{ pinned: boolean; source: CardSource }>);

    if (typeof pinned !== 'boolean') {
      return reply.code(400).send({
        status: 'error',
        code: 'MISSING_PINNED',
        message: 'body.pinned must be boolean',
      });
    }
    if (!source || !ALLOWED_SOURCES.has(source)) {
      return reply.code(400).send({
        status: 'error',
        code: 'INVALID_SOURCE',
        message: `body.source must be one of: ${[...ALLOWED_SOURCES].join(', ')}`,
      });
    }

    const pinnedAt = pinned ? new Date() : null;
    const prisma = getPrismaClient();

    try {
      let updatedCount = 0;
      if (source === 'user_local_cards') {
        const result = await prisma.user_local_cards.updateMany({
          where: { id, user_id: userId },
          data: { pinned_at: pinnedAt },
        });
        updatedCount = result.count;
      } else {
        const result = await prisma.userVideoState.updateMany({
          where: { id, user_id: userId },
          data: { pinned_at: pinnedAt },
        });
        updatedCount = result.count;
      }

      if (updatedCount === 0) {
        return reply.code(404).send({
          status: 'error',
          code: 'NOT_FOUND',
          message: `Card ${id} not found in ${source} for this user`,
        });
      }

      return reply.code(200).send({
        status: 'ok',
        data: { id, pinned, pinnedAt: pinnedAt?.toISOString() ?? null, source },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`pin update failed: id=${id} source=${source} pinned=${pinned} err=${msg}`);
      return reply.code(500).send({
        status: 'error',
        code: 'PIN_UPDATE_FAILED',
        message: msg.slice(0, 200),
      });
    }
  });

  done();
};
