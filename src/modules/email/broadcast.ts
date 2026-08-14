/**
 * Mass send, for the one case that needs it: telling every existing account
 * that the mobile app is ready.
 *
 * A broadcast cannot be recalled, so the shape of this module is defensive by
 * construction rather than by discipline:
 *
 *   - Dry run is the default. Sending requires passing back the exact recipient
 *     count the dry run reported. If anyone signed up in between, the number no
 *     longer matches and the send refuses — you cannot fire at a population you
 *     have not looked at.
 *   - Every send is written to a ledger keyed (campaign, email) with a unique
 *     index. A repeat run, a retry after a crash, or two admins clicking at the
 *     same moment all skip anyone already recorded.
 *   - Failures are recorded with their reason, so a retry targets only them.
 *   - Sends are paced. Gmail SMTP throttles bursts, and a throttled burst looks
 *     exactly like a partial success.
 */

import { getPrismaClient } from '@/modules/database/client';
import { sendMobileGuideEmail } from '@/modules/email/transactional';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'email/broadcast' });

/** Pause between messages. Gmail SMTP drops bursts; 1.2s keeps a 20-100 person
 *  list comfortably inside its rate limit and costs under two minutes. */
const SEND_INTERVAL_MS = 1_200;

/** Refuse anything larger than this outright. The current account base is ~20;
 *  a request for thousands means something upstream is wrong, and a broadcast is
 *  the worst possible place to find that out. */
export const BROADCAST_MAX_RECIPIENTS = 500;

export type BroadcastCampaign = 'mobile-guide';

/**
 * Addresses that exist as accounts but are not people: the e2e fixture, the
 * template owner, and the support alias, which is a mailbox we send FROM.
 * They sit in auth.users like anyone else, so without this a product
 * announcement goes to our own plumbing.
 */
const NOT_A_PERSON = new Set([
  'e2e-test@insighta.one',
  'system-templates@insighta.one',
  'support@insighta.one',
]);

export interface BroadcastPlan {
  campaign: string;
  /** everyone who would receive it if you sent right now */
  recipients: string[];
  /** already recorded for this campaign, and therefore skipped */
  alreadySent: string[];
  total: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Who would receive this campaign.
 *
 * Two populations, not one. Confirmed accounts are the obvious half; the other
 * is people who were invited to the closed beta and have not signed up yet.
 * They are not in auth.users at all, so a query over accounts alone silently
 * drops exactly the people most likely to act on an announcement -- measured on
 * prod: 2 of 3 beta invitees had no account.
 *
 * Unconfirmed accounts are still excluded: that address either bounces or
 * belongs to someone who abandoned signup.
 */
export async function planBroadcast(campaign: BroadcastCampaign): Promise<BroadcastPlan> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Array<{ email: string }>>(
    `SELECT DISTINCT lower(email) AS email
       FROM auth.users
      WHERE email IS NOT NULL
        AND email <> ''
        AND email_confirmed_at IS NOT NULL
        AND deleted_at IS NULL
      ORDER BY 1`
  );
  const invited = await prisma.beta_applications.findMany({
    where: { email: { not: '' } },
    select: { email: true },
  });

  const all = [
    ...new Set([
      ...rows.map((r) => r.email),
      ...invited.map((i) => i.email.trim().toLowerCase()).filter(Boolean),
    ]),
  ]
    .filter((e) => e && !NOT_A_PERSON.has(e))
    .sort();

  const sent = await prisma.email_broadcast_sends.findMany({
    where: { campaign, status: 'sent' },
    select: { email: true },
  });
  const sentSet = new Set(sent.map((s) => s.email));

  return {
    campaign,
    recipients: all.filter((e) => !sentSet.has(e)),
    alreadySent: all.filter((e) => sentSet.has(e)),
    total: all.length,
  };
}

export interface BroadcastResult {
  campaign: string;
  attempted: number;
  sent: number;
  failed: Array<{ email: string; error: string }>;
}

/**
 * Send. `expectedRecipients` must equal the count planBroadcast just reported —
 * this is the confirmation, and it is deliberately a number rather than a
 * boolean flag so that it cannot be satisfied by a stale or copy-pasted request.
 */
export async function runBroadcast(
  campaign: BroadcastCampaign,
  expectedRecipients: number
): Promise<BroadcastResult> {
  const plan = await planBroadcast(campaign);

  if (plan.recipients.length !== expectedRecipients) {
    throw new Error(
      `RECIPIENT_COUNT_MISMATCH: ${plan.recipients.length} pending, ${expectedRecipients} confirmed — re-run the dry run and confirm the new number`
    );
  }
  if (plan.recipients.length > BROADCAST_MAX_RECIPIENTS) {
    throw new Error(
      `RECIPIENT_LIMIT: ${plan.recipients.length} exceeds ${BROADCAST_MAX_RECIPIENTS}`
    );
  }

  const prisma = getPrismaClient();
  const failed: Array<{ email: string; error: string }> = [];
  let sent = 0;

  for (const email of plan.recipients) {
    // Claim the recipient BEFORE sending. If two runs overlap, the unique index
    // rejects the second claim and that run skips — the alternative (send, then
    // record) double-mails whoever was in flight when the second run started.
    try {
      await prisma.email_broadcast_sends.create({
        data: { campaign, email, status: 'sent' },
      });
    } catch {
      log.info('broadcast: already claimed, skipping', { campaign, email });
      continue;
    }

    const result = await sendMobileGuideEmail(email);
    if (result.status === 'sent') {
      sent++;
    } else {
      const error = result.status === 'failed' ? result.error : `skipped: ${result.reason}`;
      failed.push({ email, error });
      // Mark the claim failed so a retry can pick it up; the row stays so the
      // reason is not lost.
      await prisma.email_broadcast_sends.update({
        where: { campaign_email: { campaign, email } },
        data: { status: 'failed', error },
      });
    }
    await sleep(SEND_INTERVAL_MS);
  }

  log.info('broadcast complete', {
    campaign,
    attempted: plan.recipients.length,
    sent,
    failed: failed.length,
  });
  return { campaign, attempted: plan.recipients.length, sent, failed };
}
