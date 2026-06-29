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
