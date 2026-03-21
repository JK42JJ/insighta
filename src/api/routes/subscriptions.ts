/**
 * Subscription API Routes
 *
 * REST API endpoints for mandala subscription graph updates.
 * Used by OpenClaw insighta-subscription skill.
 */

import { FastifyPluginCallback } from 'fastify';
import { getPrismaClient } from '../../modules/database';

const RECENT_UPDATES_DAYS = 7;

export const subscriptionRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  /**
   * GET /api/v1/subscriptions/updates - Get recent updates from subscribed mandalas
   */
  fastify.get(
    '/updates',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      if (!request.user || !('userId' in request.user)) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      const userId = request.user.userId;
      const prisma = getPrismaClient();
      const since = new Date(Date.now() - RECENT_UPDATES_DAYS * 24 * 60 * 60 * 1000);

      const subscriptions = await prisma.mandala_subscriptions.findMany({
        where: { subscriber_id: userId },
        select: {
          mandala: {
            select: {
              id: true,
              title: true,
              user_id: true,
              users: { select: { raw_user_meta_data: true } },
            },
          },
        },
      });

      const updates = await Promise.all(
        subscriptions.map(async (sub) => {
          const mandala = sub.mandala;
          const ownerMeta = mandala.users?.raw_user_meta_data;
          const meta = ownerMeta && typeof ownerMeta === 'object' && !Array.isArray(ownerMeta)
            ? (ownerMeta as Record<string, unknown>)
            : null;
          const ownerName = String(meta?.['full_name'] ?? meta?.['name'] ?? 'Unknown');

          const recentCards = await prisma.user_local_cards.findMany({
            where: {
              mandala_id: mandala.id,
              user_id: mandala.user_id,
              created_at: { gte: since },
            },
            select: {
              title: true,
              link_type: true,
              metadata_title: true,
            },
            orderBy: { created_at: 'desc' },
            take: 10,
          });

          if (recentCards.length === 0) return null;

          const newInsights = recentCards.map((card) => ({
            title: card.title || card.metadata_title || 'Untitled',
            basedOn: card.link_type,
          }));

          return {
            subscriberName: ownerName,
            mandalaName: mandala.title,
            newInsights,
          };
        }),
      );

      return reply.send({ updates: updates.filter(Boolean) });
    },
  );

  fastify.log.info('Subscription routes registered');
  done();
};

export default subscriptionRoutes;
