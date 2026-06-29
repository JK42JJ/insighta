/**
 * note-document-generator — loop-1b (§4.5.1) narrative render gate.
 * Pure generator → no mocks. Locks the falsifiable P-1b structural checks:
 *   P-1b-WEAVE      narrative book → woven prose IS the body; raw atom texts are
 *                   NOT dumped as per-video paragraphs (the 따로국밥 list is gone).
 *   P-1b-NO-DUP     no trailing keypoint blockquote (narrative is the body now).
 *   P-1b-PROV-KEPT  source atoms still cited as per-vid video blocks (vid+ts seek).
 *   R-1b (legacy)   no chapter intro → render byte-unchanged (atom paragraphs +
 *                   narrative blockquote).
 *   R-1b-FALLBACK   narrative book but empty section.narrative → legacy render.
 */
import { describe, it, expect } from 'vitest';
import { buildInitialNoteDoc } from '@/pages/learning/lib/note-document-generator';
import type { MandalaBookData } from '@/shared/lib/api-client';

type N = { type: string; content?: N[]; attrs?: { vid?: string } };
const nodes = (doc: { content?: unknown[] }): N[] => (doc.content ?? []) as N[];
const paraTexts = (ns: N[]): string[] =>
  ns
    .filter((n) => n.type === 'paragraph')
    .map((p) => (p.content ?? []).map((c) => (c as { text?: string }).text ?? '').join(''))
    .filter(Boolean);
const blockquotes = (ns: N[]) => ns.filter((n) => n.type === 'blockquote');
const videoBlocks = (ns: N[]) => ns.filter((n) => n.type === 'videoBlock');

// A multi-video topic: atoms from vidA + vidB, a woven narrative, chapter intro.
const book = (intro: string, narrative = 'WOVEN_BODY 식당 흐름이 이어진다'): MandalaBookData =>
  ({
    chapters: [
      {
        ch: 0,
        title: '기초 회화',
        intro,
        sections: [
          {
            title: '식당에서',
            narrative,
            atoms: [
              { vid: 'vidA', ts: 10, text: 'ATOM_TEXT_A 인사' },
              { vid: 'vidB', ts: 20, text: 'ATOM_TEXT_B 주문' },
            ],
          },
        ],
      },
    ],
  }) as MandalaBookData;

describe('note-document-generator — loop-1b narrative render', () => {
  it('narrative mode (intro present): prose is the body, no atom-text dump, no blockquote, atoms cited as video blocks', () => {
    const ns = nodes(buildInitialNoteDoc(book('이 장은 기초 회화를 다룬다')));
    const texts = paraTexts(ns);
    expect(texts).toContain('WOVEN_BODY 식당 흐름이 이어진다'); // P-1b-WEAVE: prose = body
    expect(texts).not.toContain('ATOM_TEXT_A 인사'); // no per-video atom-text dump
    expect(texts).not.toContain('ATOM_TEXT_B 주문');
    expect(blockquotes(ns)).toHaveLength(0); // P-1b-NO-DUP: narrative not a footer
    expect(videoBlocks(ns).map((v) => v.attrs?.vid).sort()).toEqual(['vidA', 'vidB']); // P-1b-PROV-KEPT
  });

  it('legacy mode (no intro): UNCHANGED — atom-text paragraphs + narrative blockquote', () => {
    const ns = nodes(buildInitialNoteDoc(book('')));
    const texts = paraTexts(ns);
    expect(texts).toContain('ATOM_TEXT_A 인사'); // atom text dumped (legacy)
    expect(texts).toContain('ATOM_TEXT_B 주문');
    expect(blockquotes(ns)).toHaveLength(1); // narrative as keypoint blockquote
  });

  it('fallback: narrative mode but empty section.narrative → legacy render for that section', () => {
    const ns = nodes(buildInitialNoteDoc(book('이 장은 기초 회화를 다룬다', '')));
    expect(paraTexts(ns)).toContain('ATOM_TEXT_A 인사'); // fell through to legacy atom render
  });
});

const headingTexts = (ns: N[]): string[] =>
  ns
    .filter((n) => n.type === 'heading')
    .map((h) => (h.content ?? []).map((c) => (c as { text?: string }).text ?? '').join(''));

describe('note-document-generator — loop-2 references render (P-REF-RENDER)', () => {
  const enriched = (): MandalaBookData => {
    const b = book('이 장은 기초 회화를 다룬다');
    b.chapters[0]!.research = [{ perspective: '발음', fact: 'WEB_FACT 모음 발음 핵심', ref_id: 1 }];
    b.references = [{ id: 1, title: 'Phonetics Guide', url: 'https://ex.com/p' }];
    return b;
  };

  it('renders chapter 보강 자료 (fact [ref_id]) + bottom 참고 자료 (id, url)', () => {
    const ns = nodes(buildInitialNoteDoc(enriched()));
    const texts = paraTexts(ns);
    expect(texts.some((t) => t.includes('WEB_FACT 모음 발음 핵심') && t.includes('[1]'))).toBe(true);
    expect(headingTexts(ns)).toContain('참고 자료');
    expect(texts.some((t) => t.includes('[1]') && t.includes('https://ex.com/p'))).toBe(true);
  });

  it('no references/research → no 참고 자료 section (legacy/normal book unchanged)', () => {
    const ns = nodes(buildInitialNoteDoc(book('이 장은 기초 회화를 다룬다')));
    expect(headingTexts(ns)).not.toContain('참고 자료');
  });
});

const linkHrefs = (ns: N[]): string[] =>
  ns
    .filter((n) => n.type === 'paragraph')
    .flatMap((p) => (p.content ?? []) as Array<{ marks?: Array<{ type: string; attrs?: { href?: string } }> }>)
    .flatMap((c) => c.marks ?? [])
    .filter((m) => m.type === 'link')
    .map((m) => m.attrs?.href ?? '');

describe('note-document-generator — CP505 B per-chapter video dedup', () => {
  const repeatBook = (): MandalaBookData =>
    ({
      chapters: [
        {
          ch: 0,
          title: '워밍업',
          intro: '',
          sections: [
            { title: '도입', atoms: [{ vid: 'vidA', ts: 9, text: 'intro' }] },
            { title: '루틴', atoms: [{ vid: 'vidA', ts: 192, text: 'routine' }] },
            { title: '주의', atoms: [{ vid: 'vidB', ts: 30, text: 'caution' }] },
          ],
        },
      ],
    }) as MandalaBookData;

  it('same vid repeated in a chapter → ONE full embed + timestamp pill (not re-embedded)', () => {
    const ns = nodes(buildInitialNoteDoc(repeatBook()));
    const vb = videoBlocks(ns);
    expect(vb.filter((v) => v.attrs?.vid === 'vidA')).toHaveLength(1); // embedded ONCE
    expect(vb.filter((v) => v.attrs?.vid === 'vidB')).toHaveLength(1);
    // the vidA repeat (ts=192) → timestamp pill linking to t=192 (seeks embedded player)
    expect(linkHrefs(ns).some((h) => h.includes('vidA') && h.includes('t=192'))).toBe(true);
  });
});
