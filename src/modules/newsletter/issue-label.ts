/**
 * The issue label, derived from the stored issue number.
 *
 * The number is the identity (`newsletter_issues.issue_no`, unique per category
 * and locale); the label is how it is printed. The document also carries an
 * `issueLabel` string, written by the editor, and for the first two issues both
 * said 제1호 while the numbers said 0 and 1. Every surface -- list card, page
 * header, sidebar, mail subject, document title -- now prints this function's
 * output and never the document's string, so one column is the only place the
 * number lives.
 */

export type IssueLocale = 'ko' | 'en';

export function issueLabelOf(issueNo: number, locale: IssueLocale = 'ko'): string {
  return locale === 'en' ? `No. ${issueNo}` : `제${issueNo}호`;
}
