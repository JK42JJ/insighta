import { FastifyInstance } from 'fastify';
import { getPrismaClient } from '../../../modules/database/client';

/**
 * Admin — publish/delete in-app notices (새소식) shown in the dial mobile
 * player. Admin-gated per the hard rule for new admin routes.
 */
export async function adminNoticeRoutes(fastify: FastifyInstance) {
  const adminAuth = { onRequest: [fastify.authenticate, fastify.authenticateAdmin] };

  fastify.post<{ Body: { title?: string; body?: string } }>(
    '/notices',
    adminAuth,
    async (request, reply) => {
      const { title, body } = request.body ?? {};
      if (!title?.trim() || title.length > 120 || !body?.trim()) {
        return reply.code(400).send({ status: 'error', error: 'title (≤120) and body required' });
      }
      const row = await getPrismaClient().app_notices.create({
        data: { title: title.trim(), body: body.trim() },
      });
      return reply
        .code(200)
        .send({ status: 'ok', data: { id: row.id, publishedAt: row.published_at } });
    }
  );

  fastify.delete<{ Params: { id: string } }>('/notices/:id', adminAuth, async (request, reply) => {
    const { id } = request.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return reply.code(400).send({ status: 'error', error: 'invalid id' });
    }
    await getPrismaClient().app_notices.deleteMany({ where: { id } });
    return reply.code(200).send({ status: 'ok' });
  });
}
