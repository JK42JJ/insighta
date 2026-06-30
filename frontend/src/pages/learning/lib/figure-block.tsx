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
 *  - kind∈{chart,diagram} → renders the server SVG inline (sanitized), scaled to
 *    the body width; falls back to a legacy <img> asset when no svg.
 *  - kind='table' → renders struct headers/rows as an HTML table.
 *
 * [CV-FIGURE-PRESENTATION] — each figure is framed on an ink-tinted plate. theme='auto'
 * SVGs carry transparent bg + #808080 sentinel ink which sanitizeSvg swaps to
 * currentColor, so the ink inherits the note body color (one image, dual-mode). A
 * muted caption + a dimmer "video title · mm:ss" source line sit below.
 * Video title is resolved at render from useMandalaCards (the book has no title
 * map); it falls back to "영상 · mm:ss" when the card isn't found.
 *
 * Inert until the backend populates section.figures (flag-gated server-side).
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useMandalaCards } from '@/pages/learning/model/useMandalaCards';

export interface FigureBlockOptions {
  HTMLAttributes: Record<string, unknown>;
}

export type FigureKind = 'chart' | 'diagram' | 'table' | 'equation';

export interface FigureBlockAttrs {
  kind: FigureKind;
  latex: string | null;
  svg: string | null;
  assetPath: string | null;
  tableJson: string | null;
  caption: string | null;
  videoId: string | null;
  tsSec: number | null;
}

const YT_URL_RE = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/;

function formatTs(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Resolve a YouTube video_id → its card title (the book carries no title map;
 * useMandalaCards is the same source VideoStrip uses). null when unavailable.
 */
function useVideoTitle(videoId: string | null): string | null {
  const { mandalaId } = useParams<{ mandalaId?: string }>();
  const { cards } = useMandalaCards(mandalaId ?? '');
  return useMemo(() => {
    if (!videoId) return null;
    for (const c of cards) {
      const m = c.videoUrl.match(YT_URL_RE);
      if (m?.[1] === videoId) return c.title?.trim() || null;
    }
    return null;
  }, [cards, videoId]);
}

// Adaptive (theme='auto') SVGs paint ALL ink (text/edges/labels) in this sentinel
// hex; we swap it for currentColor so the figure inherits the note's text color per
// mode. Category accent-color borders use other hues and are left untouched.
const ADAPTIVE_INK_SENTINEL_RE = /#808080/gi;

/**
 * Sanitize a server-rendered SVG before inlining it. Drops <script>, event
 * handlers (on*) and javascript: hrefs; strips the root width/height so CSS
 * scales the figure by its viewBox (fix #1). Swaps the adaptive ink sentinel
 * #808080 → currentColor (theme='auto', dual-mode). Returns '' on parse failure.
 * Exported for unit tests.
 */
export function sanitizeSvg(raw: string): string {
  if (typeof window === 'undefined' || !window.DOMParser) return '';
  let doc: Document;
  try {
    doc = new window.DOMParser().parseFromString(raw, 'image/svg+xml');
  } catch {
    return '';
  }
  if (doc.querySelector('parsererror')) return '';
  const svg = doc.querySelector('svg');
  if (!svg) return '';
  svg.querySelectorAll('script').forEach((el) => el.remove());
  const scrub = (el: Element) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const val = attr.value.trim().toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      else if ((name === 'href' || name === 'xlink:href') && val.startsWith('javascript:'))
        el.removeAttribute(attr.name);
    }
    Array.from(el.children).forEach(scrub);
  };
  scrub(svg);
  // fix #1 — let CSS control size via viewBox (graphviz/matplotlib both emit one).
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  // Swap adaptive ink sentinel → currentColor across fill=/stroke=/stop-color/color:/style.
  // The sentinel is a dedicated color value, so a single serialized replace is exhaustive.
  return svg.outerHTML.replace(ADAPTIVE_INK_SENTINEL_RE, 'currentColor');
}

interface ParsedTable {
  headers: string[];
  rows: string[][];
}
function parseTable(json: string | null): ParsedTable | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as ParsedTable;
    const headers = Array.isArray(parsed.headers) ? parsed.headers : [];
    const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
    if (headers.length === 0 && rows.length === 0) return null;
    return { headers, rows };
  } catch {
    return null;
  }
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
        // copy-tex self-registers a global copy handler that rewrites a selected
        // equation to its LaTeX source via the MathML <annotation>; lazy so it only
        // loads with an equation figure. output:'htmlAndMathml' guarantees the annotation.
        await import('katex/contrib/copy-tex');
        if (cancelled) return;
        setHtml(
          katex.renderToString(latex, {
            throwOnError: false,
            displayMode: true,
            output: 'htmlAndMathml',
          })
        );
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

function FigureTable({ table }: { table: ParsedTable }) {
  return (
    <table className="note-figure-table">
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
  );
}

function FigureBlockNodeView({ node }: NodeViewProps) {
  const attrs = node.attrs as unknown as FigureBlockAttrs;
  const [imgBroken, setImgBroken] = useState(false);

  // fix #4 — source line "video title · mm:ss" (title from cards, ts always).
  const title = useVideoTitle(attrs.videoId);
  const ts = typeof attrs.tsSec === 'number' ? formatTs(attrs.tsSec) : null;
  const sourceText = title ? (ts ? `${title} · ${ts}` : title) : ts ? `영상 · ${ts}` : null;

  const cleanSvg = useMemo(() => (attrs.svg ? sanitizeSvg(attrs.svg) : ''), [attrs.svg]);
  const table = useMemo(() => parseTable(attrs.tableJson), [attrs.tableJson]);

  let body: React.ReactNode = null;
  if (attrs.kind === 'equation' && attrs.latex) {
    body = <EquationView latex={attrs.latex} />;
  } else if (cleanSvg) {
    // Server SVG is backend-rendered + sanitized above (script/handlers stripped).
    body = <div className="note-figure-svg" dangerouslySetInnerHTML={{ __html: cleanSvg }} />;
  } else if (table) {
    body = <FigureTable table={table} />;
  } else if (attrs.assetPath && !imgBroken) {
    body = (
      <img
        src={attrs.assetPath}
        alt={attrs.caption ?? attrs.kind}
        loading="lazy"
        onError={() => setImgBroken(true)}
      />
    );
  }

  // Nothing renderable (broken legacy image / empty payload) → drop the block.
  if (!body) {
    return <NodeViewWrapper className="note-figure-block hidden" data-kind={attrs.kind} />;
  }

  return (
    <NodeViewWrapper className="note-figure-block" data-kind={attrs.kind}>
      <figure className="note-figure" data-figkind={attrs.kind}>
        <div className="note-figure-canvas">{body}</div>
        {(attrs.caption || sourceText) && (
          <figcaption className="note-figure-meta">
            {attrs.caption && <div className="note-figure-caption">{attrs.caption}</div>}
            {sourceText && <div className="note-figure-source">{sourceText}</div>}
          </figcaption>
        )}
      </figure>
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
      assetPath: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-asset-path'),
        renderHTML: (attrs) =>
          attrs['assetPath'] ? { 'data-asset-path': String(attrs['assetPath']) } : {},
      },
      tableJson: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-table'),
        renderHTML: (attrs) => (attrs['tableJson'] ? { 'data-table': String(attrs['tableJson']) } : {}),
      },
      caption: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-caption'),
        renderHTML: (attrs) =>
          attrs['caption'] ? { 'data-caption': String(attrs['caption']) } : {},
      },
      videoId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-video-id'),
        renderHTML: (attrs) =>
          attrs['videoId'] ? { 'data-video-id': String(attrs['videoId']) } : {},
      },
      tsSec: {
        default: null,
        parseHTML: (el) => {
          const v = el.getAttribute('data-ts-sec');
          return v == null ? null : Number(v);
        },
        renderHTML: (attrs) =>
          attrs['tsSec'] != null ? { 'data-ts-sec': String(attrs['tsSec']) } : {},
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
