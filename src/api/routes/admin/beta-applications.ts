import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getPrismaClient } from '../../../modules/database/client';

/**
 * Admin — closed-beta application inbox (invitations are sent manually).
 * Every route is admin-gated: applicant emails + goals are PII and must never
 * be served without authentication.
 */
export async function adminBetaApplicationRoutes(fastify: FastifyInstance) {
  const adminAuth = { onRequest: [fastify.authenticate, fastify.authenticateAdmin] };

  fastify.get<{ Querystring: { status?: string } }>(
    '/beta-applications',
    adminAuth,
    async (request: FastifyRequest<{ Querystring: { status?: string } }>, reply: FastifyReply) => {
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
    adminAuth,
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const prisma = getPrismaClient();
      const updated = await prisma.beta_applications.update({
        where: { id: request.params.id },
        data: { status: 'invited', invited_at: new Date() },
      });
      return reply.send({ application: updated });
    }
  );
}
