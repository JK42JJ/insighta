/**
 * Transactional user emails (CP516) — send layer. HTML lives in ./templates
 * (pure, shared with the sample tool). Sending reuses the shared Gmail-SMTP
 * transporter, is non-fatal to the caller, and is gated by
 * TRANSACTIONAL_EMAIL_ENABLED (default off) for a controlled beta rollout.
 */

import { transporter } from '@/modules/skills/mailer';
import { config } from '@/config/index';
import { logger } from '@/utils/logger';
import {
  buildWelcomeEmail,
  buildNoteReadyEmail,
  type WelcomeEmailParams,
  type NoteReadyEmailParams,
} from './templates';

const log = logger.child({ module: 'email/transactional' });

/** Master gate — James flips on for the beta once the send path is verified. */
function isTransactionalEmailEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env['TRANSACTIONAL_EMAIL_ENABLED'] ?? '')
    .trim()
    .toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

async function send(to: string, subject: string, html: string, tag: string): Promise<void> {
  if (!isTransactionalEmailEnabled()) {
    log.info(`${tag}: transactional email disabled (TRANSACTIONAL_EMAIL_ENABLED unset) — skipped`);
    return;
  }
  if (!to) {
    log.warn(`${tag}: recipient empty — skipped`);
    return;
  }
  try {
    // Display name "Insighta" (not the bare noreply@ local-part).
    await transporter.sendMail({ from: `Insighta <${config.gmail.smtpFrom}>`, to, subject, html });
    log.info(`${tag}: sent to ${to}`);
  } catch (err) {
    log.warn(
      `${tag}: send failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function sendWelcomeEmail(to: string, params: WelcomeEmailParams): Promise<void> {
  const { subject, html } = buildWelcomeEmail(params);
  await send(to, subject, html, 'welcome-email');
}

export async function sendNoteReadyEmail(to: string, params: NoteReadyEmailParams): Promise<void> {
  const { subject, html } = buildNoteReadyEmail(params);
  await send(to, subject, html, 'note-ready-email');
}
