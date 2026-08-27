/**
 * The launch issue, through all three renders, from the file that will become
 * the row in newsletter_issues.
 *
 * These assert the property the whole design rests on: the three surfaces read
 * one document. If mail can be produced from something the page never saw, the
 * surfaces drift and the second one to drift is the one nobody re-reads.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  IssueDocumentSchema,
  findUngroundedClaims,
} from '../../../src/modules/newsletter/issue-schema';
import { renderWeb } from '../../../src/modules/newsletter/render-web';
import { renderMail, MissingMailDigestError } from '../../../src/modules/newsletter/render-mail';
import {
  renderNoteChapter,
  issueReferences,
  toMarkdown,
} from '../../../src/modules/newsletter/render-note';
import { bookChapterSchema } from '../../../src/modules/mandala-book/book-schema';

const raw = readFileSync(
  join(__dirname, '../../../src/modules/newsletter/issues/2026-08-25-ai-tech.json'),
  'utf-8'
);
const doc = IssueDocumentSchema.parse(JSON.parse(raw));

describe('launch issue document', () => {
  it('parses and carries no ungrounded claim', () => {
    expect(doc.slug).toBe('2026-08-25-ai-tech');
    expect(findUngroundedClaims(doc)).toEqual([]);
  });

  it('grades the figures that post-publication checking could not confirm', () => {
    const byName = Object.fromEntries(doc.interest.ledger.map((r) => [r.name, r.grade]));
    expect(byName['DeepSeek Harness 스타']).toBe('unconfirmed');
    expect(byName['Ox Alpha 무료 기간']).toBe('unconfirmed');
    expect(byName['에이전트가 소비한 토큰']).toBe('verified');
  });

  it('carries no figure that was invented for the mock', () => {
    expect(raw).not.toContain('964');
    expect(raw).not.toContain('Deloitte');
    expect(raw).not.toContain('1.6%');
  });

  it('states a funnel that adds up to the harvest it claims', () => {
    const total = doc.interest.funnel!.buckets.reduce((n, b) => n + b.count, 0);
    expect(total).toBe(2714);
  });
});

describe('three surfaces, one document', () => {
  it('web carries the ledger figures and their grades', () => {
    const html = renderWeb(doc);
    expect(html).toContain('7.3조');
    expect(html).toContain('1,042편');
    expect(html).toContain('<span class="g u">미확인</span>');
  });

  it('mail reuses the document figures rather than its own', () => {
    const { subject, html } = renderMail(doc, {
      readUrl: 'https://insighta.one/brief/2026-08-25-ai-tech',
      unsubscribeUrl: 'https://insighta.one/u/TOKEN',
    });
    expect(subject).toContain('제1호');
    expect(html).toContain('2,714');
    expect(html).toContain('수신거부');
    // The accent is found in the headline, not stored beside it.
    expect(html).toContain('4.5배</span>');
    // Titles arrive escaped -- one of them carries quotation marks, and a
    // template that passed those through raw would be the injection hole.
    for (const item of doc.mail!.items) {
      expect(html).toContain(item.title.replace(/"/g, '&quot;'));
    }
    expect(html).toContain('&quot;스킬을 전부 지워라&quot;');
  });

  it('refuses to send a digest nobody wrote', () => {
    const { mail: _dropped, ...rest } = doc;
    const noDigest = IssueDocumentSchema.parse(rest);
    expect(() =>
      renderMail(noDigest, { readUrl: 'https://x', unsubscribeUrl: 'https://y' })
    ).toThrow(MissingMailDigestError);
  });

  it('note produces a chapter the book schema accepts', () => {
    const chapter = renderNoteChapter(doc, 1);
    expect(() => bookChapterSchema.parse(chapter)).not.toThrow();
    expect(chapter.title).toContain('제1호');
    // one ledger section + four stories + insight + vocabulary + picks + next
    expect(chapter.sections).toHaveLength(9);
  });

  it('note keeps each claim attached to its grade', () => {
    const chapter = renderNoteChapter(doc, 1);
    const ledgerSection = chapter.sections[0]!;
    const checks = ledgerSection.verification?.checks ?? [];
    expect(checks).toHaveLength(doc.interest.ledger.length);
    expect(checks.find((c) => c.atom_text.startsWith('DeepSeek Harness'))?.verdict).toBe(
      'UNVERIFIABLE'
    );
    expect(checks.find((c) => c.atom_text.startsWith('에이전트가'))?.verdict).toBe('TRUE');
    // The section as a whole is not claimed verified while a row is not.
    expect(ledgerSection.verification?.status).toBe('unverified');
  });

  it('note emits markdown, not the page markup', () => {
    const chapter = renderNoteChapter(doc, 1);
    const body = chapter.sections.map((s) => s.narrative).join('\n');
    expect(body).not.toMatch(/<span|<strong|<sup/);
    expect(body).toContain('**');
    // Grades survive the conversion rather than being stripped with the tags.
    expect(body).toMatch(/확인|관측|미확인/);
  });

  it('emits only references a reader can follow', () => {
    const refs = issueReferences(doc);
    for (const r of refs) expect(r.url).toMatch(/^https?:\/\//);
  });
});

describe('toMarkdown', () => {
  it('converts emphasis and keeps grade markers as text', () => {
    const out = toMarkdown(
      '값이 <strong>3.96달러</strong>입니다.<span class="g v">확인</span><sup class="ref">2</sup>'
    );
    expect(out).toBe('값이 **3.96달러**입니다. `확인`[^2]');
  });

  it('drops tags it does not recognise instead of passing them through', () => {
    expect(toMarkdown('<script>alert(1)</script>안녕')).toBe('alert(1)안녕');
  });
});
