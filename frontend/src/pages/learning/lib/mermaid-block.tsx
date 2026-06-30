/**
 * MermaidBlock — TipTap atomic node rendering a ```mermaid diagram to SVG.
 *
 * Mirrors the figure-block.tsx custom-node + lazy-import pattern: `mermaid` is a
 * transitive dependency (verified importable), dynamically imported only when a
 * mermaid block mounts (keeps the heavy lib out of the main bundle, like KaTeX).
 * Theme is forced dark to match note mode. On any parse/render failure it falls
 * back to a monospace code block of the raw source (never blank, never throws).
 *
 * Atom node: the diagram source lives in the `source` attribute; the SVG is a
 * render artifact, not stored in the doc. renderHTML emits inert markup for
 * editor.getHTML(); the live UI is the React NodeView.
 */
import { useEffect, useRef, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';

export interface MermaidBlockOptions {
  HTMLAttributes: Record<string, unknown>;
}

let mermaidIdSeq = 0;

function MermaidNodeView({ node }: NodeViewProps) {
  const source = (node.attrs['source'] as string | undefined) ?? '';
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const idRef = useRef(`note-mermaid-${(mermaidIdSeq += 1)}`);

  useEffect(() => {
    let cancelled = false;
    const src = source.trim();
    if (!src) {
      setFailed(true);
      return;
    }
    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        // theme-aware: note mode is always dark. startOnLoad off — we render manually.
        mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' });
        const { svg: out } = await mermaid.render(idRef.current, src);
        if (!cancelled) setSvg(out);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source]);

  if (failed) {
    // Fallback — show the raw source as a code block so content is never lost.
    return (
      <NodeViewWrapper className="note-mermaid note-mermaid--fallback" data-type="mermaid">
        <pre className="note-mermaid-fallback">
          <code>{source}</code>
        </pre>
      </NodeViewWrapper>
    );
  }

  if (svg === null) {
    return <NodeViewWrapper className="note-mermaid note-mermaid--loading" data-type="mermaid" />;
  }

  // mermaid output is sanitized SVG markup (securityLevel:'strict'); source is
  // backend-generated diagram text, not user HTML.
  return (
    <NodeViewWrapper className="note-mermaid" data-type="mermaid">
      <div className="note-mermaid-canvas" dangerouslySetInnerHTML={{ __html: svg }} />
    </NodeViewWrapper>
  );
}

export const MermaidBlock = Node.create<MermaidBlockOptions>({
  name: 'mermaid',

  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      source: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-source') ?? el.textContent ?? '',
        renderHTML: (attrs) => (attrs['source'] ? { 'data-source': String(attrs['source']) } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="mermaid"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-type': 'mermaid',
        class: 'note-mermaid',
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidNodeView);
  },
});
