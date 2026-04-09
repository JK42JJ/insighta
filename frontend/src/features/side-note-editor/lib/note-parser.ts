/**
 * Client-side helpers for Tiptap JSON documents.
 * Mirrors src/modules/notes/tiptap-text-extract.ts but targeted at the frontend:
 *
 *  - parseRichNote: normalizes server responses (object | legacy-string | null)
 *  - isEmptyDoc:    predicate used by useAutoSave to skip empty saves if desired
 *  - extractPlainText: used for optimistic previews (not sent to server — BE dual-writes its own)
 */

export interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

export type TiptapDoc = TiptapNode & { type: 'doc' };

const BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
  'codeBlock',
  'horizontalRule',
]);

/** Minimal empty doc — single empty paragraph. */
export const EMPTY_DOC: TiptapDoc = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

export function wrapLegacyPlainText(text: string): TiptapDoc {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: text.length > 0 ? [{ type: 'text', text }] : undefined,
      },
    ],
  };
}

/**
 * Parse a rich-note value that may arrive as:
 *   - TiptapDoc object (canonical, server returns this)
 *   - string (legacy — should be rare after the GET endpoint wraps it server-side)
 *   - null / undefined (untouched)
 *
 * Returns null for empty/missing, TiptapDoc otherwise.
 */
export function parseRichNote(raw: unknown): TiptapDoc | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object' && raw !== null && (raw as { type?: string }).type === 'doc') {
    return raw as TiptapDoc;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as TiptapDoc;
        if (parsed && parsed.type === 'doc') return parsed;
      } catch {
        /* fall through to legacy wrap */
      }
    }
    return wrapLegacyPlainText(raw);
  }
  return null;
}

export function extractPlainText(doc: TiptapNode | null | undefined): string {
  if (!doc) return '';
  const chunks: string[] = [];
  const walk = (node: TiptapNode): void => {
    if (node.type === 'text' && typeof node.text === 'string') {
      chunks.push(node.text);
      return;
    }
    if (node.type === 'hardBreak') {
      chunks.push('\n');
      return;
    }
    if (node.content) {
      for (const child of node.content) walk(child);
    }
    if (BLOCK_TYPES.has(node.type)) {
      chunks.push('\n');
    }
  };
  walk(doc);
  return chunks
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function isEmptyDoc(doc: TiptapNode | null | undefined): boolean {
  if (!doc) return true;
  return extractPlainText(doc).length === 0;
}
