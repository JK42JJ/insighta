/**
 * NoteDocument generator — mandala_books → TipTap JSON (CP445 D1=B / Q1).
 *
 * Input shape comes from `useMandalaBook` hook:
 *   MandalaBookData = { chapters: MandalaBookChapter[] }
 *   MandalaBookChapter = { ch, title, intro?, sections[] }
 *   MandalaBookSection = { title, narrative?, atoms?[], qa?[] }
 *   MandalaBookAtom = { vid, ts, text, type? }
 *
 * Output shape (TipTap doc):
 *   doc
 *     ├─ paragraph (eyebrow: "Ch.{ch+1} · {section_idx+1}.0")
 *     ├─ heading h2 (chapter.title)
 *     ├─ (per section)
 *     │   ├─ paragraph (eyebrow: "Ch.{ch+1} · {ch+1}.{sec_idx+1}")
 *     │   ├─ heading h3 (section.title)
 *     │   ├─ (per distinct vid in section.atoms — group atoms by vid, ts ASC)
 *     │   │   ├─ videoBlock (vid, fromSec = first atom ts, sectionTitle)
 *     │   │   └─ paragraph(s) — atoms[].text from that vid group
 *     │   ├─ paragraph (section.narrative) — if present
 *     │   └─ horizontalRule (between sections)
 *     └─ ...
 *
 * Atoms grouping rule (D20 default — atoms group by vid, sorted by first ts):
 *   - Section with multi-vid atoms produces multiple VideoBlocks (one per vid).
 *   - Each VideoBlock followed by paragraphs of that vid's atoms (ts ASC).
 *
 * Hard Rule (CLAUDE.md):
 *   - 0 LLM API call (rule-based transform only)
 *   - 0 mutation of input (pure function)
 */

import type {
  MandalaBookData,
  MandalaBookChapter,
  MandalaBookSection,
  MandalaBookAtom,
  MandalaBookFigure,
} from '@/shared/lib/api-client';
import type { TiptapDoc, TiptapNode } from '@/features/video-side-panel/lib/note-parser';
import { parseMarkdownToTiptap, parseInline } from './markdown-to-tiptap';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** CP445.x — collapse all whitespace runs (incl. newlines) to a single
 *  space and trim. Prevents source data with stray "\n" in atoms.text /
 *  chapter.intro / section.narrative from rendering as visual line breaks
 *  inside one paragraph. One sentence = one paragraph. */
function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function paragraph(
  text: string,
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
): TiptapNode {
  const normalized = normalizeText(text);
  return {
    type: 'paragraph',
    content: normalized
      ? [
          {
            type: 'text',
            text: normalized,
            ...(marks ? { marks } : {}),
          },
        ]
      : [],
  };
}

/**
 * C6 — group consecutive atoms into Medium-style paragraphs. Merges adjacent
 * atoms that share the same `type` (fact/tip/argument) into one paragraph, so a
 * paragraph reads as a few related sentences instead of one subtitle line each.
 * Caps prevent over-merge (≤ 4 atoms / ≤ 280 chars → a new paragraph). A type
 * change also starts a new paragraph (keeps each paragraph thematically coherent).
 */
const PARA_MAX_ATOMS = 4;
const PARA_MAX_CHARS = 280;
function groupAtomsIntoParagraphs(atoms: Array<{ text?: string; type?: string }>): string[] {
  const out: string[] = [];
  let buf: string[] = [];
  let bufType: string | undefined;
  let bufLen = 0;
  const flush = () => {
    if (buf.length) out.push(buf.join(' '));
    buf = [];
    bufLen = 0;
  };
  for (const a of atoms) {
    const text = (a.text ?? '').trim();
    if (!text) continue;
    const type = a.type;
    const wouldOverflow = buf.length >= PARA_MAX_ATOMS || bufLen + text.length > PARA_MAX_CHARS;
    if (buf.length && (type !== bufType || wouldOverflow)) flush();
    if (buf.length === 0) bufType = type;
    buf.push(text);
    bufLen += text.length;
  }
  flush();
  return out;
}

function heading(level: 2 | 3, text: string): TiptapNode {
  return {
    type: 'heading',
    attrs: { level },
    content: [{ type: 'text', text }],
  };
}

function horizontalRule(): TiptapNode {
  return { type: 'horizontalRule' };
}

function videoBlockNode(
  vid: string,
  fromSec: number,
  endSec: number,
  sectionTitle: string | null
): TiptapNode {
  return {
    type: 'videoBlock',
    attrs: { vid, fromSec, endSec, sectionTitle },
  };
}

// NOTE-DENSITY ① (revised) — "핵심 포인트" key-point quote. `section.keyPoint` is a
// prose synthesis string; render it as a left-bar quote (blockquote > p, keypoint
// attr → note-mode "핵심 포인트" label) — the legacy quote style the user prefers,
// NOT a gold callout box or bullets. Inline marks (**bold**) are parsed. Returns
// null when absent/empty (flag-safe: existing notes byte-unchanged).
function keyPointQuoteNode(keyPoint: string | undefined): TiptapNode | null {
  const text = normalizeText(keyPoint ?? '');
  if (!text) return null;
  return {
    type: 'blockquote',
    attrs: { keypoint: true },
    content: [{ type: 'paragraph', content: parseInline(text) }],
  };
}

/**
 * Segment end for a vid group: the furthest segment boundary (max seg_ref.to_sec)
 * so playback covers the group's whole span, not just up to the last atom START.
 * Falls back to the last atom ts when seg_ref is absent (older books).
 */
function groupEndSec(atoms: MandalaBookAtom[]): number {
  let end = 0;
  for (const a of atoms) {
    const segEnd = a.seg_ref?.to_sec;
    end = Math.max(end, typeof segEnd === 'number' ? segEnd : (a.ts ?? 0));
  }
  return end;
}

/**
 * Group atoms by vid, preserving the first occurrence order. Within each
 * group, sort by ts ASC.
 */
function groupAtomsByVid(
  atoms: MandalaBookAtom[]
): Array<{ vid: string; atoms: MandalaBookAtom[] }> {
  const groupMap = new Map<string, MandalaBookAtom[]>();
  const order: string[] = [];
  for (const a of atoms) {
    if (!a.vid) continue;
    if (!groupMap.has(a.vid)) {
      groupMap.set(a.vid, []);
      order.push(a.vid);
    }
    groupMap.get(a.vid)!.push(a);
  }
  return order.map((vid) => ({
    vid,
    atoms: (groupMap.get(vid) ?? []).slice().sort((x, y) => (x.ts ?? 0) - (y.ts ?? 0)),
  }));
}

// [CV-NOTE-WIRE] / [CV-FIGURE-PRESENTATION] — render targeted CV figures attached
// to a section as `figureBlock` nodes (registered in useNoteDocument extensions).
// Filters defensively (backend already filters to verified + renderable): only
// chart/table/diagram/equation, drops unverified + keyframe + empty payloads.
// CP505: chart/diagram carry a server-rendered `svg`; table carries struct
// headers/rows; equation carries latex. asset_path kept as a legacy fallback.
const FIGURE_KINDS = new Set(['chart', 'table', 'diagram', 'equation']);

// Korean kind labels for the caption fallback (never the raw english word).
const KIND_LABEL_KO: Record<string, string> = { chart: '차트', diagram: '도식', table: '표' };

/** Caption = what the figure shows: struct.insight when present, else a kind
 *  label. Equation gets no label (neutral). */
function figureCaption(f: MandalaBookFigure): string | null {
  const insight =
    typeof f.struct?.['insight'] === 'string' ? (f.struct['insight'] as string).trim() : '';
  if (insight) return insight;
  if (f.kind === 'equation') return null;
  return KIND_LABEL_KO[f.kind] ?? null;
}

/** Table struct → compact {headers, rows} JSON string (rendered as an HTML
 *  table in the NodeView). null when no tabular payload. */
function serializeTable(struct: Record<string, unknown> | undefined): string | null {
  if (!struct) return null;
  const headers = Array.isArray(struct['headers'])
    ? (struct['headers'] as unknown[]).map(String)
    : [];
  const rows = Array.isArray(struct['rows'])
    ? (struct['rows'] as unknown[]).map((r) => (Array.isArray(r) ? r.map(String) : [String(r)]))
    : [];
  if (headers.length === 0 && rows.length === 0) return null;
  return JSON.stringify({ headers, rows });
}

interface FigureNodeAttrs {
  kind: string;
  latex: string | null;
  svg: string | null;
  assetPath: string | null;
  tableJson: string | null;
  caption: string | null;
  videoId: string | null;
  tsSec: number | null;
}
function figureBlockNode(attrs: FigureNodeAttrs): TiptapNode {
  return { type: 'figureBlock', attrs };
}
function renderFigures(figures: MandalaBookFigure[] | undefined): TiptapNode[] {
  const out: TiptapNode[] = [];
  for (const f of figures ?? []) {
    if (!FIGURE_KINDS.has(f.kind)) continue; // drops keyframe
    if (f.verification_status === 'unverified') continue; // defensive
    // Shared source/caption — drives the caption + "title · mm:ss" provenance line.
    const base = {
      caption: figureCaption(f),
      videoId: f.video_id ?? null,
      tsSec: typeof f.ts_sec === 'number' ? f.ts_sec : null,
    };
    if (f.kind === 'equation') {
      const latex = (f.latex ?? '').trim();
      if (!latex) continue;
      out.push(
        figureBlockNode({
          kind: 'equation',
          latex,
          svg: null,
          assetPath: null,
          tableJson: null,
          ...base,
        })
      );
    } else if (f.kind === 'table') {
      const tableJson = serializeTable(f.struct);
      const assetPath = (f.asset_path ?? '').trim() || null;
      if (!tableJson && !assetPath) continue;
      out.push(
        figureBlockNode({ kind: 'table', latex: null, svg: null, assetPath, tableJson, ...base })
      );
    } else {
      // chart | diagram → prefer inline SVG, fall back to a legacy image pointer.
      const svg = (f.svg ?? '').trim() || null;
      const assetPath = (f.asset_path ?? '').trim() || null;
      if (!svg && !assetPath) continue;
      out.push(
        figureBlockNode({ kind: f.kind, latex: null, svg, assetPath, tableJson: null, ...base })
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Section / chapter renderers
// ---------------------------------------------------------------------------

function renderSection(
  section: MandalaBookSection,
  chapterIdx: number,
  sectionIdx: number,
  narrativeMode: boolean
): TiptapNode[] {
  const out: TiptapNode[] = [];

  // Eyebrow ("Ch.X · X.Y") — rendered as a paragraph; CSS in CenterPanel
  // styles `paragraph[data-eyebrow="true"]` separately. To keep the doc
  // shape simple/portable, we use an italic-ish small text mark family
  // already supported by StarterKit ("italic"). Visual eyebrow styling is
  // applied in note-mode CSS via the surrounding heading.
  // sec-eyebrow ("N.N" first topic / "N.N · 다음 토픽" for subsequent topics).
  const secNum = `${chapterIdx + 1}.${sectionIdx + 1}`;
  const eyebrow = sectionIdx > 0 ? `${secNum} · 다음 토픽` : secNum;
  out.push(paragraph(eyebrow, [{ type: 'italic' }]));

  // Section heading (h3 inside chapter h2)
  out.push(heading(3, section.title));

  const groups = groupAtomsByVid(section.atoms ?? []);

  // §4.5.1 loop-1b — narrative book: the woven section.narrative IS the body
  // (one flowing prose, NOT per-video atom snippets). Source atoms become
  // citations: one video block per source vid (seek + provenance), AFTER the
  // prose. Removes the per-video atom-text paragraph dump (the 따로국밥 list) and
  // the trailing keypoint blockquote (narrative is the body now, not a wrap-up).
  // Legacy books (no chapter intro → narrativeMode false) fall through to the
  // unchanged path below. Empty narrative (weave/skeleton edge) also falls
  // through → graceful legacy render (R-1b-FALLBACK).
  if (narrativeMode && section.narrative && section.narrative.trim()) {
    // [NOTE-FULL-TOOLSET] section.narrative is rich markdown (bold/lists/callouts/
    // mermaid/tables) — parse it into the full TipTap node set instead of a single
    // plain paragraph. Plain prose (no markdown) still parses to one paragraph, so
    // pre-toolset narrative books are visually unchanged.
    out.push(...parseMarkdownToTiptap(section.narrative));
    for (const g of groups) {
      if (g.atoms.length === 0) continue;
      const firstTs = g.atoms[0].ts ?? 0;
      const endSec = groupEndSec(g.atoms);
      out.push(videoBlockNode(g.vid, firstTs, endSec, section.title ?? null));
    }
    out.push(...renderFigures(section.figures)); // [CV-NOTE-WIRE]
    // NOTE-DENSITY ① — the distilled take-away AFTER prose + figures, as a left-bar
    // "핵심 포인트" quote (flag-safe: absent keyPoint → nothing → byte-unchanged).
    const keyPoint = keyPointQuoteNode(section.keyPoint);
    if (keyPoint) out.push(keyPoint);
    out.push(horizontalRule());
    return out;
  }

  // VideoBlocks + atom paragraphs (grouped by vid) — LEGACY (unchanged).
  for (const g of groups) {
    if (g.atoms.length === 0) continue;
    const firstTs = g.atoms[0].ts ?? 0;
    const endSec = groupEndSec(g.atoms);
    out.push(videoBlockNode(g.vid, firstTs, endSec, section.title ?? null));
    // C6 — group consecutive same-type atoms into Medium-style paragraphs
    // (was 1 atom = 1 <p> = "picture-book"). Body stays UN-bolded: Medium body
    // text has no inline keyword bold (the auto-strong heuristic turned common
    // repeated words into gold noise). Emphasis lives ONLY in keypoint quotes +
    // code chips, not running prose.
    for (const para of groupAtomsIntoParagraphs(g.atoms)) {
      out.push(paragraph(para));
    }
  }

  // Section narrative (if present) — placed AFTER atoms as a wrap-up. Rendered
  // as a keypoint blockquote so note-mode CSS styles it as the gold "핵심 포인트"
  // quote (keypoint attr gates the label, so plain markdown quotes stay unlabeled).
  if (section.narrative && section.narrative.trim()) {
    out.push({
      type: 'blockquote',
      attrs: { keypoint: true },
      content: [paragraph(section.narrative)],
    });
  }

  out.push(...renderFigures(section.figures)); // [CV-NOTE-WIRE]

  // Section divider (skip after the last section — handled by caller).
  out.push(horizontalRule());

  return out;
}

function renderChapter(chapter: MandalaBookChapter, narrativeMode: boolean): TiptapNode[] {
  const out: TiptapNode[] = [];

  // Chapter kicker ("CHAPTER NN · 챕터명 · 영상 N · 토픽 N") + h2 doc-title.
  // Counts derived from the book (distinct vids + section count) so the meta is
  // honest, not invented. Rendered as the gold kicker (italic-only paragraph →
  // .ProseMirror p em:only-child in note-mode CSS).
  const secs = chapter.sections ?? [];
  const vidSet = new Set<string>();
  for (const s of secs) for (const a of s.atoms ?? []) if (a.vid) vidSet.add(a.vid);
  // kicker (gold) + doc-meta (dim) = two consecutive italic paragraphs. note-mode
  // CSS styles the first as the gold CHAPTER kicker and the adjacent one as the
  // dimmer meta dot-row (adjacent-sibling selector — no schema change needed).
  const kicker = `CHAPTER ${String(chapter.ch + 1).padStart(2, '0')} · ${chapter.title}`;
  // Duration ("약 N분") omitted — book data has no reliable per-chapter runtime,
  // so we don't invent it (honest meta only: video count + topic count).
  const docMeta = `${vidSet.size}개 영상에서 재구성 · 토픽 ${secs.length}`;
  out.push(paragraph(kicker, [{ type: 'italic' }]));
  out.push(paragraph(docMeta, [{ type: 'italic' }]));
  out.push(heading(2, chapter.title));

  // Optional intro paragraph (mandala_books schema: chapter.intro?)
  if (chapter.intro && chapter.intro.trim()) {
    out.push(paragraph(chapter.intro));
  }

  for (let i = 0; i < chapter.sections.length; i++) {
    const sec = chapter.sections[i];
    out.push(...renderSection(sec, chapter.ch, i, narrativeMode));
  }

  // CP504 loop-2-B — STORM gap-fill: web-sourced supplemental facts for this
  // chapter, each marked [n] into the bottom 참고 자료 list (ref_id). Present only
  // when enrich ran (BOOK_ENRICH_ENABLED); absent for normal books → no-op.
  if (chapter.research && chapter.research.length > 0) {
    out.push(heading(3, '보강 자료'));
    for (const r of chapter.research) {
      out.push(paragraph(`${r.fact} [${r.ref_id}]`));
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the initial TipTap JSON doc from mandala_books.book_json data.
 *
 * Pure function. Used at note-mode first entry: when `useNoteDocument`
 * fetches and finds 404, this generator runs and the result is POSTed
 * to /api/v1/note-documents as both content_json and original_json.
 *
 * On empty input → returns an empty doc (single empty paragraph).
 */
export function buildInitialNoteDoc(book: MandalaBookData | null | undefined): TiptapDoc {
  if (!book || !Array.isArray(book.chapters) || book.chapters.length === 0) {
    return { type: 'doc', content: [{ type: 'paragraph' }] };
  }

  const content: TiptapNode[] = [];
  const sortedChapters = book.chapters.slice().sort((a, b) => (a.ch ?? 0) - (b.ch ?? 0));
  // §4.5.1 loop-1b — narrative-book detection (flag-independent render gate):
  // skeleton books populate chapter.intro; legacy cell=chapter leaves it ''. A
  // populated intro ⇒ narrative render (prose body + atom citations); else the
  // legacy render (atom paragraphs + keypoint blockquote) is byte-unchanged —
  // so flag-off prod notes are identical, narrative books get the woven body.
  const narrativeMode = sortedChapters.some((ch) => !!(ch?.intro && ch.intro.trim()));
  for (const ch of sortedChapters) {
    if (!ch || !Array.isArray(ch.sections)) continue;
    content.push(...renderChapter(ch, narrativeMode));
  }

  // CP504 loop-2-B (B) — bottom "참고 자료" web references (STORM). Video provenance
  // (atom vid/ts) stays inline on the cards; this is the WEB half (P-REF-DUAL).
  // Present only when enrich ran; absent for normal books → no section.
  if (book.references && book.references.length > 0) {
    content.push(heading(2, '참고 자료'));
    for (const ref of book.references) {
      content.push(paragraph(`[${ref.id}] ${ref.title} — ${ref.url}`));
    }
  }

  // If the last node is a horizontalRule, drop it (clean trailing).
  while (content.length > 0 && content[content.length - 1].type === 'horizontalRule') {
    content.pop();
  }

  // Always end with an empty paragraph so the cursor has a landing spot
  // when the user clicks at the very end.
  content.push({ type: 'paragraph' });

  return { type: 'doc', content };
}
