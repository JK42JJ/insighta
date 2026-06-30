/**
 * MermaidBlock — TipTap node rendering a ```mermaid diagram to SVG, with an
 * Obsidian-style EDITABLE source.
 *
 * Mirrors the figure-block.tsx lazy-import pattern: `mermaid` is a transitive
 * dependency (verified importable), dynamically imported only when a mermaid block
 * mounts (keeps the heavy lib out of the main bundle, like KaTeX). On any
 * parse/render failure it falls back to a monospace code block of the raw source
 * (never blank, never throws).
 *
 * CONTRAST FIX: LLM-generated mermaid often embeds `style <node> fill:#<pastel>`
 * directives. With mermaid's dark theme those pastel fills carry light node text →
 * unreadable. We (1) strip the color directives so mermaid's own theme stays
 * internally consistent, and (2) drive a curated high-contrast `base` palette that
 * adapts to the note's effective background (dark today, light-ready).
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

type Mode = 'dark' | 'light';

/**
 * Strip LLM-injected color directives (`style` / `classDef` / `linkStyle`) so the
 * diagram inherits our curated theme instead of unreadable pastel fills. Structure
 * (nodes, edges, labels, subgraphs, harmless `class X y` assignments) is preserved.
 * Pure + exported for unit testing.
 */
export function stripMermaidColorDirectives(src: string): string {
  const COLOR_DIRECTIVE = /^\s*(style|classDef|linkStyle)\s/;
  return src
    .split('\n')
    .filter((line) => !COLOR_DIRECTIVE.test(line))
    .join('\n');
}

// Curated high-contrast palettes — the ONE place diagram colors live. mermaid
// themeVariables need resolved hex (CSS vars are not honored here). Tuned to the
// note aesthetic: dark = near-black surface + off-white ink; light = soft fill +
// near-black ink. Text is always high-contrast against its node fill.
const FONT_STACK = "'Noto Sans KR', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const FONT_SIZE = '14px';

const DARK_PALETTE = {
  primaryColor: '#23262d', // node fill (lifts off the ~#0E0F11 note bg)
  primaryTextColor: '#f4f2ee', // off-white ink, high contrast on dark fill
  primaryBorderColor: '#4a4e57',
  lineColor: '#b8bcc4', // edges, legible on dark bg
  secondaryColor: '#2c3038',
  tertiaryColor: '#33373f',
  fontFamily: FONT_STACK,
  fontSize: FONT_SIZE,
} as const;

const LIGHT_PALETTE = {
  primaryColor: '#eef1f5', // soft light node fill
  primaryTextColor: '#1a1d21', // near-black ink, high contrast on light fill
  primaryBorderColor: '#c2c7d0',
  lineColor: '#5a5f68', // edges, legible on white bg
  secondaryColor: '#e3e7ec',
  tertiaryColor: '#d9dde3',
  fontFamily: FONT_STACK,
  fontSize: FONT_SIZE,
} as const;

// Perceived-luminance coefficients (ITU-R BT.601) + the dark/light split point.
const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;
const MAX_CHANNEL = 255;
const DARK_LUMA_THRESHOLD = 0.5;

/** Parse the `rgb()/rgba()` string getComputedStyle returns. null = transparent. */
function parseRgb(color: string): [number, number, number, number] | null {
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(',').map((p) => parseFloat(p.trim()));
  const [r, g, b, a = 1] = parts;
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return [r, g, b, a];
}

/** Walk up to the first non-transparent ancestor background; dark if luminance < 0.5. */
function detectMode(el: HTMLElement | null): Mode {
  let node: HTMLElement | null = el;
  while (node) {
    const rgb = parseRgb(getComputedStyle(node).backgroundColor);
    if (rgb && rgb[3] > 0) {
      const [r, g, b] = rgb;
      const luma = (LUMA_R * r + LUMA_G * g + LUMA_B * b) / MAX_CHANNEL;
      return luma < DARK_LUMA_THRESHOLD ? 'dark' : 'light';
    }
    node = node.parentElement;
  }
  return 'dark'; // note mode is dark-only today
}

function MermaidNodeView({ node, updateAttributes, editor }: NodeViewProps) {
  const source = (node.attrs['source'] as string | undefined) ?? '';
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [mode, setMode] = useState<Mode>('dark');
  const idRef = useRef(`note-mermaid-${(mermaidIdSeq += 1)}`);
  const hostRef = useRef<HTMLDivElement>(null);

  // Detect the effective theme from the rendered background, and re-detect when the
  // app's dark-class toggles (adapts automatically if a light note-mode ships).
  useEffect(() => {
    const sync = () => setMode(detectMode(hostRef.current));
    sync();
    if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // Render the committed source → SVG. Re-runs when `source` or `mode` changes.
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
        // base theme + curated palette; strip LLM pastel fills first. startOnLoad
        // off — we render manually.
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'base',
          themeVariables: mode === 'dark' ? DARK_PALETTE : LIGHT_PALETTE,
        });
        const stripped = stripMermaidColorDirectives(src);
        const { svg: out } = await mermaid.render(idRef.current, stripped);
        if (!cancelled) setSvg(out);
      } catch {
        // mermaid leaks an orphaned "Syntax error" element into <body> on parse
        // failure — remove it before falling back (supersedes PR #1026).
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
  }, [source, mode]);

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
      <div ref={hostRef} style={{ display: 'contents' }}>
        <EditableSource
          source={source}
          editable={editor.isEditable}
          onCommit={(next) => updateAttributes({ source: next })}
          label="소스 편집"
          preview={preview}
        />
      </div>
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
