import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../../../modules/database/client';
import { createSuccessResponse } from '../../schemas/common.schema';

export async function adminStatsRoutes(fastify: FastifyInstance) {
  const adminAuth = { onRequest: [fastify.authenticate, fastify.authenticateAdmin] };

  // GET /api/v1/admin/stats/overview
  fastify.get('/overview', adminAuth, async (_request: FastifyRequest, reply: FastifyReply) => {
    const [userStats, tierStats, recentSignups] = await Promise.all([
      // Total users + active (signed in within 30 days)
      db.$queryRaw<Array<{ total: number; active: number }>>`
        SELECT
          COUNT(*)::int as total,
          COUNT(*) FILTER (WHERE last_sign_in_at > NOW() - INTERVAL '30 days')::int as active
        FROM auth.users
      `,
      // Tier distribution
      db.$queryRaw<Array<{ tier: string; count: number }>>`
        SELECT
          COALESCE(s.tier, 'free') as tier,
          COUNT(*)::int as count
        FROM auth.users u
        LEFT JOIN public.user_subscriptions s ON s.user_id = u.id
        GROUP BY COALESCE(s.tier, 'free')
        ORDER BY count DESC
      `,
      // New signups in last 7 days (daily breakdown)
      db.$queryRaw<Array<{ date: string; count: number }>>`
        SELECT
          DATE(created_at)::text as date,
          COUNT(*)::int as count
        FROM auth.users
        WHERE created_at > NOW() - INTERVAL '7 days'
        GROUP BY DATE(created_at)
        ORDER BY date DESC
      `,
    ]);

    // Content stats
    const [contentStats] = await db.$queryRaw<
      Array<{ total_cards: number; total_mandalas: number }>
    >`
      SELECT
        (SELECT COUNT(*)::int FROM public.user_local_cards) as total_cards,
        (SELECT COUNT(*)::int FROM public.user_mandalas) as total_mandalas
    `;

    return reply.send(
      createSuccessResponse({
        users: {
          total: userStats[0]?.total ?? 0,
          active: userStats[0]?.active ?? 0,
        },
        tiers: tierStats,
        recentSignups,
        content: {
          totalCards: contentStats?.total_cards ?? 0,
          totalMandalas: contentStats?.total_mandalas ?? 0,
        },
      })
    );
  });
}
