/**
 * Extract plain text from a Tiptap JSON document.
 *
 * Used by the rich-note-service to dual-write a plain-text version of the
 * editor content into `user_video_states.user_note` for:
 *   1) Backwards compatibility with the existing eviction rule
 *      (src/modules/mandala/auto-add-recommendations.ts WHERE user_note IS NULL)
 *   2) Simple LIKE-based search on legacy API endpoints
 *
 * Block-level nodes are separated by newlines; inline text nodes are concatenated.
 */
import type { TiptapNode } from './tiptap-schema';

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

/**
 * Returns true if the document is effectively empty
 * (no text content, no meaningful nodes).
 */
export function isEmptyDoc(doc: TiptapNode | null | undefined): boolean {
  if (!doc) return true;
  return extractPlainText(doc).length === 0;
}
