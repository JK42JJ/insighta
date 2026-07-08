import { FastifyPluginCallback } from 'fastify';
import { getPrismaClient } from '../../../modules/database/client';

/** Admin — closed-beta application inbox (invitations are sent manually). */
export const adminBetaApplicationRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.get<{ Querystring: { status?: string } }>(
    '/beta-applications',
    async (request, reply) => {
      const prisma = getPrismaClient();
      const status = request.query.status;
      const applications = await prisma.beta_applications.findMany({
        where: status ? { status } : undefined,
        orderBy: { created_at: 'desc' },
        take: 500,
      });
      return reply.send({ applications, total: applications.length });
    }
  );

  fastify.post<{ Params: { id: string } }>(
    '/beta-applications/:id/mark-invited',
    async (request, reply) => {
      const prisma = getPrismaClient();
      const updated = await prisma.beta_applications.update({
        where: { id: request.params.id },
        data: { status: 'invited', invited_at: new Date() },
      });
      return reply.send({ application: updated });
    }
  );

  done();
};
