/**
 * MermaidBlock — TipTap node rendering a ```mermaid diagram to SVG, with an
 * Obsidian-style EDITABLE source.
 *
 * Mirrors the figure-block.tsx lazy-import pattern: `mermaid` is a transitive
 * dependency (verified importable), dynamically imported only when a mermaid block
 * mounts (keeps the heavy lib out of the main bundle, like KaTeX). Theme is forced
 * dark to match note mode. On any parse/render failure it falls back to a monospace
 * code block of the raw source (never blank, never throws).
 *
 * The diagram source lives in the `source` attribute (round-trips through the doc);
 * the SVG is a render artifact, not stored. In edit mode the NodeView exposes the
 * source in a textarea via EditableSource — committing the textarea updates the
 * `source` attr (debounced) which re-renders the diagram and auto-saves the note.
 * NOT an atom: the source is user-editable. renderHTML emits inert markup for
 * editor.getHTML(); the live UI is the React NodeView.
 */
import { useEffect, useRef, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { EditableSource } from './editable-source';

export interface MermaidBlockOptions {
  HTMLAttributes: Record<string, unknown>;
}

let mermaidIdSeq = 0;

function MermaidNodeView({ node, updateAttributes, editor }: NodeViewProps) {
  const source = (node.attrs['source'] as string | undefined) ?? '';
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const idRef = useRef(`note-mermaid-${(mermaidIdSeq += 1)}`);

  // Render the committed source → SVG. Re-runs when `source` changes (incl. edits).
  useEffect(() => {
    let cancelled = false;
    const src = source.trim();
    if (!src) {
      setSvg(null);
      setFailed(true);
      return;
    }
    setFailed(false);
    setSvg(null);
    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        // theme-aware: note mode is always dark. startOnLoad off — we render manually.
        mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' });
        const { svg: out } = await mermaid.render(idRef.current, src);
        if (!cancelled) setSvg(out);
      } catch {
        // mermaid injects an orphaned error element ("Syntax error" bomb) into
        // <body> on parse failure — remove it so only our inline source fallback shows.
        if (typeof document !== 'undefined') {
          document.getElementById(idRef.current)?.remove();
          document.getElementById(`d${idRef.current}`)?.remove();
        }
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source]);

  // Diagram preview — fallback to raw source on failure, never blank (mermaid
  // output is sanitized SVG via securityLevel:'strict'; source is diagram text).
  const preview = failed ? (
    <pre className="note-mermaid-fallback">
      <code>{source}</code>
    </pre>
  ) : svg === null ? (
    <div className="note-mermaid-loading" />
  ) : (
    <div className="note-mermaid-canvas" dangerouslySetInnerHTML={{ __html: svg }} />
  );

  return (
    <NodeViewWrapper className="note-mermaid" data-type="mermaid">
      <EditableSource
        source={source}
        editable={editor.isEditable}
        onCommit={(next) => updateAttributes({ source: next })}
        label="소스 편집"
        preview={preview}
      />
    </NodeViewWrapper>
  );
}

export const MermaidBlock = Node.create<MermaidBlockOptions>({
  name: 'mermaid',

  group: 'block',
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
