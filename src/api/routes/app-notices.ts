/**
 * In-app notices (새소식) — public read feed for the dial mobile player
 * (2026-07-15, Stage 1 of 공지/새소식 전달; Stage 2 = Web Push, separate
 * design). Publishing is admin-only (src/api/routes/admin/notices.ts).
 *
 * Unread state is client-side: the player stores the newest published_at
 * it has shown and compares against this feed.
 */

import { FastifyInstance } from 'fastify';
import { getPrismaClient } from '@/modules/database/client';

const MAX_NOTICES = 20;

/** Pure clamp for the public feed's limit param — unit-tested. */
export function clampNoticeLimit(raw: unknown): number {
  const n = Number(raw ?? MAX_NOTICES);
  return Number.isFinite(n) ? Math.min(Math.max(1, Math.trunc(n)), MAX_NOTICES) : MAX_NOTICES;
}

export async function appNoticeRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Querystring: { limit?: string } }>('/', async (request, reply) => {
    const limit = clampNoticeLimit(request.query.limit);

    const rows = await getPrismaClient().app_notices.findMany({
      orderBy: { published_at: 'desc' },
      take: limit,
      select: {
        id: true,
        title: true,
        body: true,
        published_at: true,
        kind: true,
        event_at: true,
        cta_label: true,
        cta_url: true,
      },
    });
    return reply
      .header('Cache-Control', 'public, max-age=60')
      .send({ status: 'ok', data: { notices: rows } });
  });
}
