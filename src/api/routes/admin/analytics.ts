import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../../../modules/database/client';
import { createSuccessResponse } from '../../schemas/common.schema';

const DateRangeSchema = z.object({
  days: z.coerce.number().int().min(7).max(365).optional().default(30),
});

export async function adminAnalyticsRoutes(fastify: FastifyInstance) {
  const adminAuth = { onRequest: [fastify.authenticate, fastify.authenticateAdmin] };

  // GET /api/v1/admin/analytics/users — DAU/WAU/MAU time series
  fastify.get('/users', adminAuth, async (request: FastifyRequest, reply: FastifyReply) => {
    const { days } = DateRangeSchema.parse(request.query);

    const [dau, wau, mau] = await Promise.all([
      // Daily Active Users (last N days)
      db.$queryRawUnsafe<Array<{ date: string; count: number }>>(
        `SELECT DATE(last_sign_in_at)::text as date, COUNT(DISTINCT id)::int as count
         FROM auth.users
         WHERE last_sign_in_at > NOW() - INTERVAL '1 day' * $1
         GROUP BY DATE(last_sign_in_at)
         ORDER BY date`,
        days
      ),
      // Weekly Active Users (weekly buckets)
      db.$queryRawUnsafe<Array<{ week: string; count: number }>>(
        `SELECT DATE_TRUNC('week', last_sign_in_at)::date::text as week, COUNT(DISTINCT id)::int as count
         FROM auth.users
         WHERE last_sign_in_at > NOW() - INTERVAL '1 day' * $1
         GROUP BY DATE_TRUNC('week', last_sign_in_at)
         ORDER BY week`,
        days
      ),
      // Monthly Active Users
      db.$queryRawUnsafe<Array<{ month: string; count: number }>>(
        `SELECT TO_CHAR(last_sign_in_at, 'YYYY-MM') as month, COUNT(DISTINCT id)::int as count
         FROM auth.users
         WHERE last_sign_in_at > NOW() - INTERVAL '1 day' * $1
         GROUP BY TO_CHAR(last_sign_in_at, 'YYYY-MM')
         ORDER BY month`,
        days
      ),
    ]);

    return reply.send(createSuccessResponse({ dau, wau, mau }));
  });

  // GET /api/v1/admin/analytics/growth — signup/churn trends
  fastify.get('/growth', adminAuth, async (request: FastifyRequest, reply: FastifyReply) => {
    const { days } = DateRangeSchema.parse(request.query);

    const signups = await db.$queryRawUnsafe<Array<{ date: string; count: number }>>(
      `SELECT DATE(created_at)::text as date, COUNT(*)::int as count
       FROM auth.users
       WHERE created_at > NOW() - INTERVAL '1 day' * $1
       GROUP BY DATE(created_at)
       ORDER BY date`,
      days
    );

    const totalUsers = await db.$queryRaw<Array<{ total: number }>>`
      SELECT COUNT(*)::int as total FROM auth.users
    `;

    return reply.send(createSuccessResponse({
      signups,
      totalUsers: totalUsers[0]?.total ?? 0,
    }));
  });

  // GET /api/v1/admin/analytics/retention — cohort retention matrix
  fastify.get('/retention', adminAuth, async (_request: FastifyRequest, reply: FastifyReply) => {
    // Simplified cohort: signup week → % still active in following weeks
    const cohorts = await db.$queryRaw<Array<Record<string, unknown>>>`
      WITH cohort AS (
        SELECT
          id,
          DATE_TRUNC('week', created_at)::date as signup_week,
          DATE_TRUNC('week', last_sign_in_at)::date as last_active_week
        FROM auth.users
        WHERE created_at > NOW() - INTERVAL '12 weeks'
      ),
      cohort_sizes AS (
        SELECT signup_week, COUNT(*)::int as cohort_size
        FROM cohort GROUP BY signup_week
      ),
      retention AS (
        SELECT
          c.signup_week::text,
          EXTRACT(WEEK FROM c.last_active_week - c.signup_week)::int as weeks_after,
          COUNT(DISTINCT c.id)::int as retained
        FROM cohort c
        WHERE c.last_active_week >= c.signup_week
        GROUP BY c.signup_week, weeks_after
      )
      SELECT
        r.signup_week,
        cs.cohort_size,
        r.weeks_after,
        r.retained,
        ROUND(r.retained::numeric / cs.cohort_size * 100, 1) as retention_pct
      FROM retention r
      JOIN cohort_sizes cs ON cs.signup_week::text = r.signup_week
      ORDER BY r.signup_week, r.weeks_after
    `;

    return reply.send(createSuccessResponse({ cohorts }));
  });

  // GET /api/v1/admin/analytics/revenue — MRR, transaction summary (Stripe placeholder)
  fastify.get('/revenue', adminAuth, async (_request: FastifyRequest, reply: FastifyReply) => {
    const transactions = await db.$queryRaw<Array<Record<string, unknown>>>`
      SELECT
        TO_CHAR(created_at, 'YYYY-MM') as month,
        SUM(amount)::int as total_cents,
        COUNT(*)::int as tx_count,
        COUNT(*) FILTER (WHERE status = 'succeeded')::int as succeeded,
        COUNT(*) FILTER (WHERE status = 'failed')::int as failed
      FROM public.payment_transactions
      GROUP BY TO_CHAR(created_at, 'YYYY-MM')
      ORDER BY month DESC
      LIMIT 12
    `;

    const mrr = await db.$queryRaw<Array<{ mrr: number }>>`
      SELECT COALESCE(SUM(amount), 0)::int as mrr
      FROM public.payment_transactions
      WHERE status = 'succeeded'
        AND created_at > DATE_TRUNC('month', NOW())
    `;

    const subscriberCount = await db.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int as count
      FROM public.user_subscriptions
      WHERE stripe_subscription_id IS NOT NULL
        AND (current_period_end IS NULL OR current_period_end > NOW())
    `;

    return reply.send(createSuccessResponse({
      mrr: mrr[0]?.mrr ?? 0,
      subscribers: subscriberCount[0]?.count ?? 0,
      monthlyBreakdown: transactions,
    }));
  });
}
