import { FastifyPluginCallback } from 'fastify';
import { getPrismaClient } from '../../modules/database/client';
import {
  getSetting,
  SETTING_KEYS,
  BETA_DEFAULTS,
  type BetaSignupMode,
  type BetaPhase,
  type BetaWindow,
} from '../../modules/system-settings';

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

  /**
   * Public beta config — drives the /beta countdown and the /login signup gate.
   * Non-sensitive; safe to expose unauthenticated.
   */
  fastify.get('/config', async (_request, reply) => {
    const [signupMode, phase, window] = await Promise.all([
      getSetting<BetaSignupMode>(SETTING_KEYS.BETA_SIGNUP_MODE, BETA_DEFAULTS.signupMode),
      getSetting<BetaPhase>(SETTING_KEYS.BETA_PHASE, BETA_DEFAULTS.phase),
      getSetting<BetaWindow>(SETTING_KEYS.BETA_WINDOW, BETA_DEFAULTS.window),
    ]);
    return reply.send({ signupMode, phase, window });
  });

  /**
   * Invite check for the signup gate. Returns whether an email may sign up
   * under the current mode. Never reveals application status beyond the
   * boolean needed to gate signup.
   */
  fastify.post<{ Body: { email?: string } }>(
    '/check-invite',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const signupMode = await getSetting<BetaSignupMode>(
        SETTING_KEYS.BETA_SIGNUP_MODE,
        BETA_DEFAULTS.signupMode
      );
      if (signupMode === 'open') {
        return reply.send({ allowed: true, mode: signupMode });
      }
      if (signupMode === 'closed') {
        return reply.send({ allowed: false, mode: signupMode });
      }
      // invite_only — allowed iff the email was invited (or already joined).
      const email = normalizeBetaEmail(request.body?.email);
      if (!email) {
        return reply.send({ allowed: false, mode: signupMode });
      }
      const prisma = getPrismaClient();
      const app = await prisma.beta_applications.findUnique({ where: { email } });
      const allowed = app?.status === 'invited' || app?.status === 'joined';
      return reply.send({ allowed, mode: signupMode });
    }
  );

  done();
};
