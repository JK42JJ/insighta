/**
 * Send one published issue to its subscribers.
 *
 * Shaped like the product broadcast (`email/broadcast.ts`) because a send
 * cannot be recalled: the dry run is the default and reports the recipient
 * count; the real send must be handed back that exact count; every recipient
 * is claimed in the ledger before the mail goes out, so a retry or an
 * overlapping run skips whoever is already recorded.
 *
 * Recipients are the accounts subscribed to the category, minus anyone who
 * has used an unsubscribe link for it (or for everything). Each recipient
 * gets their own token, minted here if they have none, so the link in the
 * mail identifies exactly one (email, category) pair.
 *
 * The issue number in the subject comes from the stored column, never from
 * the document's label -- the same rule the page and the list follow.
 */

import { randomBytes } from 'crypto';

import { getPrismaClient } from '@/modules/database/client';
import { sendBriefIssueEmail } from '@/modules/email/transactional';
import { logger } from '@/utils/logger';

import { IssueDocumentSchema } from './issue-schema';
import { issueLabelOf } from './issue-label';
import { renderMail } from './render-mail';
import { briefMailHeaders, issueCampaign, readUrlOf, unsubscribeUrlOf } from './mail-links';

const log = logger.child({ module: 'newsletter/send-issue' });

/** Gmail SMTP drops bursts; the product broadcast settled on this pace. */
const SEND_INTERVAL_MS = 1_200;

/** Refuse anything larger outright; the subscriber base is in the tens. */
export const ISSUE_SEND_MAX_RECIPIENTS = 500;

/** 24 random bytes -> 32 URL-safe characters, inside the route's 16..64 check. */
const TOKEN_BYTES = 24;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class IssueSendError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'NOT_PUBLISHED' | 'UNREADABLE' | 'COUNT_MISMATCH' | 'TOO_MANY',
    message: string
  ) {
    super(message);
    this.name = 'IssueSendError';
  }
}

export interface IssueSendPlan {
  issueId: string;
  slug: string;
  categoryKey: string;
  issueLabel: string;
  subject: string;
  readUrl: string;
  /** everyone who would receive it if sent right now */
  recipients: string[];
  /** already in the ledger for this issue, and therefore skipped */
  alreadySent: string[];
  /** subscribed and not opted out, before the ledger filter */
  total: number;
  /** what one recipient's mail carries, for the reviewer */
  sample: { unsubscribeUrl: string; headers: Record<string, string> };
}

async function loadIssue(issueId: string) {
  const row = await getPrismaClient().newsletter_issues.findUnique({
    where: { id: issueId },
    select: {
      id: true,
      slug: true,
      category_key: true,
      issue_no: true,
      locale: true,
      template_version: true,
      published_at: true,
      content_json: true,
    },
  });
  if (!row) throw new IssueSendError('NOT_FOUND', 'issue not found');
  if (!row.published_at) {
    throw new IssueSendError('NOT_PUBLISHED', 'issue is not published; publish it before sending');
  }
  const parsed = IssueDocumentSchema.safeParse(row.content_json);
  if (!parsed.success) {
    throw new IssueSendError('UNREADABLE', 'issue content_json fails the document schema');
  }
  const locale = row.locale === 'en' ? ('en' as const) : ('ko' as const);
  const doc = {
    ...parsed.data,
    templateVersion: row.template_version,
    locale,
    issueLabel: issueLabelOf(row.issue_no, locale),
  };
  return { row, doc };
}

/**
 * Subscribed, confirmed accounts for the category, minus opted-out addresses.
 * Lowercased and de-duplicated: two accounts on one mailbox get one mail.
 */
async function eligibleRecipients(categoryKey: string): Promise<string[]> {
  const prisma = getPrismaClient();
  const subscribed = await prisma.$queryRaw<Array<{ email: string }>>`
    SELECT DISTINCT lower(u.email) AS email
      FROM newsletter_subscriptions s
      JOIN auth.users u ON u.id = s.user_id
     WHERE s.category_key = ${categoryKey}
       AND u.email IS NOT NULL
       AND u.email <> ''
       AND u.email_confirmed_at IS NOT NULL
       AND u.deleted_at IS NULL
     ORDER BY 1
  `;
  const optedOut = await prisma.$queryRaw<Array<{ email: string }>>`
    SELECT DISTINCT lower(email) AS email
      FROM newsletter_unsubscribes
     WHERE unsubscribed_at IS NOT NULL
       AND category_key IN (${categoryKey}, 'all')
  `;
  const out = new Set(optedOut.map((r) => r.email));
  return subscribed.map((r) => r.email).filter((e) => e && !out.has(e));
}

/** The recipient's token for this category, minted on first use. */
async function tokenFor(email: string, categoryKey: string): Promise<string> {
  const prisma = getPrismaClient();
  const existing = await prisma.newsletter_unsubscribes.findFirst({
    where: { email, category_key: categoryKey },
    select: { token: true },
  });
  if (existing) return existing.token;
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  await prisma.newsletter_unsubscribes.create({
    data: { email, category_key: categoryKey, token },
  });
  return token;
}

export async function planIssueSend(issueId: string): Promise<IssueSendPlan> {
  const { row, doc } = await loadIssue(issueId);
  const sampleUnsubscribe = unsubscribeUrlOf('TOKEN');
  const rendered = renderMail(doc, {
    readUrl: readUrlOf(row.slug),
    unsubscribeUrl: sampleUnsubscribe,
  });

  const all = await eligibleRecipients(row.category_key);
  const sent = await getPrismaClient().email_broadcast_sends.findMany({
    where: { campaign: issueCampaign(row.slug), status: 'sent' },
    select: { email: true },
  });
  const sentSet = new Set(sent.map((s) => s.email));

  return {
    issueId: row.id,
    slug: row.slug,
    categoryKey: row.category_key,
    issueLabel: doc.issueLabel,
    subject: rendered.subject,
    readUrl: readUrlOf(row.slug),
    recipients: all.filter((e) => !sentSet.has(e)),
    alreadySent: all.filter((e) => sentSet.has(e)),
    total: all.length,
    sample: { unsubscribeUrl: sampleUnsubscribe, headers: briefMailHeaders(sampleUnsubscribe) },
  };
}

export interface IssueSendResult {
  slug: string;
  attempted: number;
  sent: number;
  failed: Array<{ email: string; error: string }>;
}

/**
 * `expectedRecipients` must equal what planIssueSend just reported. A number
 * rather than a flag, so a stale or copy-pasted request cannot satisfy it.
 */
export async function runIssueSend(
  issueId: string,
  expectedRecipients: number
): Promise<IssueSendResult> {
  const plan = await planIssueSend(issueId);
  if (plan.recipients.length !== expectedRecipients) {
    throw new IssueSendError(
      'COUNT_MISMATCH',
      `${plan.recipients.length} pending, ${expectedRecipients} confirmed -- re-run the dry run and confirm the new number`
    );
  }
  if (plan.recipients.length > ISSUE_SEND_MAX_RECIPIENTS) {
    throw new IssueSendError(
      'TOO_MANY',
      `${plan.recipients.length} exceeds ${ISSUE_SEND_MAX_RECIPIENTS}`
    );
  }

  const { row, doc } = await loadIssue(issueId);
  const prisma = getPrismaClient();
  const campaign = issueCampaign(row.slug);
  const failed: Array<{ email: string; error: string }> = [];
  let sent = 0;

  for (const email of plan.recipients) {
    // Claim before sending: an overlapping run hits the unique index and skips.
    try {
      await prisma.email_broadcast_sends.create({ data: { campaign, email, status: 'sent' } });
    } catch {
      log.info('issue send: already claimed, skipping', { campaign, email });
      continue;
    }

    const unsubscribeUrl = unsubscribeUrlOf(await tokenFor(email, row.category_key));
    const mail = renderMail(doc, { readUrl: plan.readUrl, unsubscribeUrl });
    const result = await sendBriefIssueEmail(
      email,
      mail.subject,
      mail.html,
      briefMailHeaders(unsubscribeUrl)
    );
    if (result.status === 'sent') {
      sent++;
    } else {
      const error = result.status === 'failed' ? result.error : `skipped: ${result.reason}`;
      failed.push({ email, error });
      await prisma.email_broadcast_sends.update({
        where: { campaign_email: { campaign, email } },
        data: { status: 'failed', error },
      });
    }
    await sleep(SEND_INTERVAL_MS);
  }

  log.info('issue send complete', {
    campaign,
    attempted: plan.recipients.length,
    sent,
    failed: failed.length,
  });
  return { slug: row.slug, attempted: plan.recipients.length, sent, failed };
}
