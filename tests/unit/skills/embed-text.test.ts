/**
 * Canonical video embed-text SSOT (iv-A, 2026-07-10).
 *
 * Byte-identical guard (supervisor condition 3): the v3 gate's title_desc embed
 * MUST equal the rule that built video_pool_embeddings, or a pooled-cache hit
 * and a live embed for the same video would produce different vectors and
 * silently skew ranking. The pool rule (collector buildEmbedText) is
 * `${title}\n${desc.slice(0,200)}` — no trim, no whitespace-collapse.
 */
import {
  buildVideoEmbedText,
  candidateEmbedText,
  EMBED_DESC_SNIPPET_LEN,
} from '@/skills/plugins/iks-scorer/embed-text';

describe('buildVideoEmbedText — byte-identical to the pool rule', () => {
  test('title + desc joined by a single newline (exact pool format)', () => {
    expect(buildVideoEmbedText('My Title', 'My Description')).toBe('My Title\nMy Description');
  });

  test('no description → title only (no trailing newline)', () => {
    expect(buildVideoEmbedText('Only Title', null)).toBe('Only Title');
    expect(buildVideoEmbedText('Only Title', '')).toBe('Only Title');
    expect(buildVideoEmbedText('Only Title', undefined)).toBe('Only Title');
  });

  test('description truncated to EMBED_DESC_SNIPPET_LEN (200), title kept whole', () => {
    const longDesc = 'x'.repeat(500);
    const out = buildVideoEmbedText('T', longDesc);
    expect(out).toBe(`T\n${'x'.repeat(EMBED_DESC_SNIPPET_LEN)}`);
    expect(out.length).toBe(1 /*T*/ + 1 /*\n*/ + EMBED_DESC_SNIPPET_LEN);
  });

  test('does NOT trim or collapse whitespace (pool did not either)', () => {
    // leading/inner spaces preserved verbatim so hit/miss vectors match.
    expect(buildVideoEmbedText('  spaced  ', '  desc  with   gaps ')).toBe(
      '  spaced  \n  desc  with   gaps '
    );
  });

  test('exact re-implementation of the collector rule for arbitrary inputs', () => {
    const rule = (title: string, description: string | null) => {
      const desc = (description ?? '').slice(0, 200);
      return desc ? `${title}\n${desc}` : title;
    };
    const cases: Array<[string, string | null]> = [
      ['한국어 제목', '설명 텍스트'],
      ['emoji 🎸 title', null],
      ['t', 'd'.repeat(201)],
      ['', 'desc only'],
    ];
    for (const [t, d] of cases) {
      expect(buildVideoEmbedText(t, d)).toBe(rule(t, d));
    }
  });
});

describe('candidateEmbedText — gate mode routing', () => {
  test('title mode → title only (legacy, no regression)', () => {
    expect(candidateEmbedText('title', 'A Title', 'ignored desc')).toBe('A Title');
  });

  test('title_desc mode → pool-aligned title+desc', () => {
    expect(candidateEmbedText('title_desc', 'A Title', 'A Desc')).toBe('A Title\nA Desc');
  });

  test('title_desc with null desc → title (still co-comparable with title-only pool rows)', () => {
    expect(candidateEmbedText('title_desc', 'A Title', null)).toBe('A Title');
  });
});
