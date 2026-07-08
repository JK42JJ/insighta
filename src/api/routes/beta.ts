import { FastifyPluginCallback } from 'fastify';
import { getPrismaClient } from '../../modules/database/client';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const EMAIL_MAX_LENGTH = 255;

/** Normalize an applicant email for idempotent storage. */
export function normalizeBetaEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (!email || email.length > EMAIL_MAX_LENGTH || !EMAIL_RE.test(email)) return null;
  return email;
}

/**
 * Public closed-beta application endpoint. Stores the applicant email;
 * invitations are sent manually by the operator. Idempotent on duplicates
 * and never leaks whether an email was already registered.
 */
export const betaRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post<{ Body: { email?: string; goal?: string } }>(
    '/apply',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const email = normalizeBetaEmail(request.body?.email);
      if (!email) {
        return reply
          .code(400)
          .send({ status: 400, code: 'INVALID_EMAIL', message: 'A valid email is required' });
      }

      const goal =
        typeof request.body?.goal === 'string'
          ? request.body.goal.trim().slice(0, 500) || null
          : null;

      const prisma = getPrismaClient();
      await prisma.beta_applications.upsert({
        where: { email },
        create: { email, goal },
        update: goal ? { goal } : {}, // re-apply may refine the goal; otherwise no-op
      });

      return reply.send({ ok: true });
    }
  );

  done();
};
