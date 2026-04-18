import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Prisma } from '@prisma/client';
import { db } from '@/modules/database/client';
import { createSuccessResponse } from '../../schemas/common.schema';
import { MS_PER_DAY } from '@/utils/time-constants';

const DEFAULT_ACTIVITY_RANGE_DAYS = 6;

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

    // Content stats + KPI
    const [contentStats] = await db.$queryRaw<
      Array<{
        total_cards: number;
        total_mandalas: number;
        total_notes: number;
        total_summaries: number;
        total_synced_cards: number;
        total_synced_playlists: number;
        summaries_today: number;
        summaries_week: number;
      }>
    >`
      SELECT
        (SELECT COUNT(*)::int FROM public.user_local_cards) as total_cards,
        (SELECT COUNT(*)::int FROM public.user_mandalas) as total_mandalas,
        (SELECT COUNT(*)::int FROM public.user_local_cards WHERE user_note IS NOT NULL AND user_note != '') as total_notes,
        (SELECT COUNT(*)::int FROM public.video_summaries) as total_summaries,
        (SELECT COUNT(*)::int FROM public.user_video_states) as total_synced_cards,
        (SELECT COUNT(*)::int FROM public.youtube_playlists) as total_synced_playlists,
        (SELECT COUNT(*)::int FROM public.video_summaries WHERE created_at > NOW() - INTERVAL '1 day') as summaries_today,
        (SELECT COUNT(*)::int FROM public.video_summaries WHERE created_at > NOW() - INTERVAL '7 days') as summaries_week
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
        kpi: {
          totalNotes: contentStats?.total_notes ?? 0,
          totalSummaries: contentStats?.total_summaries ?? 0,
          totalSyncedCards: contentStats?.total_synced_cards ?? 0,
          totalSyncedPlaylists: contentStats?.total_synced_playlists ?? 0,
          summariesToday: contentStats?.summaries_today ?? 0,
          summariesWeek: contentStats?.summaries_week ?? 0,
        },
      })
    );
  });

  // GET /api/v1/admin/stats/activity — Daily activity aggregation with date range & user filter
  fastify.get('/activity', adminAuth, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as { from?: string; to?: string; user_id?: string };

    const now = new Date();
    const toDate = query.to || now.toISOString().slice(0, 10);
    const fromDate =
      query.from ||
      new Date(now.getTime() - DEFAULT_ACTIVITY_RANGE_DAYS * MS_PER_DAY).toISOString().slice(0, 10);
    const userId = query.user_id || null;

    const rows = await db.$queryRaw<
      Array<{
        date: string;
        logins: number;
        cards_created: number;
        notes_written: number;
        ai_summaries: number;
        mandala_actions: number;
      }>
    >(
      userId
        ? Prisma.sql`
            SELECT
              d.date::text,
              COALESCE(logins.cnt, 0)::int as logins,
              COALESCE(cards.cnt, 0)::int as cards_created,
              COALESCE(notes.cnt, 0)::int as notes_written,
              COALESCE(summaries.cnt, 0)::int as ai_summaries,
              COALESCE(mandala_acts.cnt, 0)::int as mandala_actions
            FROM generate_series(${fromDate}::date, ${toDate}::date, '1 day'::interval) AS d(date)
            LEFT JOIN (
              SELECT DATE(created_at) as date, COUNT(*)::int as cnt
              FROM auth.sessions WHERE created_at BETWEEN ${fromDate}::date AND ${toDate}::date + 1
                AND user_id = ${userId}::uuid
              GROUP BY DATE(created_at)
            ) logins ON logins.date = d.date
            LEFT JOIN (
              SELECT DATE(created_at) as date, COUNT(*)::int as cnt
              FROM public.user_local_cards WHERE created_at BETWEEN ${fromDate}::date AND ${toDate}::date + 1
                AND user_id = ${userId}::uuid
              GROUP BY DATE(created_at)
            ) cards ON cards.date = d.date
            LEFT JOIN (
              SELECT DATE(updated_at) as date, COUNT(*)::int as cnt
              FROM public.user_local_cards WHERE user_note IS NOT NULL AND user_note != ''
                AND updated_at BETWEEN ${fromDate}::date AND ${toDate}::date + 1
                AND user_id = ${userId}::uuid
              GROUP BY DATE(updated_at)
            ) notes ON notes.date = d.date
            LEFT JOIN (
              SELECT DATE(created_at) as date, COUNT(*)::int as cnt
              FROM public.video_summaries WHERE created_at BETWEEN ${fromDate}::date AND ${toDate}::date + 1
              GROUP BY DATE(created_at)
            ) summaries ON summaries.date = d.date
            LEFT JOIN (
              SELECT DATE(created_at) as date, COUNT(*)::int as cnt
              FROM public.mandala_activity_log WHERE created_at BETWEEN ${fromDate}::date AND ${toDate}::date + 1
                AND user_id = ${userId}::uuid
              GROUP BY DATE(created_at)
            ) mandala_acts ON mandala_acts.date = d.date
            ORDER BY d.date ASC
          `
        : Prisma.sql`
            SELECT
              d.date::text,
              COALESCE(logins.cnt, 0)::int as logins,
              COALESCE(cards.cnt, 0)::int as cards_created,
              COALESCE(notes.cnt, 0)::int as notes_written,
              COALESCE(summaries.cnt, 0)::int as ai_summaries,
              COALESCE(mandala_acts.cnt, 0)::int as mandala_actions
            FROM generate_series(${fromDate}::date, ${toDate}::date, '1 day'::interval) AS d(date)
            LEFT JOIN (
              SELECT DATE(created_at) as date, COUNT(*)::int as cnt
              FROM auth.sessions WHERE created_at BETWEEN ${fromDate}::date AND ${toDate}::date + 1
              GROUP BY DATE(created_at)
            ) logins ON logins.date = d.date
            LEFT JOIN (
              SELECT DATE(created_at) as date, COUNT(*)::int as cnt
              FROM public.user_local_cards WHERE created_at BETWEEN ${fromDate}::date AND ${toDate}::date + 1
              GROUP BY DATE(created_at)
            ) cards ON cards.date = d.date
            LEFT JOIN (
              SELECT DATE(updated_at) as date, COUNT(*)::int as cnt
              FROM public.user_local_cards WHERE user_note IS NOT NULL AND user_note != ''
                AND updated_at BETWEEN ${fromDate}::date AND ${toDate}::date + 1
              GROUP BY DATE(updated_at)
            ) notes ON notes.date = d.date
            LEFT JOIN (
              SELECT DATE(created_at) as date, COUNT(*)::int as cnt
              FROM public.video_summaries WHERE created_at BETWEEN ${fromDate}::date AND ${toDate}::date + 1
              GROUP BY DATE(created_at)
            ) summaries ON summaries.date = d.date
            LEFT JOIN (
              SELECT DATE(created_at) as date, COUNT(*)::int as cnt
              FROM public.mandala_activity_log WHERE created_at BETWEEN ${fromDate}::date AND ${toDate}::date + 1
              GROUP BY DATE(created_at)
            ) mandala_acts ON mandala_acts.date = d.date
            ORDER BY d.date ASC
          `
    );

    return reply.send(
      createSuccessResponse(
        rows.map((r) => ({
          date: r.date,
          logins: r.logins,
          cardsCreated: r.cards_created,
          notesWritten: r.notes_written,
          aiSummaries: r.ai_summaries,
          mandalaActions: r.mandala_actions,
        }))
      )
    );
  });

  // GET /api/v1/admin/stats/summary-coverage — Summary coverage KPI
  fastify.get(
    '/summary-coverage',
    adminAuth,
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const [coverage] = await db.$queryRaw<
        Array<{
          total_cards: number;
          summary_total: number;
          summary_caption: number;
          summary_metadata: number;
          summary_pending: number;
          rich_summary_total: number;
          rich_summary_pass: number;
          rich_summary_low: number;
          rich_summary_failed: number;
          avg_quality_caption: number | null;
          avg_quality_metadata: number | null;
          quality_good: number;
          quality_needs_review: number;
          quality_poor: number;
        }>
      >`
        WITH card_videos AS (
          SELECT DISTINCT video_id AS vid FROM public.user_local_cards
          WHERE video_id IS NOT NULL AND link_type IN ('youtube', 'youtube-shorts')
        ),
        summary_stats AS (
          SELECT
            COUNT(*)::int AS summary_total,
            COUNT(*) FILTER (WHERE model != 'metadata-enriched')::int AS summary_caption,
            COUNT(*) FILTER (WHERE model = 'metadata-enriched')::int AS summary_metadata
          FROM public.video_summaries
          WHERE summary_en IS NOT NULL
        ),
        rich_stats AS (
          SELECT
            COUNT(*)::int AS rich_total,
            COUNT(*) FILTER (WHERE quality_flag = 'pass')::int AS rich_pass,
            COUNT(*) FILTER (WHERE quality_flag = 'low')::int AS rich_low,
            COUNT(*) FILTER (WHERE quality_flag = 'failed')::int AS rich_failed,
            ROUND(AVG(quality_score) FILTER (WHERE quality_flag = 'pass')::numeric, 2) AS avg_quality_all,
            COUNT(*) FILTER (WHERE quality_score >= 0.7)::int AS quality_good,
            COUNT(*) FILTER (WHERE quality_score >= 0.4 AND quality_score < 0.7)::int AS quality_needs_review,
            COUNT(*) FILTER (WHERE quality_score < 0.4 OR quality_score IS NULL)::int AS quality_poor
          FROM public.video_rich_summaries
        ),
        quality_by_source AS (
          SELECT
            ROUND(AVG(vrs.quality_score) FILTER (WHERE vs.model != 'metadata-enriched')::numeric, 2) AS avg_q_caption,
            ROUND(AVG(vrs.quality_score) FILTER (WHERE vs.model = 'metadata-enriched')::numeric, 2) AS avg_q_metadata
          FROM public.video_rich_summaries vrs
          LEFT JOIN public.video_summaries vs ON vs.video_id = vrs.video_id
          WHERE vrs.quality_score IS NOT NULL
        )
        SELECT
          (SELECT COUNT(*)::int FROM card_videos) AS total_cards,
          ss.summary_total,
          ss.summary_caption,
          ss.summary_metadata,
          (SELECT COUNT(*)::int FROM card_videos) - ss.summary_total AS summary_pending,
          rs.rich_total AS rich_summary_total,
          rs.rich_pass AS rich_summary_pass,
          rs.rich_low AS rich_summary_low,
          rs.rich_failed AS rich_summary_failed,
          qbs.avg_q_caption AS avg_quality_caption,
          qbs.avg_q_metadata AS avg_quality_metadata,
          rs.quality_good,
          rs.quality_needs_review,
          rs.quality_poor
        FROM summary_stats ss, rich_stats rs, quality_by_source qbs
      `;

      const c = coverage!;
      const totalCards = c.total_cards || 0;
      const summaryTotal = c.summary_total || 0;
      const coveragePct = totalCards > 0 ? Math.round((summaryTotal / totalCards) * 1000) / 10 : 0;
      const richTotal = c.rich_summary_total || 0;
      const richPct = totalCards > 0 ? Math.round((richTotal / totalCards) * 1000) / 10 : 0;

      return reply.send(
        createSuccessResponse({
          totalCards,
          summaryCoverage: {
            total: summaryTotal,
            percentage: coveragePct,
            captionBased: c.summary_caption || 0,
            metadataEnriched: c.summary_metadata || 0,
            pending: c.summary_pending || 0,
          },
          richSummaryCoverage: {
            total: richTotal,
            percentage: richPct,
            pass: c.rich_summary_pass || 0,
            low: c.rich_summary_low || 0,
            failed: c.rich_summary_failed || 0,
          },
          quality: {
            avgCaptionBased: c.avg_quality_caption ?? null,
            avgMetadataEnriched: c.avg_quality_metadata ?? null,
            distribution: {
              good: c.quality_good || 0,
              needsReview: c.quality_needs_review || 0,
              poor: c.quality_poor || 0,
            },
          },
        })
      );
    }
  );
}
