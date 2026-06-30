/**
 * markdown-to-tiptap — [NOTE-FULL-TOOLSET] deterministic markdown → TipTap nodes.
 * Locks each construct the book pipeline emits: inline marks, lists, callouts,
 * mermaid, GFM tables, blockquotes, headings — plus the buildInitialNoteDoc
 * integration (rich narrative → full tool node set) and the markdown-less
 * byte-stability guarantee.
 */
import { describe, it, expect } from 'vitest';
import { parseMarkdownToTiptap, parseInline } from '@/pages/learning/lib/markdown-to-tiptap';
import { buildInitialNoteDoc } from '@/pages/learning/lib/note-document-generator';
import type { MandalaBookData } from '@/shared/lib/api-client';
import type { TiptapNode } from '@/features/video-side-panel/lib/note-parser';

const types = (ns: TiptapNode[]): string[] => ns.map((n) => n.type);
const txt = (n: TiptapNode | undefined): string =>
  (n?.content ?? []).map((c) => c.text ?? '').join('');

describe('parseInline — marks', () => {
  it('bold / italic / code / link', () => {
    expect(parseInline('plain')).toEqual([{ type: 'text', text: 'plain' }]);

    const bold = parseInline('a **b** c');
    expect(bold).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'text', text: 'b', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' c' },
    ]);

    const italic = parseInline('x *y* z');
    expect(italic[1]).toEqual({ type: 'text', text: 'y', marks: [{ type: 'italic' }] });

    const code = parseInline('use `npm run dev`');
    expect(code[1]).toEqual({ type: 'text', text: 'npm run dev', marks: [{ type: 'code' }] });

    const link = parseInline('see [docs](https://x.io)');
    expect(link[1]).toEqual({
      type: 'text',
      text: 'docs',
      marks: [{ type: 'link', attrs: { href: 'https://x.io', target: '_blank' } }],
    });
  });

  it('composes nested marks (bold > italic)', () => {
    const ns = parseInline('**bold _inner_**');
    expect(ns[0]).toEqual({ type: 'text', text: 'bold ', marks: [{ type: 'bold' }] });
    expect(ns[1]).toEqual({
      type: 'text',
      text: 'inner',
      marks: [{ type: 'bold' }, { type: 'italic' }],
    });
  });
});

describe('parseMarkdownToTiptap — block constructs', () => {
  it('blank-line separated paragraphs (soft-wrapped lines joined)', () => {
    const ns = parseMarkdownToTiptap('line one\nline two\n\nsecond para');
    expect(types(ns)).toEqual(['paragraph', 'paragraph']);
    expect(txt(ns[0])).toBe('line one line two');
    expect(txt(ns[1])).toBe('second para');
  });

  it('bullet list', () => {
    const ns = parseMarkdownToTiptap('- first\n- second');
    expect(ns[0].type).toBe('bulletList');
    expect(ns[0].content).toHaveLength(2);
    expect(ns[0].content![0].type).toBe('listItem');
    expect(txt(ns[0].content![0].content![0])).toBe('first');
  });

  it('ordered list', () => {
    const ns = parseMarkdownToTiptap('1. alpha\n2. beta');
    expect(ns[0].type).toBe('orderedList');
    expect(ns[0].content).toHaveLength(2);
  });

  it('headings (capped at level 3)', () => {
    const ns = parseMarkdownToTiptap('# h1\n\n## h2\n\n#### h4-capped');
    expect(ns.map((n) => n.attrs?.['level'])).toEqual([1, 2, 3]);
    expect(txt(ns[0])).toBe('h1');
  });

  it('callout → callout node with kind + parsed body', () => {
    const ns = parseMarkdownToTiptap('> [!warning] careful\n> second body line');
    expect(ns[0].type).toBe('callout');
    expect(ns[0].attrs?.['kind']).toBe('warning');
    // body is parsed (paragraph), first line + continuation joined.
    expect(ns[0].content![0].type).toBe('paragraph');
    expect(txt(ns[0].content![0])).toBe('careful second body line');
  });

  it('callout kinds note/tip default-normalize', () => {
    expect(parseMarkdownToTiptap('> [!note] n')[0].attrs?.['kind']).toBe('note');
    expect(parseMarkdownToTiptap('> [!tip] t')[0].attrs?.['kind']).toBe('tip');
  });

  it('plain blockquote (no [!type]) → blockquote, NOT a callout', () => {
    const ns = parseMarkdownToTiptap('> just a quote');
    expect(ns[0].type).toBe('blockquote');
    expect(txt(ns[0].content![0])).toBe('just a quote');
  });

  it('mermaid fence → mermaid node holding the source', () => {
    const ns = parseMarkdownToTiptap('```mermaid\ngraph TD\nA-->B\n```');
    expect(ns[0].type).toBe('mermaid');
    expect(ns[0].attrs?.['source']).toBe('graph TD\nA-->B');
  });

  it('non-mermaid fence → codeBlock with language', () => {
    const ns = parseMarkdownToTiptap('```ts\nconst x = 1;\n```');
    expect(ns[0].type).toBe('codeBlock');
    expect(ns[0].attrs?.['language']).toBe('ts');
    expect(ns[0].content![0].text).toBe('const x = 1;');
  });

  it('GFM table → markdownTable node with {headers, rows}', () => {
    const ns = parseMarkdownToTiptap('| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |');
    expect(ns[0].type).toBe('markdownTable');
    expect(JSON.parse(ns[0].attrs!['tableJson'] as string)).toEqual({
      headers: ['A', 'B'],
      rows: [
        ['1', '2'],
        ['3', '4'],
      ],
    });
  });

  it('--- alone → horizontalRule (not a table)', () => {
    expect(types(parseMarkdownToTiptap('para\n\n---\n\nmore'))).toEqual([
      'paragraph',
      'horizontalRule',
      'paragraph',
    ]);
  });

  it('mixed document keeps order', () => {
    const md = 'Intro **bold**.\n\n- a\n- b\n\n> [!tip] hi\n\n```mermaid\ngraph TD\n```';
    expect(types(parseMarkdownToTiptap(md))).toEqual([
      'paragraph',
      'bulletList',
      'callout',
      'mermaid',
    ]);
  });

  it('empty / whitespace input → []', () => {
    expect(parseMarkdownToTiptap('')).toEqual([]);
    expect(parseMarkdownToTiptap('   \n  ')).toEqual([]);
    expect(parseMarkdownToTiptap(null)).toEqual([]);
  });
});

describe('buildInitialNoteDoc — rich narrative integration', () => {
  const richBook = (narrative: string): MandalaBookData =>
    ({
      chapters: [
        {
          ch: 0,
          title: '챕터',
          intro: '이 장 소개', // → narrative mode
          sections: [{ title: '토픽', narrative, atoms: [] }],
        },
      ],
    }) as MandalaBookData;

  it('emits callout + mermaid + markdownTable nodes from rich narrative', () => {
    const doc = buildInitialNoteDoc(
      richBook(
        '도입 문장.\n\n> [!note] 주의점\n\n```mermaid\ngraph TD\nA-->B\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |'
      )
    );
    const present = new Set((doc.content ?? []).map((n) => n.type));
    expect(present.has('callout')).toBe(true);
    expect(present.has('mermaid')).toBe(true);
    expect(present.has('markdownTable')).toBe(true);
  });

  it('markdown-less narrative → single paragraph (byte-stable woven body)', () => {
    const doc = buildInitialNoteDoc(richBook('한 줄 평범한 산문 본문이다'));
    const paras = (doc.content ?? []).filter(
      (n) => n.type === 'paragraph' && txt(n) === '한 줄 평범한 산문 본문이다'
    );
    expect(paras).toHaveLength(1);
    // no toolset nodes leaked from plain prose.
    const present = new Set((doc.content ?? []).map((n) => n.type));
    expect(present.has('callout')).toBe(false);
    expect(present.has('mermaid')).toBe(false);
    expect(present.has('markdownTable')).toBe(false);
  });
});
