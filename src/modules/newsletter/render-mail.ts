/**
 * Issue -> mail digest.
 *
 * Thin on purpose. `buildBriefEmail` already owns the mail design; this only
 * adapts the document to it, so the "one document, three renders" claim holds
 * for the surface that was built first rather than leaving mail on a parallel
 * input path that could drift from the page.
 */

import type { IssueDocument } from './issue-schema';
import { buildBriefEmail } from '../email/templates';

export interface MailRenderOptions {
  /** Where 전체 브리프 읽기 goes. The subscriber's own note once that lands. */
  readUrl: string;
  /** Token route, reachable without a login. */
  unsubscribeUrl: string;
}

export class MissingMailDigestError extends Error {
  constructor(slug: string) {
    super(
      `issue ${slug} has no mail digest. The digest lines are written, not derived ` +
        `from stories -- a story headline names a topic, a digest line states what ` +
        `stopped being true. Add doc.mail before sending.`
    );
    this.name = 'MissingMailDigestError';
  }
}

/**
 * Throws rather than falling back to story headlines. A silent fallback would
 * send a digest nobody wrote, and the difference is invisible until it is in
 * someone's inbox.
 */
export function renderMail(
  doc: IssueDocument,
  opts: MailRenderOptions
): { subject: string; html: string } {
  if (!doc.mail) throw new MissingMailDigestError(doc.slug);

  return buildBriefEmail({
    issueLabel: doc.issueLabel,
    dateLabel: doc.dateLabel,
    category: doc.category.toUpperCase(),
    headline: doc.headline.join(' '),
    headlineMark: findMark(doc.headline.join(' ')),
    deck: plain(doc.dek),
    items: doc.mail.items,
    stats: doc.mail.stats,
    method: doc.mail.method,
    readUrl: opts.readUrl,
    readMeta: doc.mail.readMeta,
    unsubscribeUrl: opts.unsubscribeUrl,
    preview: doc.preview,
  });
}

/**
 * The headline's accented fragment is the figure it turns on -- "4.5배",
 * "14배". Picked by pattern rather than stored as a field: it is a property of
 * the sentence, and a separate field could fall out of step with an edit to it.
 * No match means no accent, which is a plain headline rather than a broken one.
 */
function findMark(headline: string): string | undefined {
  return /[0-9][0-9,.]*\s*(배|%|조|억|만|달러)/.exec(headline)?.[0];
}

/** The dek carries inline emphasis for the page; mail takes it as prose. */
function plain(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
