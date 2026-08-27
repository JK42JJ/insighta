/**
 * Issue -> note chapter.
 *
 * The note is not a third copy of the brief. It is the same issue expressed in
 * the shape the product already reads: a `bookChapter` inside
 * `mandala_books.book_json`, which `note_documents` is generated from and the
 * learning view already renders. Nothing new is introduced on the read path.
 *
 * Weekly accumulation is an appended chapter, newest first. Text is cheap;
 * the cards carrying the week's videos are the finite part, and their rolling
 * window is a separate concern (see the pipeline design, section 2-4).
 *
 * `narrative` is markdown -- the frontend parses it into TipTap nodes -- so the
 * inline HTML the web surface uses has to be converted here, not passed through.
 */

import type { IssueDocument, Block, Grade, LedgerRow } from './issue-schema';
import type { BookChapter, BookSection } from '../mandala-book/book-schema';

/**
 * The brief grades three ways; the book's factcheck slot grades five. Mapping
 * into the existing slot means the note view shows verification state through
 * machinery that already exists, rather than gaining a parallel one.
 *
 * `observed` maps to SUBSTANTIALLY_TRUE rather than TRUE on purpose: three
 * independent channels agreeing is strong, but it is not a primary source.
 */
const VERDICT: Record<Grade, 'TRUE' | 'SUBSTANTIALLY_TRUE' | 'UNVERIFIABLE'> = {
  verified: 'TRUE',
  observed: 'SUBSTANTIALLY_TRUE',
  unconfirmed: 'UNVERIFIABLE',
};

const GRADE_TEXT: Record<Grade, string> = {
  verified: '확인',
  observed: '관측',
  unconfirmed: '미확인',
};

/**
 * Inline HTML -> markdown. Grade chips and source markers become bracketed
 * text so they survive into the note as readable evidence rather than being
 * stripped: a claim that loses its grade on the way into someone's notes is
 * exactly the failure this publication is built against.
 */
export function toMarkdown(html: string): string {
  return html
    .replace(/<span class="g v">확인<\/span>/g, ' `확인`')
    .replace(/<span class="g o">관측<\/span>/g, ' `관측`')
    .replace(/<span class="g u">미확인<\/span>/g, ' `미확인`')
    .replace(/<sup class="ref">(\d+)<\/sup>/g, '[^$1]')
    .replace(/<\/?(strong|b)>/g, '**')
    .replace(/<em[^>]*>/g, '*')
    .replace(/<\/em>/g, '*')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function blockToMarkdown(b: Block): string {
  switch (b.type) {
    case 'p':
    case 'lede':
      return toMarkdown(b.html);
    case 'h3':
      return `### ${b.text}`;
    case 'note':
      return `> **${b.lead}** ${toMarkdown(b.html)}`;
    case 'table': {
      const head = `| ${b.head.join(' | ')} |`;
      const rule = `| ${b.head.map(() => '---').join(' | ')} |`;
      const rows = b.rows.map((r) => `| ${r.join(' | ')} |`).join('\n');
      return [b.figref ? `**${b.figref}**` : '', head, rule, rows].filter(Boolean).join('\n');
    }
  }
}

function ledgerToMarkdown(rows: LedgerRow[]): string {
  const head = '| 항목 | 값 | 등급 |\n| --- | --- | --- |';
  const body = rows
    .map(
      (r) => `| ${r.name} | **${r.value}**${r.sub ? ` (${r.sub})` : ''} | ${GRADE_TEXT[r.grade]} |`
    )
    .join('\n');
  return `${head}\n${body}`;
}

function section(title: string, narrative: string, extra: Partial<BookSection> = {}): BookSection {
  return {
    title,
    narrative,
    atoms: [],
    qa: [],
    provenance: null,
    verification: null,
    ...extra,
  };
}

/**
 * One issue becomes one chapter. `ch` is supplied by the caller because it is
 * a position in the reader's own book, not a property of the issue -- two
 * subscribers who joined in different weeks hold the same issue at different
 * chapter numbers.
 */
export function renderNoteChapter(doc: IssueDocument, ch: number): BookChapter {
  const sections: BookSection[] = [];

  sections.push(
    section(
      '이번 주 확인한 수치',
      [toMarkdown(doc.interest.intro), '', ledgerToMarkdown(doc.interest.ledger)].join('\n'),
      {
        keyPoint: toMarkdown(doc.dek),
        // Every ledger row travels with its grade, so the note carries the
        // evidence state rather than flattening it into plain prose.
        verification: {
          status: doc.interest.ledger.every((r) => r.grade === 'verified')
            ? ('verified' as const)
            : ('unverified' as const),
          checks: doc.interest.ledger.map((r) => ({
            atom_text: `${r.name}: ${r.value}`,
            verdict: VERDICT[r.grade],
          })),
        },
      }
    )
  );

  for (const s of doc.stories) {
    sections.push(
      section(s.title, s.blocks.map(blockToMarkdown).join('\n\n'), {
        keyPoint: s.kicker,
      })
    );
  }

  sections.push(section('종합', doc.insight.blocks.map(blockToMarkdown).join('\n\n')));

  if (doc.vocabulary.length > 0) {
    sections.push(
      section(
        '용어',
        doc.vocabulary
          .map((t) => `**${t.word}**${t.en ? ` (${t.en})` : ''}\n\n${t.body}\n\n> ${t.use}`)
          .join('\n\n')
      )
    );
  }

  if (doc.picks.length > 0) {
    sections.push(
      section(
        '이번 주 고른 영상',
        doc.picks.map((p) => `**${p.title}**\n${p.meta}\n\n${p.body}`).join('\n\n'),
        {
          // Picks with a known video become atoms, which is what links the
          // note back to something watchable. Timestamp 0: the pick is the
          // whole video, not a moment inside it.
          atoms: doc.picks
            .filter((p) => p.videoId)
            .map((p) => ({ vid: p.videoId as string, ts: 0, text: p.title })),
        }
      )
    );
  }

  sections.push(
    section(
      '다음 호에서 확인할 것',
      [
        toMarkdown(doc.next.intro),
        '',
        ...doc.next.checkpoints.map((c) => `- **${c.when}** — ${c.title}`),
      ].join('\n')
    )
  );

  return {
    ch,
    title: `${doc.issueLabel} · ${doc.headline.join(' ')}`,
    intro: toMarkdown(doc.dek),
    sections,
  };
}

/**
 * Issue sources as book references. Only sources carrying a URL are emitted:
 * the book's reference shape requires one, and a reference nobody can follow
 * is not provenance. Sources without a URL stay visible in the web render.
 */
export function issueReferences(
  doc: IssueDocument,
  startId = 1
): Array<{ id: number; title: string; url: string }> {
  const out: Array<{ id: number; title: string; url: string }> = [];
  let id = startId;
  for (const ref of doc.refs) {
    for (const src of ref.sources) {
      if (!src.url) continue;
      out.push({ id: id++, title: `${ref.label} — ${src.name}`, url: src.url });
    }
  }
  return out;
}
