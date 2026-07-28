import { FastifyInstance } from 'fastify';
import { sendMobileGuideEmail } from '@/modules/email/transactional';
import { planBroadcast, runBroadcast } from '@/modules/email/broadcast';

/**
 * Admin — email sampling and, separately, the gated broadcast the sample exists
 * to protect. Both admin-gated per the new-admin-route auth rule.
 *
 * The sample can only reach an owner address. The broadcast is dry-run by
 * default and will not send unless the caller echoes back the exact recipient
 * count the dry run just reported — see modules/email/broadcast.ts for why the
 * confirmation is a number rather than a flag.
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
      const result = await sendMobileGuideEmail(to);
      return reply.code(200).send({ status: 'ok', data: { to, result } });
    }
  );

  // POST /api/v1/admin/email/broadcast — mobile guide to every confirmed account.
  //
  //   { }                       -> dry run: who would receive it, and who is skipped
  //   { confirmRecipients: N }  -> sends, but only if N still matches the plan
  //
  // There is no "send everything" switch on purpose. The count IS the
  // confirmation: it cannot be satisfied by a stale request, and it forces the
  // caller to have looked at the list this minute.
  fastify.post<{ Body: { confirmRecipients?: number } }>(
    '/email/broadcast',
    adminAuth,
    async (request, reply) => {
      const confirm = request.body?.confirmRecipients;

      if (typeof confirm !== 'number') {
        const plan = await planBroadcast('mobile-guide');
        return reply.code(200).send({
          status: 'ok',
          data: {
            dryRun: true,
            campaign: plan.campaign,
            wouldSend: plan.recipients.length,
            alreadySent: plan.alreadySent.length,
            totalAccounts: plan.total,
            recipients: plan.recipients,
            hint: 'POST again with { "confirmRecipients": <wouldSend> } to send',
          },
        });
      }

      try {
        const result = await runBroadcast('mobile-guide', confirm);
        return reply.code(200).send({ status: 'ok', data: { dryRun: false, ...result } });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(409).send({ status: 'error', code: 'BROADCAST_REFUSED', message });
      }
    }
  );
}
