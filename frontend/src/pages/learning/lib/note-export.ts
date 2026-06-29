/**
 * NoteExport — TipTap JSON → Markdown / HTML / JSON serializers (CP445 D3 / Q3).
 *
 * Phase 1 scope: MD, HTML (delegate to editor.getHTML()), JSON.
 * Phase 2 scope (별 PR): Notion blocks, PDF (browser print).
 *
 * Markdown spec:
 *   doc            → top-level concat
 *   heading L=2    → "## {text}\n\n"
 *   heading L=3    → "### {text}\n\n"
 *   paragraph      → "{text}\n\n"  (italic-only marks render as "_text_")
 *   horizontalRule → "---\n\n"
 *   bulletList     → "- {text}\n" lines + trailing blank
 *   orderedList    → "1. {text}\n" (1-indexed serial)
 *   blockquote     → "> {text}\n\n"
 *   codeBlock      → "```{lang}\n{text}\n```\n\n"
 *   videoBlock     → "[▶ {mm:ss} {sectionTitle}](https://youtube.com/watch?v={vid}&t={fromSec}s)\n\n"
 *
 * Inline marks:
 *   bold    → **text**
 *   italic  → _text_
 *   code    → `text`
 *   link    → [text](href)
 *
 * Hard Rule (CLAUDE.md):
 *   - 0 LLM API call (pure transform)
 *   - No `tiptap-markdown` 3rd party (D3 default — self-implemented)
 */

import type { Editor } from '@tiptap/react';
import type { TiptapDoc, TiptapNode } from '@/features/video-side-panel/lib/note-parser';

// [CV-NOTE-WIRE] — table figure → GitHub-flavored markdown table from headers/rows.
function renderMarkdownTable(struct: { headers?: string[]; rows?: string[][] }): string {
  const headers = Array.isArray(struct.headers) ? struct.headers : [];
  const rows = Array.isArray(struct.rows) ? struct.rows : [];
  if (headers.length === 0 && rows.length === 0) return '';
  const colCount = headers.length || rows[0]?.length || 0;
  const head = headers.length ? headers : Array.from({ length: colCount }, () => '');
  const headerLine = `| ${head.join(' | ')} |`;
  const sepLine = `| ${head.map(() => '---').join(' | ')} |`;
  const bodyLines = rows.map((r) => `| ${r.join(' | ')} |`).join('\n');
  return bodyLines
    ? `${headerLine}\n${sepLine}\n${bodyLines}\n\n`
    : `${headerLine}\n${sepLine}\n\n`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function exportToJson(doc: TiptapDoc): string {
  return JSON.stringify(doc, null, 2);
}

export function exportToMarkdown(doc: TiptapDoc): string {
  if (!doc || doc.type !== 'doc' || !Array.isArray(doc.content)) return '';
  return (
    doc.content
      .map((node) => renderBlock(node, 0))
      .join('')
      .trimEnd() + '\n'
  );
}

/**
 * CP445.x — HTML export. Wraps `editor.getHTML()` in a minimal HTML5
 * document so the file opens cleanly in browsers / Obsidian / Notion.
 * Intentionally no inline CSS — receivers apply their own styling.
 */
export function exportToHtml(editor: Editor): string {
  const inner = editor.getHTML();
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>Insighta Note</title>
</head>
<body>
${inner}
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Block renderers
// ---------------------------------------------------------------------------

function renderBlock(node: TiptapNode, depth: number): string {
  switch (node.type) {
    case 'heading': {
      const level = (node.attrs?.['level'] as number | undefined) ?? 2;
      const prefix = '#'.repeat(Math.min(6, Math.max(1, level)));
      return `${prefix} ${renderInline(node.content ?? [])}\n\n`;
    }
    case 'paragraph': {
      const text = renderInline(node.content ?? []);
      return text ? `${text}\n\n` : '\n';
    }
    case 'horizontalRule':
      return '---\n\n';
    case 'bulletList':
      return renderList(node, '-', depth);
    case 'orderedList':
      return renderList(node, '1.', depth);
    case 'blockquote': {
      const inner = (node.content ?? []).map((c) => renderBlock(c, depth)).join('');
      return (
        inner
          .split('\n')
          .map((line) => (line ? `> ${line}` : ''))
          .join('\n')
          .trimEnd() + '\n\n'
      );
    }
    case 'codeBlock': {
      const lang = (node.attrs?.['language'] as string | undefined) ?? '';
      const text = (node.content ?? [])
        .map((t) => (typeof t.text === 'string' ? t.text : ''))
        .join('');
      return `\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
    }
    case 'videoBlock': {
      const vid = (node.attrs?.['vid'] as string | undefined) ?? '';
      const fromSec = Number(node.attrs?.['fromSec'] ?? 0);
      const sectionTitle = (node.attrs?.['sectionTitle'] as string | null | undefined) ?? null;
      if (!vid) return '';
      const ts = formatTs(fromSec);
      const label = sectionTitle ? `▶ ${ts} ${sectionTitle}` : `▶ ${ts}`;
      const url = `https://www.youtube.com/watch?v=${vid}&t=${Math.floor(fromSec)}s`;
      return `[${label}](${url})\n\n`;
    }
    case 'figureBlock': {
      // [CV-NOTE-WIRE] — equation → $$..$$ ; table → markdown table ;
      // chart/diagram → inline SVG (markdown allows raw HTML); empty → skip.
      const kind = (node.attrs?.['kind'] as string | undefined) ?? '';
      if (kind === 'equation') {
        const latex = (node.attrs?.['latex'] as string | undefined) ?? '';
        return latex ? `$$\n${latex}\n$$\n\n` : '';
      }
      if (kind === 'table') {
        const struct = node.attrs?.['struct'] as
          | { headers?: string[]; rows?: string[][] }
          | undefined;
        return struct ? renderMarkdownTable(struct) : '';
      }
      const svg = (node.attrs?.['svg'] as string | undefined) ?? '';
      return svg ? `${svg}\n\n` : '';
    }
    default:
      // Fallback for unknown block types: render any text children.
      if (Array.isArray(node.content)) {
        const inner = node.content.map((c) => renderBlock(c, depth)).join('');
        return inner;
      }
      return '';
  }
}

function renderList(node: TiptapNode, marker: string, depth: number): string {
  const items = node.content ?? [];
  let out = '';
  for (let i = 0; i < items.length; i++) {
    const li = items[i];
    if (li.type !== 'listItem') continue;
    const itemMarker = marker === '1.' ? `${i + 1}.` : marker;
    const innerBlocks = li.content ?? [];
    // Render the first child paragraph inline; subsequent blocks indent under.
    const lines: string[] = [];
    for (let bi = 0; bi < innerBlocks.length; bi++) {
      const b = innerBlocks[bi];
      const rendered = renderBlock(b, depth + 1).trimEnd();
      if (bi === 0) {
        lines.push(`${'  '.repeat(depth)}${itemMarker} ${rendered.replace(/\n+/g, ' ')}`);
      } else {
        lines.push(
          rendered
            .split('\n')
            .map((l) => (l ? `${'  '.repeat(depth + 1)}${l}` : ''))
            .join('\n')
        );
      }
    }
    out += lines.join('\n') + '\n';
  }
  return out + '\n';
}

// ---------------------------------------------------------------------------
// Inline renderer (text + marks)
// ---------------------------------------------------------------------------

function renderInline(nodes: TiptapNode[]): string {
  return nodes.map(renderInlineNode).join('');
}

function renderInlineNode(node: TiptapNode): string {
  if (node.type !== 'text' || typeof node.text !== 'string') {
    // hard break / unknown inline → space-separated children
    if (node.type === 'hardBreak') return '  \n';
    if (Array.isArray(node.content)) return renderInline(node.content);
    return '';
  }
  let text = node.text;
  const marks = node.marks ?? [];

  // Apply marks in a stable order: code → bold → italic → link.
  for (const m of marks) {
    if (m.type === 'code') text = '`' + text + '`';
  }
  for (const m of marks) {
    if (m.type === 'bold') text = `**${text}**`;
  }
  for (const m of marks) {
    if (m.type === 'italic') text = `_${text}_`;
  }
  for (const m of marks) {
    if (m.type === 'link') {
      const href = (m.attrs?.['href'] as string | undefined) ?? '';
      if (href) text = `[${text}](${href})`;
    }
  }
  return text;
}

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------

function formatTs(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
