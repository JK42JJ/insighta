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
 *  - kind∈{chart,diagram,table} → renders the asset_path as an <img> + caption.
 *
 * Inert until the backend populates section.figures (flag-gated server-side).
 */
import { useEffect, useRef, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';

export interface FigureBlockOptions {
  HTMLAttributes: Record<string, unknown>;
}

export type FigureKind = 'chart' | 'diagram' | 'table' | 'equation';

export interface FigureBlockAttrs {
  kind: FigureKind;
  latex: string | null;
  assetPath: string | null;
  caption: string | null;
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

function FigureBlockNodeView({ node }: NodeViewProps) {
  const attrs = node.attrs as unknown as FigureBlockAttrs;
  const [imgBroken, setImgBroken] = useState(false);

  return (
    <NodeViewWrapper className="note-figure-block" data-kind={attrs.kind}>
      {attrs.kind === 'equation' && attrs.latex ? (
        <EquationView latex={attrs.latex} />
      ) : attrs.assetPath && !imgBroken ? (
        <figure className="note-figure-image">
          <img
            src={attrs.assetPath}
            alt={attrs.caption ?? attrs.kind}
            loading="lazy"
            onError={() => setImgBroken(true)}
          />
          {attrs.caption && <figcaption>{attrs.caption}</figcaption>}
        </figure>
      ) : null}
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
      assetPath: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-asset-path'),
        renderHTML: (attrs) =>
          attrs['assetPath'] ? { 'data-asset-path': String(attrs['assetPath']) } : {},
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
