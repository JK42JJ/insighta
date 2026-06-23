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
} from '@/shared/lib/api-client';
import type { TiptapDoc, TiptapNode } from '@/features/video-side-panel/lib/note-parser';

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
 * strong(4) heuristic — pick the section title's most specific token that also
 * appears in the atom text (longest-first, length ≥ 2). Returns null if none →
 * no emphasis. Conservative by design: emphasis only when the atom literally
 * restates a section key term, at most one phrase per atom (Medium-sparse).
 */
function pickKeyPhrase(sectionTitle: string, atomText: string): string | null {
  const terms = sectionTitle
    .split(/[\s·,，()/[\]{}]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .sort((a, b) => b.length - a.length);
  for (const t of terms) {
    if (atomText.includes(t)) return t;
  }
  return null;
}

/** Paragraph whose first occurrence of `phrase` is wrapped in <strong>. */
function paragraphWithBold(text: string, phrase: string): TiptapNode {
  const norm = normalizeText(text);
  const idx = norm.indexOf(phrase);
  if (idx < 0) return paragraph(text);
  const before = norm.slice(0, idx);
  const after = norm.slice(idx + phrase.length);
  const content: Array<{ type: 'text'; text: string; marks?: Array<{ type: string }> }> = [];
  if (before) content.push({ type: 'text', text: before });
  content.push({ type: 'text', text: phrase, marks: [{ type: 'bold' }] });
  if (after) content.push({ type: 'text', text: after });
  return { type: 'paragraph', content } as TiptapNode;
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

// ---------------------------------------------------------------------------
// Section / chapter renderers
// ---------------------------------------------------------------------------

function renderSection(
  section: MandalaBookSection,
  chapterIdx: number,
  sectionIdx: number
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

  // VideoBlocks + atom paragraphs (grouped by vid)
  const groups = groupAtomsByVid(section.atoms ?? []);
  for (const g of groups) {
    if (g.atoms.length === 0) continue;
    const firstTs = g.atoms[0].ts ?? 0;
    const endSec = groupEndSec(g.atoms);
    out.push(videoBlockNode(g.vid, firstTs, endSec, section.title ?? null));
    // Each atom → its own paragraph. Keeps editing granularity natural.
    // strong(4): bold the section's key term IF it appears in the atom (max 1
    // per atom, none otherwise). Conservative — emphasis stays sparse (Medium).
    for (const a of g.atoms) {
      if (a.text && a.text.trim()) {
        const phrase = pickKeyPhrase(section.title ?? '', a.text);
        out.push(phrase ? paragraphWithBold(a.text, phrase) : paragraph(a.text));
      }
    }
  }

  // Section narrative (if present) — placed AFTER atoms as a wrap-up. Rendered
  // as a blockquote so note-mode CSS styles it as the gold "핵심 포인트" keypoint.
  if (section.narrative && section.narrative.trim()) {
    out.push({
      type: 'blockquote',
      content: [paragraph(section.narrative)],
    });
  }

  // Section divider (skip after the last section — handled by caller).
  out.push(horizontalRule());

  return out;
}

function renderChapter(chapter: MandalaBookChapter): TiptapNode[] {
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
    out.push(...renderSection(sec, chapter.ch, i));
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
  for (const ch of sortedChapters) {
    if (!ch || !Array.isArray(ch.sections)) continue;
    content.push(...renderChapter(ch));
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
