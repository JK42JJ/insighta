import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getPrismaClient } from '../../../modules/database/client';
import { sendBetaInviteEmail } from '../../../modules/email/transactional';

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
      // Pre-signup moment: announce the invitation, drive signup with this
      // email, and carry the onboarding guide (internally flag-gated + non-fatal).
      const result = await sendBetaInviteEmail(updated.email, { goal: updated.goal });
      // Record what actually happened. `status` above is written before the send
      // and the send never throws, so without this the row claims an invitation
      // went out even when SMTP refused it or the flag was off.
      const withSend = await prisma.beta_applications.update({
        where: { id: request.params.id },
        data: {
          invite_email_status: result.status,
          invite_email_at: new Date(),
          invite_email_error: result.status === 'failed' ? result.error.slice(0, 500) : null,
        },
      });
      return reply.send({ application: withSend });
    }
  );
}
