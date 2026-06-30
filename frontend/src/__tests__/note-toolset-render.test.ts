/**
 * note-toolset-render — [NOTE-FULL-TOOLSET regression]
 *
 * Reproduces the "learning note renders EMPTY" bug: a well-formed persisted
 * content_json (heading + paragraph + callout + mermaid + markdownTable + list +
 * blockquote + bold) silently collapses to a single empty paragraph because
 * `schema.nodeFromJSON(doc)` throws and TipTap (enableContentCheck:false) swallows
 * the error and falls back to an empty doc.
 *
 * The schema here is built from the EXACT extension set in useNoteDocument.ts.
 */
import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Blockquote from '@tiptap/extension-blockquote';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { createLowlight, common } from 'lowlight';

import { VideoBlock } from '@/pages/learning/lib/video-block';
import { FigureBlock } from '@/pages/learning/lib/figure-block';
import { Callout } from '@/pages/learning/lib/callout-block';
import { MermaidBlock } from '@/pages/learning/lib/mermaid-block';
import { MarkdownTable } from '@/pages/learning/lib/markdown-table-block';
import { buildInitialNoteDoc, sanitizeNoteDoc } from '@/pages/learning/lib/note-document-generator';
import type { MandalaBookData } from '@/shared/lib/api-client';

const lowlight = createLowlight(common);

// Mirror useNoteDocument.ts KeyPointBlockquote.
const KeyPointBlockquote = Blockquote.extend({
  addAttributes() {
    return {
      keypoint: {
        default: false,
        parseHTML: (el) => el.getAttribute('data-keypoint') === 'true',
        renderHTML: (attrs) => (attrs['keypoint'] ? { 'data-keypoint': 'true' } : {}),
      },
    };
  },
});

// Mirror useNoteDocument.ts `extensions` exactly.
const extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    codeBlock: false,
    blockquote: false,
  }),
  KeyPointBlockquote,
  Placeholder.configure({ placeholder: 'x' }),
  Link.configure({ openOnClick: false, autolink: true }),
  CodeBlockLowlight.configure({ lowlight }),
  VideoBlock.configure({ HTMLAttributes: {} }),
  FigureBlock.configure({ HTMLAttributes: {} }),
  Callout.configure({ HTMLAttributes: {} }),
  MermaidBlock.configure({ HTMLAttributes: {} }),
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  MarkdownTable.configure({ HTMLAttributes: {} }),
];

// A doc shaped like the real persisted content_json (62KB) — the three new node
// types plus a heading, paragraph (with bold), list and blockquote.
const sampleDoc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '학습 정리' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '핵심은 ' },
        { type: 'text', text: '아키텍처', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' 이다.' },
      ],
    },
    {
      type: 'callout',
      attrs: { kind: 'warning' },
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '주의: 트레이드오프가 있다.' }] },
      ],
    },
    {
      type: 'mermaid',
      attrs: { source: 'flowchart LR\n A[Start] --> B[End]\n' },
    },
    {
      type: 'markdownTable',
      attrs: {
        tableJson: JSON.stringify({ headers: ['항목', '값'], rows: [['지연', '낮음']] }),
      },
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '항목1' }] }],
        },
      ],
    },
    {
      type: 'blockquote',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '인용문' }] }],
    },
  ],
};

describe('[NOTE-FULL-TOOLSET] persisted note doc round-trips through the schema', () => {
  it('builds the schema without throwing', () => {
    expect(() => getSchema(extensions)).not.toThrow();
  });

  it('nodeFromJSON does NOT collapse the doc (all node types preserved)', () => {
    const schema = getSchema(extensions);
    // This is the exact call TipTap makes internally (errorOnInvalidContent:false
    // swallows the throw → empty fallback). If it throws here, the live editor
    // would render a single empty paragraph.
    const node = schema.nodeFromJSON(sampleDoc);

    // The doc must keep all 7 top-level blocks — not collapse to 1 empty paragraph.
    expect(node.childCount).toBe(sampleDoc.content.length);

    const topTypes: string[] = [];
    node.forEach((child) => topTypes.push(child.type.name));
    expect(topTypes).toEqual([
      'heading',
      'paragraph',
      'callout',
      'mermaid',
      'markdownTable',
      'bulletList',
      'blockquote',
    ]);

    // Attributes survive the JSON round-trip.
    const callout = node.child(2);
    expect(callout.attrs['kind']).toBe('warning');
    const mermaid = node.child(3);
    expect(mermaid.attrs['source']).toContain('flowchart');
    const table = node.child(4);
    expect(typeof table.attrs['tableJson']).toBe('string');
    expect(table.attrs['tableJson']).toContain('항목');
  });
});

// A rich-markdown narrative exercising EVERY construct the book pipeline emits
// (heading, bold/italic/code/link inline marks, ordered + bullet lists, callout,
// mermaid, GFM table, blockquote) — fed through the REAL generator so the doc
// shape matches a persisted 62KB content_json.
const RICH_NARRATIVE = [
  '## 개요',
  '',
  '핵심은 **아키텍처** 와 *트레이드오프* 이며 `latency` 가 중요하다. 자세히는 [문서](https://example.com) 참고.',
  '',
  '> [!warning]',
  '> 캐시 무효화는 어렵다.',
  '',
  '```mermaid',
  'flowchart LR',
  '  A[Start] --> B[End]',
  '```',
  '',
  '| 항목 | 값 |',
  '| --- | --- |',
  '| 지연 | 낮음 |',
  '',
  '1. 첫째 단계',
  '2. 둘째 단계',
  '',
  '- 포인트 A',
  '- 포인트 B',
  '',
  '> 평범한 인용문이다.',
].join('\n');

const richBook: MandalaBookData = {
  chapters: [
    {
      ch: 0,
      title: '챕터 1',
      intro: '이 챕터의 도입부 문단.', // populated intro → narrativeMode = true
      sections: [
        {
          title: '섹션 1',
          narrative: RICH_NARRATIVE,
          atoms: [{ vid: 'abc123', ts: 12, text: '원자 텍스트', type: 'fact' }],
          keyPoint: '핵심 포인트는 **단순함** 이다.', // → keypoint blockquote
        },
      ],
    },
  ],
} as unknown as MandalaBookData;

// A book where a SECTION carries an empty title (the BE rich-markdown pipeline can
// emit a blank section.title). The generator's heading() helper emits the title as
// a text node unconditionally → ProseMirror forbids empty text nodes → throw.
const emptyTitleBook: MandalaBookData = {
  chapters: [
    {
      ch: 0,
      title: '챕터 1',
      intro: '도입부.',
      sections: [
        {
          title: '', // empty section title — heading(3, '') → empty text node
          narrative: '본문 한 문단.',
          atoms: [],
          keyPoint: '',
        },
      ],
    },
  ],
} as unknown as MandalaBookData;

describe('[NOTE-FULL-TOOLSET] generator output round-trips through the schema', () => {
  it('buildInitialNoteDoc with an EMPTY section title does NOT collapse (regression)', () => {
    const doc = buildInitialNoteDoc(emptyTitleBook);
    const schema = getSchema(extensions);
    // This is the exact call TipTap makes; if it throws, the live editor collapses
    // to one empty paragraph (errorOnInvalidContent:false swallows the throw).
    expect(() => schema.nodeFromJSON(doc)).not.toThrow();
  });

  it('buildInitialNoteDoc rich-narrative doc does NOT collapse', () => {
    const doc = buildInitialNoteDoc(richBook);
    const schema = getSchema(extensions);

    // Reproduces the live bug: if this throws, TipTap (errorOnInvalidContent:false)
    // swallows it and renders a single empty paragraph.
    const node = schema.nodeFromJSON(doc);

    // The generated doc has many blocks; an empty fallback would be 1 paragraph.
    expect(node.childCount).toBeGreaterThan(5);

    const typeSet = new Set<string>();
    node.descendants((child) => {
      typeSet.add(child.type.name);
    });
    // Every rich construct must survive — not be swallowed into an empty doc.
    for (const t of [
      'callout',
      'mermaid',
      'table', // native editable table (was markdownTable atom)
      'orderedList',
      'bulletList',
      'blockquote',
      'videoBlock',
    ]) {
      expect(typeSet.has(t)).toBe(true);
    }
  });
});

describe('[NOTE-FULL-TOOLSET] sanitizeNoteDoc heals already-persisted broken docs', () => {
  // The real 62KB content_json was persisted by the pre-fix generator: a heading
  // built from a blank section title carries an empty text node. Fixing the
  // generator only helps NEW docs — existing rows must be healed on load.
  const persistedBroken = {
    type: 'doc' as const,
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '챕터' }] },
      // The poison node: an empty text node inside a section heading.
      { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: '' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '본문' }] },
      {
        type: 'callout',
        attrs: { kind: 'note' },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '메모' }] }],
      },
    ],
  };

  it('raw persisted doc throws (reproduces the empty editor)', () => {
    const schema = getSchema(extensions);
    expect(() => schema.nodeFromJSON(persistedBroken)).toThrow(/Empty text nodes/);
  });

  it('sanitized doc loads without collapsing and preserves content', () => {
    const schema = getSchema(extensions);
    const healed = sanitizeNoteDoc(persistedBroken);
    const node = schema.nodeFromJSON(healed);
    // All 4 blocks survive (the empty h3 becomes an empty-content heading, valid).
    expect(node.childCount).toBe(4);
    expect(node.child(0).textContent).toBe('챕터');
    expect(node.child(1).type.name).toBe('heading');
    expect(node.child(1).childCount).toBe(0); // empty text node dropped
    expect(node.child(2).textContent).toBe('본문');
    expect(node.child(3).type.name).toBe('callout');
  });
});
