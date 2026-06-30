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

describe('book-schema — NOTE-DENSITY ① keyPoints back-compat (additive, optional)', () => {
  it('accepts a section with keyPoints present', () => {
    const b = validBook();
    // Use bracket notation: noPropertyAccessFromIndexSignature is strict in this project.
    (b.chapters[0]!.sections[0] as Record<string, unknown>)['keyPoints'] = [
      'INT8 양자화: 메모리 75%↓, 성능 손실 1-2%',
      '배치 추론 병렬화: 처리량 4×↑',
    ];
    const parsed = parseBookJson(b);
    expect(firstSection(parsed).keyPoints).toEqual([
      'INT8 양자화: 메모리 75%↓, 성능 손실 1-2%',
      '배치 추론 병렬화: 처리량 4×↑',
    ]);
  });

  it('accepts a section WITHOUT keyPoints — existing books stay valid', () => {
    const b = validBook(); // no keyPoints field
    const parsed = parseBookJson(b);
    expect(firstSection(parsed).keyPoints).toBeUndefined();
  });

  it('rejects a keyPoints value that is not an array', () => {
    const b = validBook();
    (b.chapters[0]!.sections[0] as Record<string, unknown>)['keyPoints'] = 'not-an-array';
    expect(bookJsonSchema.safeParse(b).success).toBe(false);
  });
});

describe('book-schema — NOTE-DENSITY ①-v2 keyPoint prose synthesis (additive, optional)', () => {
  it('accepts a section with keyPoint (prose string)', () => {
    const b = validBook();
    (b.chapters[0]!.sections[0] as Record<string, unknown>)['keyPoint'] =
      'INT8 양자화는 메모리를 75% 줄이면서 성능 손실을 1-2%로 억제한다. 배치 추론과 결합하면 처리량이 4배 향상된다.';
    const parsed = parseBookJson(b);
    expect(firstSection(parsed).keyPoint).toMatch(/INT8/);
  });

  it('accepts a section WITHOUT keyPoint — back-compat: existing books stay valid', () => {
    const b = validBook(); // no keyPoint field
    const parsed = parseBookJson(b);
    expect(firstSection(parsed).keyPoint).toBeUndefined();
  });

  it('accepts both keyPoint and keyPoints on the same section', () => {
    const b = validBook();
    const sec = b.chapters[0]!.sections[0] as Record<string, unknown>;
    sec['keyPoint'] = '핵심 통찰 요약 문장.';
    sec['keyPoints'] = ['항목 A', '항목 B'];
    const parsed = parseBookJson(b);
    expect(firstSection(parsed).keyPoint).toBe('핵심 통찰 요약 문장.');
    expect(firstSection(parsed).keyPoints).toEqual(['항목 A', '항목 B']);
  });

  it('rejects a keyPoint value that is not a string', () => {
    const b = validBook();
    (b.chapters[0]!.sections[0] as Record<string, unknown>)['keyPoint'] = 42;
    expect(bookJsonSchema.safeParse(b).success).toBe(false);
  });

  it('narrative may contain rich markdown (newlines, bold, lists, callouts)', () => {
    const b = validBook();
    // Multi-line rich markdown — schema accepts any string; FE parser handles structure.
    b.chapters[0]!.sections[0]!.narrative =
      '**양자화**는 모델 크기를 줄이는 핵심 기술이다.\n\n- INT8: 메모리 75%↓\n- FP16: 균형점\n\n> [!note]\n> 성능 손실은 태스크에 따라 다르다.';
    expect(() => parseBookJson(b)).not.toThrow();
    expect(firstSection(parseBookJson(b)).narrative).toContain('**양자화**');
  });
});

describe('book-schema — CP504 loop-2 additive keys (G-SHAPE: additive, no rejection)', () => {
  it('legacy book WITHOUT references/research/verification.checks still parses', () => {
    expect(() => parseBookJson(validBook())).not.toThrow();
  });

  it('book WITH references[] + chapter.research[] + section.verification.checks[] parses', () => {
    const book = validBook();
    book.references = [{ id: 1, title: 'Source A', url: 'https://ex.com/a' }];
    book.chapters[0]!.research = [{ perspective: 'gap X', fact: 'web fact', ref_id: 1 }];
    book.chapters[0]!.sections[0]!.verification = {
      status: 'verified',
      checks: [
        {
          atom_text: 'claim a',
          verdict: 'FALSE',
          evidence_url: 'https://ex.com/a',
          correction: 'fixed',
        },
        { atom_text: 'claim b', verdict: 'TRUE' },
      ],
    };
    const parsed = parseBookJson(book);
    expect(parsed.references?.[0]?.url).toBe('https://ex.com/a');
    expect(parsed.chapters[0]?.research?.[0]?.ref_id).toBe(1);
    expect(parsed.chapters[0]?.sections[0]?.verification?.checks?.[0]?.verdict).toBe('FALSE');
  });

  it('rejects an invalid factcheck verdict', () => {
    const book = validBook();
    book.chapters[0]!.sections[0]!.verification = {
      status: 'verified',
      checks: [{ atom_text: 'x', verdict: 'BOGUS' as 'TRUE' }],
    };
    expect(bookJsonSchema.safeParse(book).success).toBe(false);
  });
});
