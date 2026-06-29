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

// [CV-NOTE-WIRE] — CV figures attached to a section render as figureBlock nodes.
// New base: chart/diagram → inline svg, table → struct, equation → latex.
// The broken pod-local asset_path <img> path was removed.
type FigAttrs = {
  kind?: string;
  latex?: string;
  svg?: string;
  struct?: { headers?: string[]; rows?: string[][] };
};
const figureBlocks = (ns: N[]) =>
  ns.filter((n) => n.type === 'figureBlock').map((n) => (n.attrs ?? {}) as FigAttrs);

describe('note-document-generator — CV figures render ([CV-NOTE-WIRE])', () => {
  const withFigures = (): MandalaBookData => {
    const b = book('이 장은 기초 회화를 다룬다');
    b.chapters[0]!.sections[0]!.figures = [
      { video_id: 'vidA', ts_sec: 10, kind: 'equation', latex: 'E=mc^2', verification_status: 'verified' },
      { video_id: 'vidA', ts_sec: 12, kind: 'diagram', svg: '<svg><g/></svg>', verification_status: 'verified' },
      { video_id: 'vidA', ts_sec: 14, kind: 'table', struct: { headers: ['A', 'B'], rows: [['1', '2']] }, verification_status: 'verified' },
      { video_id: 'vidA', ts_sec: 15, kind: 'chart', svg: '', verification_status: 'verified' }, // DROP empty svg
      { video_id: 'vidA', ts_sec: 16, kind: 'diagram', svg: '<svg/>', verification_status: 'unverified' }, // DROP unverified
      { video_id: 'vidA', ts_sec: 18, kind: 'keyframe', asset_path: 'https://cdn.ex.com/kf.png', verification_status: 'verified' }, // DROP keyframe
    ];
    return b;
  };

  it('renders diagram(svg) + table(struct) + equation(latex); drops unverified/keyframe/empty', () => {
    const figs = figureBlocks(nodes(buildInitialNoteDoc(withFigures())));
    expect(figs.some((f) => f.kind === 'equation' && f.latex === 'E=mc^2')).toBe(true); // equation kept
    expect(figs.some((f) => f.kind === 'diagram' && f.svg === '<svg><g/></svg>')).toBe(true); // diagram svg kept
    expect(
      figs.some(
        (f) => f.kind === 'table' && f.struct?.headers?.[0] === 'A' && f.struct?.rows?.[0]?.[1] === '2'
      )
    ).toBe(true); // table struct kept
    expect(figs.some((f) => f.kind === 'chart')).toBe(false); // empty svg dropped
    expect(figs.some((f) => f.kind === 'keyframe')).toBe(false); // keyframe dropped
    expect(figs).toHaveLength(3);
  });

  it('no figures → no figureBlock nodes (existing books byte-unchanged)', () => {
    const figs = figureBlocks(nodes(buildInitialNoteDoc(book('이 장은 기초 회화를 다룬다'))));
    expect(figs).toHaveLength(0);
  });
});
