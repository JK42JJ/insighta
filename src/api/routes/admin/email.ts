import { FastifyInstance } from 'fastify';
import { sendMobileGuideEmail } from '@/modules/email/transactional';

/**
 * Admin — one-off email sampling. SAMPLE-ONLY by design: the recipient must be
 * an owner address, so this endpoint can never reach a real user, and there is
 * intentionally NO broadcast/all-users path here (a mass send is irreversible —
 * it gets its own carefully-gated endpoint when built). Admin-gated per the
 * new-admin-route auth rule.
 */
const OWNER_ALLOWLIST = new Set([
  'jkim0420@gmail.com',
  'jamesjk4242@gmail.com',
  'support@insighta.one',
]);

export async function adminEmailRoutes(fastify: FastifyInstance) {
  const adminAuth = { onRequest: [fastify.authenticate, fastify.authenticateAdmin] };

  // POST /api/v1/admin/email/mobile-guide-sample — send the mobile-guide email to
  // an OWNER address only, to verify copy/design before any broadcast.
  fastify.post<{ Body: { to?: string } }>(
    '/email/mobile-guide-sample',
    adminAuth,
    async (request, reply) => {
      const to = String(request.body?.to ?? '')
        .trim()
        .toLowerCase();
      if (!OWNER_ALLOWLIST.has(to)) {
        return reply
          .code(400)
          .send({ status: 'error', error: 'sample recipient must be an owner address' });
      }
      await sendMobileGuideEmail(to);
      return reply.code(200).send({ status: 'ok', data: { sent: to } });
    }
  );
}
