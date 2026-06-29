/**
 * FigureBlock — TipTap atomic Node for [CV-NOTE-WIRE] computer-vision figures
 * attached to a note section (equation / chart / diagram / table).
 *
 * Mirrors the VideoBlock pattern (custom Node + ReactNodeViewRenderer) so the
 * doc shape stays schema-valid — an unregistered node type would make
 * ProseMirror throw on doc load and break the note.
 *
 *  - kind='equation' → lazy-loads KaTeX (dynamic import; only when an equation
 *    figure mounts) and renders displayMode HTML.
 *  - kind∈{chart,diagram} → renders the server-generated inline SVG (sanitized).
 *  - kind='table' → renders an HTML <table> from struct.headers/rows.
 *  The broken pod-local asset_path <img> path was removed.
 *
 * Inert until the backend populates section.figures (flag-gated server-side).
 */
import { useEffect, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';

export interface FigureBlockOptions {
  HTMLAttributes: Record<string, unknown>;
}

export type FigureKind = 'chart' | 'diagram' | 'table' | 'equation';

export interface FigureStruct {
  headers?: string[];
  rows?: string[][];
}

export interface FigureBlockAttrs {
  kind: FigureKind;
  latex: string | null;
  svg: string | null;
  struct: FigureStruct | null;
  caption: string | null;
}

// Minimal SVG sanitizer (no DOMPurify dep). Server SVG is graphviz/matplotlib
// output, but we still strip the XSS surface before dangerouslySetInnerHTML:
// <script>, on* event handlers, <foreignObject>, external <image> refs and
// javascript: URLs.
function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/<image\b[\s\S]*?>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|xlink:href)\s*=\s*("javascript:[^"]*"|'javascript:[^']*'|javascript:[^\s>]+)/gi, '');
}

// Lazy KaTeX render — dynamic import keeps the heavy lib out of the main bundle.
function EquationView({ latex }: { latex: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const katex = (await import('katex')).default;
        await import('katex/dist/katex.min.css');
        if (cancelled) return;
        setHtml(katex.renderToString(latex, { throwOnError: false, displayMode: true }));
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [latex]);

  // Fallback to raw LaTeX text while loading / on failure (never blank).
  if (failed || html === null) {
    return <code className="note-figure-latex-fallback">{latex}</code>;
  }
  // KaTeX output is math markup (no user scripts); latex is backend-verified.
  return <div className="note-figure-equation" dangerouslySetInnerHTML={{ __html: html }} />;
}

// Table figure → semantic HTML <table> from struct headers/rows.
function TableView({ struct }: { struct: FigureStruct }) {
  const headers = Array.isArray(struct.headers) ? struct.headers : [];
  const rows = Array.isArray(struct.rows) ? struct.rows : [];
  if (headers.length === 0 && rows.length === 0) return null;
  return (
    <figure className="note-figure-table">
      <table>
        {headers.length > 0 && (
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function FigureBlockNodeView({ node }: NodeViewProps) {
  const attrs = node.attrs as unknown as FigureBlockAttrs;

  let body: JSX.Element | null = null;
  if (attrs.kind === 'equation' && attrs.latex) {
    body = <EquationView latex={attrs.latex} />;
  } else if (attrs.kind === 'table' && attrs.struct) {
    body = <TableView struct={attrs.struct} />;
  } else if ((attrs.kind === 'chart' || attrs.kind === 'diagram') && attrs.svg) {
    // SVG is server-generated; sanitized above to close the XSS surface.
    const html = sanitizeSvg(attrs.svg);
    body = (
      <figure className="note-figure-image">
        <div className="note-figure-svg" dangerouslySetInnerHTML={{ __html: html }} />
        {attrs.caption && <figcaption>{attrs.caption}</figcaption>}
      </figure>
    );
  }

  // Missing/empty payload → render nothing inside the wrapper (no broken img).
  return (
    <NodeViewWrapper className="note-figure-block" data-kind={attrs.kind}>
      {body}
    </NodeViewWrapper>
  );
}

export const FigureBlock = Node.create<FigureBlockOptions>({
  name: 'figureBlock',

  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      kind: {
        default: 'chart',
        parseHTML: (el) => el.getAttribute('data-kind') ?? 'chart',
        renderHTML: (attrs) => ({ 'data-kind': String(attrs['kind']) }),
      },
      latex: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-latex'),
        renderHTML: (attrs) => (attrs['latex'] ? { 'data-latex': String(attrs['latex']) } : {}),
      },
      svg: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-svg'),
        renderHTML: (attrs) => (attrs['svg'] ? { 'data-svg': String(attrs['svg']) } : {}),
      },
      struct: {
        default: null,
        parseHTML: (el) => {
          const raw = el.getAttribute('data-struct');
          if (!raw) return null;
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        },
        renderHTML: (attrs) =>
          attrs['struct'] ? { 'data-struct': JSON.stringify(attrs['struct']) } : {},
      },
      caption: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-caption'),
        renderHTML: (attrs) =>
          attrs['caption'] ? { 'data-caption': String(attrs['caption']) } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="figure-block"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    // Inert markup for editor.getHTML() export; live UI is the React NodeView.
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-type': 'figure-block',
        class: 'note-figure-block',
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FigureBlockNodeView);
  },
});
