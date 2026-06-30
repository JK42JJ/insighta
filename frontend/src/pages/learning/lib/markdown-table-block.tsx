/**
 * MarkdownTable — read-only TipTap atomic node for GFM tables in note narrative.
 *
 * `@tiptap/extension-table` is not installed (and a fully editable table is out
 * of scope for generated note bodies), so this is a focused read-only node that
 * mirrors the figure-block.tsx pattern: headers/rows are stored as a compact JSON
 * string in the `tableJson` attribute and rendered as a note-mode-styled HTML
 * table. renderHTML emits inert markup for editor.getHTML(); live UI is the
 * React NodeView.
 */
import { useMemo } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';

export interface MarkdownTableOptions {
  HTMLAttributes: Record<string, unknown>;
}

interface ParsedTable {
  headers: string[];
  rows: string[][];
}

function parseTableJson(json: string | null | undefined): ParsedTable | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as ParsedTable;
    const headers = Array.isArray(parsed.headers) ? parsed.headers.map(String) : [];
    const rows = Array.isArray(parsed.rows)
      ? parsed.rows.map((r) => (Array.isArray(r) ? r.map(String) : [String(r)]))
      : [];
    if (headers.length === 0 && rows.length === 0) return null;
    return { headers, rows };
  } catch {
    return null;
  }
}

function MarkdownTableNodeView({ node }: NodeViewProps) {
  const table = useMemo(
    () => parseTableJson(node.attrs['tableJson'] as string | null),
    [node.attrs]
  );

  if (!table) {
    return <NodeViewWrapper className="note-md-table-block hidden" data-type="markdown-table" />;
  }

  return (
    <NodeViewWrapper className="note-md-table-block" data-type="markdown-table">
      <table className="note-md-table">
        {table.headers.length > 0 && (
          <thead>
            <tr>
              {table.headers.map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {table.rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </NodeViewWrapper>
  );
}

export const MarkdownTable = Node.create<MarkdownTableOptions>({
  name: 'markdownTable',

  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      tableJson: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-table'),
        renderHTML: (attrs) =>
          attrs['tableJson'] ? { 'data-table': String(attrs['tableJson']) } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="markdown-table"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-type': 'markdown-table',
        class: 'note-md-table-block',
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MarkdownTableNodeView);
  },
});
