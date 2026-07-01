/**
 * markdown-to-tiptap — deterministic, dependency-free markdown → TipTap nodes.
 *
 * Converts the rich-markdown `section.narrative` (woven prose with inline marks,
 * lists, admonitions, mermaid, GFM tables) into the TipTap node array consumed by
 * note-document-generator. No markdown library is bundled (package.json has none),
 * so this is a focused line-based parser covering exactly the constructs the book
 * pipeline emits — kept deterministic + unit-tested (markdown-to-tiptap.test.ts).
 *
 * Supported block constructs (one block per detector, checked in this order):
 *   ```mermaid … ```          → mermaid node      (source kept verbatim)
 *   ``` / ```lang … ```       → codeBlock         (lowlight; language attr)
 *   > [!note|tip|warning] …   → callout node      (kind + parsed body)
 *   | a | b |  + |---|---|    → native table      (GFM; editable cells, inline marks)
 *   > …                       → blockquote        (plain quote; parsed body)
 *   #…###### …                → heading           (level capped at 3)
 *   --- or *** or ___ (alone) → horizontalRule
 *   "- " / "* " / "+ " item   → bulletList        (flat; one paragraph / item)
 *   "1. " item                → orderedList       (flat)
 *   (anything else)           → paragraph         (soft-wrapped lines joined)
 *
 * Supported inline marks (parseInline): `code`, [label](url) link, bold (double
 * asterisk or "__"), italic (single asterisk or "_") — composable (e.g. nested
 * bold + italic).
 *
 * Nodes emitted here that are NOT in StarterKit (mermaid, callout, native table)
 * MUST be registered as TipTap extensions in useNoteDocument — an unregistered
 * node type makes ProseMirror throw on doc load. Pure function, 0 LLM calls.
 */
import type { TiptapNode } from '@/features/video-side-panel/lib/note-parser';

type Mark = { type: string; attrs?: Record<string, unknown> };

// ---------------------------------------------------------------------------
// Emoji / picto strip (academic-quality guard)
// ---------------------------------------------------------------------------

// Remove emoji + cheap correct/incorrect markers from TEXT content. The LLM adds
// ✅❌✓✗⚠️ as redundant markers (the Korean 맞음/틀림 already says it), which ruins
// the academic tone. PRESERVES meaningful symbols: arrows (→ ← ↑ ↓), math (× ÷ ± =),
// and typographic punctuation (· — … ‘ ’ “ ”). Extended_Pictographic covers ✅❌⚠️;
// ✓✗✔✘ (U+2713/2714/2717/2718) are plain dingbats NOT in that class, added explicitly.
const EMOJI_RE =
  /[\p{Extended_Pictographic}\u{FE0F}\u{2713}\u{2714}\u{2717}\u{2718}\u{2705}\u{274C}\u{26A0}]/gu;

/**
 * Strip emoji/picto markers from a text string, then tidy whitespace: collapse
 * any double-spaces left behind and trim leading spaces on each line (so
 * "❌ 현재완료 불가" → "현재완료 불가", not " 현재완료 불가"). Pure.
 */
export function stripEmoji(text: string): string {
  if (!text) return text;
  return text
    .replace(EMOJI_RE, '')
    .replace(/ {2,}/g, ' ')
    .replace(/^[ \t]+/gm, '');
}

// ---------------------------------------------------------------------------
// Inline (text + marks)
// ---------------------------------------------------------------------------

// Ordered alternation: code span, link, bold (** / __), italic (* / _). Code is
// first so its literal content is never re-parsed for emphasis.
const INLINE_RE =
  /(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))|(\*\*[^*]+?\*\*)|(__[^_]+?__)|(\*[^*\n]+?\*)|(_[^_\n]+?_)/;

function textNode(text: string, marks: Mark[]): TiptapNode {
  // Strip emoji/picto markers from rendered text (not code spans — those keep
  // literal content; handled by the caller passing a 'code' mark, but emoji in
  // prose code is rare and harmless to strip). Keeps new builds clean.
  const clean = stripEmoji(text);
  return marks.length
    ? { type: 'text', text: clean, marks: marks.map((m) => ({ ...m })) }
    : { type: 'text', text: clean };
}

/**
 * Parse one line of inline markdown into TipTap text nodes. `marks` carries the
 * enclosing emphasis so nested spans (bold > italic, link > bold) compose.
 */
export function parseInline(input: string, marks: Mark[] = []): TiptapNode[] {
  const out: TiptapNode[] = [];
  let rest = input;
  while (rest.length > 0) {
    const m = INLINE_RE.exec(rest);
    if (!m) {
      out.push(textNode(rest, marks));
      break;
    }
    const idx = m.index;
    if (idx > 0) out.push(textNode(rest.slice(0, idx), marks));
    const tok = m[0];
    if (m[1]) {
      // code span — literal content, no further emphasis parsing.
      out.push(textNode(tok.slice(1, -1), [...marks, { type: 'code' }]));
    } else if (m[2]) {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)!;
      out.push(
        ...parseInline(lm[1], [
          ...marks,
          { type: 'link', attrs: { href: lm[2], target: '_blank' } },
        ])
      );
    } else if (m[3] || m[4]) {
      out.push(...parseInline(tok.slice(2, -2), [...marks, { type: 'bold' }]));
    } else if (m[5] || m[6]) {
      out.push(...parseInline(tok.slice(1, -1), [...marks, { type: 'italic' }]));
    }
    rest = rest.slice(idx + tok.length);
  }
  return out.filter((n) => n.type !== 'text' || (typeof n.text === 'string' && n.text.length > 0));
}

function paragraphNode(text: string): TiptapNode {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return { type: 'paragraph', content: normalized ? parseInline(normalized) : [] };
}

// ---------------------------------------------------------------------------
// Block detectors
// ---------------------------------------------------------------------------

const FENCE_RE = /^```(\w*)\s*$/;
const CALLOUT_RE = /^>\s*\[!(note|tip|warning)\]\s?(.*)$/i;
const QUOTE_RE = /^>\s?(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const HR_RE = /^(-{3,}|\*{3,}|_{3,})$/;
const BULLET_RE = /^[-*+]\s+(.*)$/;
const ORDERED_RE = /^\d+\.\s+(.*)$/;

/** A GFM delimiter row: pipe-separated cells of only dashes/colons (e.g. | --- | :-: |). */
function isTableDelimiter(line: string): boolean {
  const t = line.trim();
  if (!t.includes('|') || !t.includes('-')) return false;
  const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|');
  return cells.length >= 1 && cells.every((c) => /^\s*:?-+:?\s*$/.test(c));
}

/** Split a GFM table row into trimmed cells (tolerates optional leading/trailing pipe). */
function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

/**
 * Build a NATIVE TipTap table node (table > tableRow > tableHeader|tableCell >
 * paragraph > inline). Cell text is parsed as inline markdown so `**bold**` etc.
 * render as marks, not literal asterisks. Rows are padded to a rectangular column
 * count so the table renders cleanly. Shared by the parser and the load-path
 * migration of legacy `markdownTable` atoms.
 */
export function buildTableNode(headers: string[], rows: string[][]): TiptapNode {
  const colCount = Math.max(headers.length, ...rows.map((r) => r.length), 1);
  const cell = (text: string, header: boolean): TiptapNode => {
    const normalized = text.replace(/\s+/g, ' ').trim();
    return {
      type: header ? 'tableHeader' : 'tableCell',
      content: [{ type: 'paragraph', content: normalized ? parseInline(normalized) : [] }],
    };
  };
  const pad = (cells: string[], header: boolean): TiptapNode => {
    const content: TiptapNode[] = [];
    for (let c = 0; c < colCount; c++) content.push(cell(cells[c] ?? '', header));
    return { type: 'tableRow', content };
  };
  const tableRows: TiptapNode[] = [];
  if (headers.length > 0) tableRows.push(pad(headers, true));
  for (const row of rows) tableRows.push(pad(row, false));
  return { type: 'table', content: tableRows };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a rich-markdown string into a flat array of TipTap block nodes.
 * Empty / whitespace-only input → [] (caller decides the fallback).
 */
export function parseMarkdownToTiptap(md: string | null | undefined): TiptapNode[] {
  const text = (md ?? '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const out: TiptapNode[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (para.length === 0) return;
    const joined = para.join(' ');
    para = [];
    const node = paragraphNode(joined);
    if (node.content && node.content.length > 0) out.push(node);
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Blank line → paragraph boundary.
    if (trimmed === '') {
      flushPara();
      i++;
      continue;
    }

    // Fenced code / mermaid.
    const fence = FENCE_RE.exec(trimmed);
    if (fence) {
      flushPara();
      const lang = (fence[1] ?? '').toLowerCase();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        buf.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // consume closing fence
      const src = buf.join('\n');
      if (lang === 'mermaid') {
        out.push({ type: 'mermaid', attrs: { source: src } });
      } else {
        out.push({
          type: 'codeBlock',
          ...(lang ? { attrs: { language: lang } } : {}),
          content: src ? [{ type: 'text', text: src }] : [],
        });
      }
      continue;
    }

    // Admonition callout: > [!note] … (subsequent > lines are the body).
    const callout = CALLOUT_RE.exec(line);
    if (callout) {
      flushPara();
      const kind = callout[1].toLowerCase();
      const bodyLines: string[] = [];
      if (callout[2] && callout[2].trim()) bodyLines.push(callout[2]);
      i++;
      while (i < lines.length && lines[i].trimStart().startsWith('>')) {
        const q = QUOTE_RE.exec(lines[i]);
        bodyLines.push(q ? q[1] : '');
        i++;
      }
      const inner = parseMarkdownToTiptap(bodyLines.join('\n'));
      out.push({
        type: 'callout',
        attrs: { kind },
        content: inner.length ? inner : [{ type: 'paragraph' }],
      });
      continue;
    }

    // GFM table: a header row followed by a delimiter row.
    if (line.includes('|') && i + 1 < lines.length && isTableDelimiter(lines[i + 1])) {
      flushPara();
      const headers = splitTableRow(line);
      i += 2; // skip header + delimiter
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      out.push(buildTableNode(headers, rows));
      continue;
    }

    // Plain blockquote: > … (no [!type] — that was handled above).
    if (line.trimStart().startsWith('>')) {
      flushPara();
      const bodyLines: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith('>')) {
        const q = QUOTE_RE.exec(lines[i]);
        bodyLines.push(q ? q[1] : '');
        i++;
      }
      const inner = parseMarkdownToTiptap(bodyLines.join('\n'));
      out.push({ type: 'blockquote', content: inner.length ? inner : [{ type: 'paragraph' }] });
      continue;
    }

    // ATX heading (capped at h3 — note schema enables levels 1-3).
    const heading = HEADING_RE.exec(trimmed);
    if (heading) {
      flushPara();
      const level = Math.min(3, heading[1].length) as 1 | 2 | 3;
      out.push({ type: 'heading', attrs: { level }, content: parseInline(heading[2].trim()) });
      i++;
      continue;
    }

    // Thematic break.
    if (HR_RE.test(trimmed)) {
      flushPara();
      out.push({ type: 'horizontalRule' });
      i++;
      continue;
    }

    // Bullet list (flat).
    if (BULLET_RE.test(trimmed)) {
      flushPara();
      const items: TiptapNode[] = [];
      while (i < lines.length && BULLET_RE.test(lines[i].trim())) {
        const m = BULLET_RE.exec(lines[i].trim())!;
        items.push({ type: 'listItem', content: [paragraphNode(m[1])] });
        i++;
      }
      out.push({ type: 'bulletList', content: items });
      continue;
    }

    // Ordered list (flat).
    if (ORDERED_RE.test(trimmed)) {
      flushPara();
      const items: TiptapNode[] = [];
      while (i < lines.length && ORDERED_RE.test(lines[i].trim())) {
        const m = ORDERED_RE.exec(lines[i].trim())!;
        items.push({ type: 'listItem', content: [paragraphNode(m[1])] });
        i++;
      }
      out.push({ type: 'orderedList', content: items });
      continue;
    }

    // Default: accumulate into the current paragraph (soft-wrapped lines join).
    para.push(trimmed);
    i++;
  }

  flushPara();
  return out;
}
