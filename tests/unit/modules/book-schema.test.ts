/**
 * book-schema — mandala_books.book_json v2 contract validation.
 *
 * Pins the shape the 살붙임 (auto-fill) job must emit, grounded in the observed
 * prod row (mandala 72d5…173ef: 8 chapters / 23 sections / 98 atoms, every
 * section has {title, narrative, atoms, qa}, every atom {vid, ts, text}):
 *   - well-formed v2 book parses
 *   - schema_version must be literal 2
 *   - relevance/Fork-D fields are optional (current data omits them)
 *   - atom.type optional (prod 0/98), seg_ref optional time anchor
 *   - source_atoms (input pool) may exceed atoms actually in the book
 *   - structural violations throw
 */

import {
  parseBookJson,
  safeParseBookJson,
  bookJsonSchema,
  type BookJson,
  type BookJsonInput,
  type BookSection,
} from '../../../src/modules/mandala-book/book-schema';

const validBook = (): BookJsonInput => ({
  schema_version: 2 as const,
  mandala_id: '72d5fe52-2f35-4a9e-8ef6-cd21629173ef',
  mandala_title: '영어 회화',
  generated_at: '2026-06-21T00:00:00.000Z',
  source_videos: 26,
  source_atoms: 213, // input pool — larger than atoms included below
  chapters: [
    {
      ch: 1,
      title: 'Chapter 1',
      intro: 'intro text',
      sections: [
        {
          title: 'Section 1',
          narrative: '영어 회화의 80%는 고정된 슬롯에…',
          atoms: [
            { vid: 'dQw4w9WgXcQ', ts: 120, text: 'atom text' },
            { vid: 'dQw4w9WgXcQ', ts: 240, text: 'atom 2', type: 'tip' },
          ],
          qa: [{ q: 'q?', a: 'a.' }],
        },
      ],
    },
  ],
});

/** First section of the first chapter — keeps assertions readable under strict indexing. */
const firstSection = (b: BookJson): BookSection => b.chapters[0]!.sections[0]!;

describe('book-schema v2 contract', () => {
  it('parses a well-formed v2 book', () => {
    const book = parseBookJson(validBook());
    expect(book.chapters).toHaveLength(1);
    expect(firstSection(book).atoms).toHaveLength(2);
  });

  it('defaults optional section arrays (atoms/qa) to empty', () => {
    const b = validBook();
    delete (b.chapters[0]!.sections[0] as { qa?: unknown }).qa;
    const parsed = parseBookJson(b);
    expect(firstSection(parsed).qa).toEqual([]);
  });

  it('rejects a non-2 schema_version', () => {
    const b = { ...validBook(), schema_version: 1 };
    expect(() => parseBookJson(b)).toThrow();
    expect(safeParseBookJson(b).success).toBe(false);
  });

  it('accepts source_atoms (input pool) larger than included atoms', () => {
    const b = validBook();
    b.source_atoms = 213; // pool
    expect(parseBookJson(b).source_atoms).toBe(213);
  });

  it('keeps atom.type and seg_ref optional', () => {
    const base = validBook();
    const book = {
      ...base,
      chapters: [
        {
          ...base.chapters[0]!,
          sections: [
            {
              ...base.chapters[0]!.sections[0]!,
              atoms: [
                {
                  vid: 'dQw4w9WgXcQ',
                  ts: 30,
                  text: 'no type',
                  seg_ref: { from_sec: 0, to_sec: 120 },
                },
              ],
            },
          ],
        },
      ],
    };
    const parsed = parseBookJson(book);
    const atom = firstSection(parsed).atoms[0]!;
    expect(atom.seg_ref).toEqual({ from_sec: 0, to_sec: 120 });
    expect(atom.type).toBeUndefined();
  });

  it('accepts Fork-D placeholders as null/absent (fill job not implemented)', () => {
    const base = validBook();
    const book = {
      ...base,
      completeness: null,
      chapters: [
        {
          ...base.chapters[0]!,
          sections: [{ ...base.chapters[0]!.sections[0]!, provenance: null, verification: null }],
        },
      ],
    };
    expect(safeParseBookJson(book).success).toBe(true);
  });

  it('parses a populated Fork-D verification block when present', () => {
    const base = validBook();
    const book = {
      ...base,
      chapters: [
        {
          ...base.chapters[0]!,
          sections: [
            {
              ...base.chapters[0]!.sections[0]!,
              verification: { status: 'unverified', notes: 'pending' },
            },
          ],
        },
      ],
    };
    const parsed = parseBookJson(book);
    expect(firstSection(parsed).verification?.status).toBe('unverified');
  });

  it('rejects a missing required field (mandala_id)', () => {
    const { mandala_id, ...withoutMandalaId } = validBook();
    void mandala_id;
    expect(() => parseBookJson(withoutMandalaId)).toThrow();
  });

  it('rejects an atom without a video id', () => {
    const base = validBook();
    const book = {
      ...base,
      chapters: [
        {
          ...base.chapters[0]!,
          sections: [{ ...base.chapters[0]!.sections[0]!, atoms: [{ ts: 1, text: 'x' } as never] }],
        },
      ],
    };
    expect(bookJsonSchema.safeParse(book).success).toBe(false);
  });
});
