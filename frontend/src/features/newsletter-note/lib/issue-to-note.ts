/**
 * A published brief, rendered as a note document.
 *
 * The standalone brief page is a review surface — it is where an editor checks
 * an issue before it goes out. The place a subscriber reads it is the note
 * screen, which is the product's surface for long-form reading, so the issue
 * has to arrive in that surface's own format rather than as a page embedded
 * next to it.
 *
 * That format is a TipTap document, and the note surface already carries the
 * node types a brief needs. The mapping is close to one-to-one:
 *
 *   headline / dek        heading 1, then a lede paragraph
 *   interest.ledger       a table — grade, value and what it is
 *   stories[].blocks      paragraph / heading 3 / callout / table
 *   picks                 videoBlock, which is why a pick is watchable here
 *   vocabulary            heading 3 plus paragraphs
 *   refs                  an ordered list of links
 *
 * `picks` is the one that mattered. On the brief page a pick was a title, a
 * channel and a write-up with the video id left in the data — the reader had
 * nothing to click. A videoBlock takes the id and renders the thumbnail and
 * the player, so in the note a recommendation is the video.
 *
 * Rule-based and pure, like `note-document-generator`: no model call, and the
 * input is not mutated. The document that comes out is read-only in the note
 * surface; a subscriber who wants to keep or annotate one takes a copy, which
 * is a separate act and a later decision.
 */

import type { TiptapDoc, TiptapNode } from '@/features/video-side-panel/lib/note-parser';
import type {
  IssueDocument,
  Block,
  LedgerRow,
  Pick,
  Ref,
  Story,
  Term,
  WhenItem,
} from '@/features/newsletter-note/lib/issue-types';

/** Collapse whitespace runs; a stray newline must not become a line break. */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The brief's prose carries inline HTML — `<strong>`, `<em>`, `<code>`, and
 * anchors. TipTap wants marks, so the tags become marks and everything else is
 * dropped rather than shown. A reader must never see a raw tag.
 */
function inlineToNodes(html: string): TiptapNode[] {
  const out: TiptapNode[] = [];
  const re = /<(strong|b|em|i|code|a)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let cursor = 0;
  let m: RegExpExecArray | null;

  const push = (text: string, marks?: TiptapNode['marks']): void => {
    const t = text.replace(/<[^>]+>/g, '');
    if (!t) return;
    out.push(marks ? { type: 'text', text: t, marks } : { type: 'text', text: t });
  };

  while ((m = re.exec(html)) !== null) {
    push(html.slice(cursor, m.index));
    const tag = (m[1] ?? '').toLowerCase();
    const attrs = m[2] ?? '';
    const inner = m[3] ?? '';
    if (tag === 'a') {
      const href = /href="([^"]*)"/i.exec(attrs)?.[1];
      push(
        inner,
        href
          ? [{ type: 'link', attrs: { href, target: '_blank', rel: 'noopener noreferrer' } }]
          : undefined
      );
    } else if (tag === 'code') {
      push(inner, [{ type: 'code' }]);
    } else if (tag === 'em' || tag === 'i') {
      push(inner, [{ type: 'italic' }]);
    } else {
      push(inner, [{ type: 'bold' }]);
    }
    cursor = m.index + m[0].length;
  }
  push(html.slice(cursor));
  return out;
}

function para(html: string): TiptapNode {
  const content = inlineToNodes(normalize(html));
  return content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' };
}

function heading(level: number, text: string): TiptapNode {
  return { type: 'heading', attrs: { level }, content: [{ type: 'text', text: normalize(text) }] };
}

/** An eyebrow — the small line above a heading. A paragraph the CSS styles. */
function eyebrow(text: string): TiptapNode {
  return {
    type: 'paragraph',
    attrs: { class: 'note-eyebrow' },
    content: [{ type: 'text', text: normalize(text) }],
  };
}

function table(head: string[], rows: string[][]): TiptapNode {
  const cell = (text: string, header: boolean): TiptapNode => ({
    type: header ? 'tableHeader' : 'tableCell',
    content: [para(text)],
  });
  return {
    type: 'table',
    content: [
      { type: 'tableRow', content: head.map((h) => cell(h, true)) },
      ...rows.map((r) => ({ type: 'tableRow', content: r.map((c) => cell(c, false)) })),
    ],
  };
}

function blockToNodes(b: Block): TiptapNode[] {
  switch (b.type) {
    case 'h3':
      return [heading(3, b.text)];
    case 'lede':
    case 'p':
      return [para(b.html)];
    case 'note':
      // The brief's emphasis box is the note surface's callout. `warn` keeps
      // its weight; anything else is the plain variant.
      return [
        {
          type: 'callout',
          attrs: { variant: b.variant === 'warn' ? 'warn' : 'note' },
          content: [para(`<strong>${b.lead}</strong> ${b.html}`)],
        },
      ];
    case 'table':
      return [table(b.head, b.rows)];
    default:
      return [];
  }
}

/** Grades read as words here; the page's badge styling does not travel. */
const GRADE_LABEL: Record<string, string> = {
  verified: '확인',
  observed: '관측',
  unconfirmed: '미확인',
};

function ledgerTable(rows: LedgerRow[]): TiptapNode {
  return table(
    ['항목', '값', '등급', '내용'],
    rows.map((r) => [
      r.name,
      r.sub ? `${r.value} (${r.sub})` : r.value,
      GRADE_LABEL[r.grade] ?? r.grade,
      normalize(r.desc.replace(/<[^>]+>/g, '')),
    ])
  );
}

function storyNodes(s: Story): TiptapNode[] {
  return [eyebrow(s.kicker), heading(2, s.title), ...s.blocks.flatMap(blockToNodes)];
}

/**
 * A pick becomes the video plus its write-up.
 *
 * `sectionTitle` carries the channel line so the block's own caption says who
 * made it, which is the attribution the page prints under the title.
 */
function pickNodes(p: Pick): TiptapNode[] {
  const body = para(p.body);
  if (!p.videoId) return [heading(3, p.title), para(p.meta), body];
  return [
    {
      type: 'videoBlock',
      attrs: { vid: p.videoId, fromSec: 0, endSec: 0, sectionTitle: `${p.title} · ${p.meta}` },
    },
    body,
  ];
}

function termNodes(t: Term): TiptapNode[] {
  return [
    heading(3, t.en ? `${t.word} · ${t.en}` : t.word),
    para(t.body),
    para(`<em>${t.use}</em>`),
  ];
}

function whenList(items: WhenItem[]): TiptapNode {
  return {
    type: 'bulletList',
    content: items.map((i) => ({
      type: 'listItem',
      content: [para(`<strong>${i.when}</strong> — ${i.title}`)],
    })),
  };
}

function refList(refs: Ref[]): TiptapNode {
  return {
    type: 'orderedList',
    content: refs.map((r) => ({
      type: 'listItem',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: `${r.label} — ` },
            ...r.sources.flatMap((s, i): TiptapNode[] => {
              const sep: TiptapNode[] = i > 0 ? [{ type: 'text', text: ', ' }] : [];
              return [
                ...sep,
                s.url
                  ? {
                      type: 'text',
                      text: s.name,
                      marks: [
                        {
                          type: 'link',
                          attrs: { href: s.url, target: '_blank', rel: 'noopener noreferrer' },
                        },
                      ],
                    }
                  : { type: 'text', text: s.name },
              ];
            }),
          ],
        },
      ],
    })),
  };
}

const rule = (): TiptapNode => ({ type: 'horizontalRule' });

export function issueToNoteDoc(doc: IssueDocument): TiptapDoc {
  const content: TiptapNode[] = [];

  content.push(eyebrow(`${doc.category} · ${doc.issueLabel} · ${doc.dateLabel}`));
  content.push(heading(1, doc.headline.join(' ')));
  content.push(para(doc.dek));
  content.push(rule());

  for (const s of doc.stories) {
    content.push(...storyNodes(s));
    content.push(rule());
  }

  content.push(heading(2, '이번 주 한 문장'));
  content.push(...doc.insight.blocks.flatMap(blockToNodes));
  if (doc.insight.actions.length > 0) content.push(whenList(doc.insight.actions));

  if (doc.picks.length > 0) {
    content.push(rule());
    content.push(heading(2, '이번 주 추천'));
    content.push(...doc.picks.flatMap(pickNodes));
  }

  if (doc.vocabulary.length > 0) {
    content.push(rule());
    content.push(heading(2, '용어'));
    content.push(...doc.vocabulary.flatMap(termNodes));
  }

  // The method, and only here. An earlier issue put the selection counts on
  // the front page; a reader subscribed to the subject, not to the filtering.
  content.push(rule());
  content.push(heading(2, '이 브리프를 만든 방법'));
  content.push(para(doc.interest.intro));
  if (doc.interest.ledger.length > 0) {
    content.push(ledgerTable(doc.interest.ledger));
    content.push(para(`<em>${doc.interest.ledgerCaption}</em>`));
  }
  content.push(para(doc.gradeNote));
  content.push(para(doc.editNote));

  if (doc.refs.length > 0) {
    content.push(heading(3, '출처'));
    content.push(refList(doc.refs));
  }

  content.push(para(`<em>${doc.sign}</em>`));

  return { type: 'doc', content };
}
