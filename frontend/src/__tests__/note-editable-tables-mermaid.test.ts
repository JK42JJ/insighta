/**
 * note-editable-tables-mermaid — [NOTE-EDITABLE-TABLES]
 *
 * Locks the Obsidian-style editability work:
 *   (a) GFM markdown → NATIVE editable table nodes with inline-parsed cells.
 *   (b) sanitizeNoteDoc MIGRATES a legacy `markdownTable` atom → native table on
 *       load (existing notes become editable without regeneration).
 *   (c) mermaid `source` attr round-trips through the schema (editable source).
 *   (d) equation `latex` attr (figureBlock kind=equation) round-trips (editable math).
 *
 * The schema is built from the EXACT extension set registered in useNoteDocument.ts
 * (now including the four @tiptap/extension-table nodes) — so a doc that loads here
 * loads in the live editor.
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
import { parseMarkdownToTiptap, buildTableNode } from '@/pages/learning/lib/markdown-to-tiptap';
import { sanitizeNoteDoc } from '@/pages/learning/lib/note-document-generator';
import type { TiptapDoc, TiptapNode } from '@/features/video-side-panel/lib/note-parser';

const lowlight = createLowlight(common);

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

// Mirror useNoteDocument.ts `extensions` exactly (incl. native table nodes).
const extensions = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false, blockquote: false }),
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

const txt = (n: TiptapNode | undefined): string =>
  (n?.content ?? []).map((c) => c.text ?? '').join('');

describe('(a) markdown → native editable table', () => {
  it('produces a schema-valid table whose cells hold inline-parsed marks', () => {
    const ns = parseMarkdownToTiptap('| Mode | Note |\n| --- | --- |\n| **INT8** | fast |');
    const doc: TiptapDoc = { type: 'doc', content: [...ns, { type: 'paragraph' }] };
    const schema = getSchema(extensions);
    // Must not throw (an unregistered node would collapse the live editor).
    const node = schema.nodeFromJSON(doc);
    let table: import('@tiptap/pm/model').Node | null = null;
    node.descendants((c) => {
      if (c.type.name === 'table') table = c;
    });
    expect(table).not.toBeNull();
    // **INT8** survived as a bold mark, not a literal "**INT8**".
    const bodyCell = ns[0].content![1].content![0];
    const inline = bodyCell.content![0].content!;
    expect(inline).toEqual([{ type: 'text', text: 'INT8', marks: [{ type: 'bold' }] }]);
  });
});

describe('(b) sanitizeNoteDoc migrates legacy markdownTable atom → native table', () => {
  const legacyDoc: TiptapDoc = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: '본문' }] },
      {
        type: 'markdownTable',
        attrs: {
          tableJson: JSON.stringify({ headers: ['항목', '값'], rows: [['지연', '**낮음**']] }),
        },
      },
    ],
  };

  it('replaces the markdownTable atom with a native editable table node', () => {
    const healed = sanitizeNoteDoc(legacyDoc);
    const types = (healed.content ?? []).map((n) => n.type);
    expect(types).toContain('table');
    expect(types).not.toContain('markdownTable');
    const table = (healed.content ?? []).find((n) => n.type === 'table')!;
    expect(txt(table.content![0].content![0].content![0])).toBe('항목'); // header cell
    // body cell parsed inline → bold mark
    const bodyCell = table.content![1].content![1];
    expect(bodyCell.content![0].content).toEqual([
      { type: 'text', text: '낮음', marks: [{ type: 'bold' }] },
    ]);
  });

  it('the migrated doc loads through the schema without collapsing', () => {
    const schema = getSchema(extensions);
    const healed = sanitizeNoteDoc(legacyDoc);
    const node = schema.nodeFromJSON(healed);
    expect(node.childCount).toBe(2);
    expect(node.child(1).type.name).toBe('table');
  });

  it('an empty markdownTable atom is dropped (no orphan node)', () => {
    const doc: TiptapDoc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'x' }] },
        { type: 'markdownTable', attrs: { tableJson: JSON.stringify({ headers: [], rows: [] }) } },
      ],
    };
    const healed = sanitizeNoteDoc(doc);
    expect((healed.content ?? []).map((n) => n.type)).toEqual(['paragraph']);
  });
});

describe('(c) mermaid source round-trips through the schema', () => {
  it('the source attr survives nodeFromJSON → toJSON', () => {
    const schema = getSchema(extensions);
    const src = 'flowchart LR\n A[Start] --> B[End]';
    const doc = { type: 'doc', content: [{ type: 'mermaid', attrs: { source: src } }] };
    const node = schema.nodeFromJSON(doc);
    expect(node.child(0).type.name).toBe('mermaid');
    expect(node.child(0).attrs['source']).toBe(src);
    // Persisted form (auto-save reads editor.getJSON()) keeps the edited source.
    const json = node.toJSON() as { content: TiptapNode[] };
    expect(json.content[0].attrs!['source']).toBe(src);
  });
});

describe('(d) equation latex round-trips through the schema', () => {
  it('figureBlock kind=equation latex survives nodeFromJSON → toJSON', () => {
    const schema = getSchema(extensions);
    const latex = 'E = mc^2';
    const doc = {
      type: 'doc',
      content: [{ type: 'figureBlock', attrs: { kind: 'equation', latex } }],
    };
    const node = schema.nodeFromJSON(doc);
    expect(node.child(0).attrs['kind']).toBe('equation');
    expect(node.child(0).attrs['latex']).toBe(latex);
    const json = node.toJSON() as { content: TiptapNode[] };
    expect(json.content[0].attrs!['latex']).toBe(latex);
  });
});

describe('buildTableNode — rectangular padding', () => {
  it('pads short rows to the column count', () => {
    const t = buildTableNode(['A', 'B', 'C'], [['1']]);
    expect(t.content![1].content).toHaveLength(3); // body row padded to 3 cells
    expect(txt(t.content![1].content![2].content![0])).toBe(''); // empty padded cell
  });
});
