/**
 * The links and headers a brief mail carries. Pure, so the send path and its
 * tests agree on them without a database.
 *
 * The CTA goes to the issue page, not the category: a reader who opens a
 * mail about one issue wants that issue. It is behind a login by decision
 * (2026-09-15) -- `returnTo` brings them back after signing in.
 *
 * The unsubscribe link is the token route, reachable without a login, and
 * the same URL goes into `List-Unsubscribe` so a mail client can offer the
 * action in its own chrome. `List-Unsubscribe-Post` is what Gmail and Yahoo
 * require for one-click; without it the header is decorative.
 */

import { SITE_ORIGIN } from '../email/templates';

export function readUrlOf(slug: string): string {
  return `${SITE_ORIGIN}/brief/${slug}`;
}

export function unsubscribeUrlOf(token: string): string {
  return `${SITE_ORIGIN}/api/v1/u/${token}`;
}

export function briefMailHeaders(unsubscribeUrl: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${unsubscribeUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

/** The ledger key. One campaign per issue, so a re-run skips who already got it. */
export function issueCampaign(slug: string): string {
  return `brief:${slug}`;
}
