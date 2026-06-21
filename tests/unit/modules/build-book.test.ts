/**
 * build-book — pure mandala-book assembler (§2-D #1).
 *
 * Locks the LLM-free assembly invariants:
 *   - chapter per cell, section per video; output passes parseBookJson
 *   - honest skip: a cell with no videos → empty chapter (kept, sections: [])
 *   - atoms without timestamp_sec are skipped from the book but counted in
 *     source_atoms (input-pool vs included asymmetry)
 *   - seg_ref set only when an atom's timestamp falls inside a section window
 *   - qa mapped from lora.qa_pairs as-is (no context filter)
 *   - narrative = string concat of core_argument + section summaries (no gen)
 */

import { buildBookJson, type BuildBookInput } from '../../../src/modules/mandala-book/build-book';
import { parseBookJson } from '../../../src/modules/mandala-book/book-schema';
import type {
  RichSummaryAnalysis,
  RichSummarySegments,
  RichSummaryLora,
} from '../../../src/modules/skills/rich-summary-v2-prompt';

const analysis = (core: string): RichSummaryAnalysis =>
  ({ core_argument: core }) as unknown as RichSummaryAnalysis;

const segments = (
  sections: Array<{ from_sec: number; to_sec: number; summary?: string }>,
  atoms: Array<{ text: string; type?: string; timestamp_sec?: number }>
): RichSummarySegments =>
  ({
    sections: sections.map((s, i) => ({
      idx: i,
      from_sec: s.from_sec,
      to_sec: s.to_sec,
      title: `S${i}`,
      summary: s.summary,
      relevance_pct: 50,
    })),
    atoms: atoms.map((a, i) => ({
      idx: i,
      type: a.type ?? 'fact',
      text: a.text,
      timestamp_sec: a.timestamp_sec,
    })),
  }) as RichSummarySegments;

const lora = (pairs: Array<{ q: string; a: string }>): RichSummaryLora => ({
  qa_pairs: pairs.map((p) => ({ level: 1 as const, q: p.q, a: p.a, context: 'video' as const })),
});

const baseInput = (): BuildBookInput => ({
  mandalaId: '72d5fe52-2f35-4a9e-8ef6-cd21629173ef',
  mandalaTitle: '영어 회화',
  generatedAt: '2026-06-21T00:00:00.000Z',
  cells: [
    {
      cellIndex: 0,
      title: 'Cell A',
      videos: [
        {
          videoId: 'dQw4w9WgXcQ',
          title: 'Video 1',
          analysis: analysis('central thesis'),
          segments: segments(
            [{ from_sec: 0, to_sec: 120, summary: 'first part' }],
            [
              { text: 'atom with ts', timestamp_sec: 60 },
              { text: 'atom no ts' }, // no timestamp → skipped from book, counted in pool
            ]
          ),
          lora: lora([{ q: 'q1', a: 'a1' }]),
        },
      ],
    },
    { cellIndex: 1, title: 'Cell B (empty)', videos: [] }, // honest skip → empty chapter
  ],
});

describe('build-book assembler', () => {
  it('produces a chapter per cell and passes the v2 validator', () => {
    const { book } = buildBookJson(baseInput());
    expect(book.chapters).toHaveLength(2);
    expect(() => parseBookJson(book)).not.toThrow();
  });

  it('keeps an empty chapter for a cell with no usable videos (honest skip)', () => {
    const { book } = buildBookJson(baseInput());
    const emptyChapter = book.chapters[1]!;
    expect(emptyChapter.ch).toBe(1);
    expect(emptyChapter.title).toBe('Cell B (empty)');
    expect(emptyChapter.sections).toEqual([]);
  });

  it('skips atoms without timestamp from the book but counts them in source_atoms', () => {
    const { book, sourceAtoms, sourceVideos } = buildBookJson(baseInput());
    const section = book.chapters[0]!.sections[0]!;
    expect(section.atoms).toHaveLength(1); // only the timestamped atom
    expect(section.atoms![0]!.ts).toBe(60);
    expect(sourceAtoms).toBe(2); // input pool counts BOTH atoms
    expect(sourceVideos).toBe(1);
  });

  it('sets seg_ref only when timestamp falls inside a section window', () => {
    const input = baseInput();
    input.cells[0]!.videos[0]!.segments = segments(
      [{ from_sec: 0, to_sec: 100 }],
      [
        { text: 'inside', timestamp_sec: 50 },
        { text: 'outside', timestamp_sec: 999 },
      ]
    );
    const { book } = buildBookJson(input);
    const atoms = book.chapters[0]!.sections[0]!.atoms!;
    expect(atoms[0]!.seg_ref).toEqual({ from_sec: 0, to_sec: 100 });
    expect(atoms[1]!.seg_ref).toBeUndefined(); // outside any window → omitted, not guessed
  });

  it('maps qa from lora.qa_pairs as-is (no context filter)', () => {
    const { book } = buildBookJson(baseInput());
    expect(book.chapters[0]!.sections[0]!.qa).toEqual([{ q: 'q1', a: 'a1' }]);
  });

  it('assembles narrative as concat of core_argument + section summaries', () => {
    const { book } = buildBookJson(baseInput());
    expect(book.chapters[0]!.sections[0]!.narrative).toBe('central thesis\n\nfirst part');
  });

  it('yields empty narrative (valid) when no core_argument and no summaries', () => {
    const input = baseInput();
    input.cells[0]!.videos[0]!.analysis = null;
    input.cells[0]!.videos[0]!.segments = segments(
      [{ from_sec: 0, to_sec: 10 }],
      [{ text: 'x', timestamp_sec: 1 }]
    );
    const { book } = buildBookJson(input);
    expect(book.chapters[0]!.sections[0]!.narrative).toBe('');
    expect(() => parseBookJson(book)).not.toThrow();
  });
});
