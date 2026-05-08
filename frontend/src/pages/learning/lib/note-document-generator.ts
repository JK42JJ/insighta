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

function videoBlockNode(vid: string, fromSec: number, sectionTitle: string | null): TiptapNode {
  return {
    type: 'videoBlock',
    attrs: { vid, fromSec, sectionTitle },
  };
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
  const eyebrow = `Ch.${chapterIdx + 1} · ${chapterIdx + 1}.${sectionIdx + 1}`;
  out.push(paragraph(eyebrow, [{ type: 'italic' }]));

  // Section heading (h3 inside chapter h2)
  out.push(heading(3, section.title));

  // VideoBlocks + atom paragraphs (grouped by vid)
  const groups = groupAtomsByVid(section.atoms ?? []);
  for (const g of groups) {
    if (g.atoms.length === 0) continue;
    const firstTs = g.atoms[0].ts ?? 0;
    out.push(videoBlockNode(g.vid, firstTs, section.title ?? null));
    // Each atom → its own paragraph. Keeps editing granularity natural.
    for (const a of g.atoms) {
      if (a.text && a.text.trim()) out.push(paragraph(a.text));
    }
  }

  // Section narrative (if present) — placed AFTER atoms so it reads as a
  // wrap-up summary rather than a video preface.
  if (section.narrative && section.narrative.trim()) {
    out.push(paragraph(section.narrative));
  }

  // Section divider (skip after the last section — handled by caller).
  out.push(horizontalRule());

  return out;
}

function renderChapter(chapter: MandalaBookChapter): TiptapNode[] {
  const out: TiptapNode[] = [];

  // Chapter eyebrow + h2
  out.push(paragraph(`Ch.${chapter.ch + 1}`, [{ type: 'italic' }]));
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
