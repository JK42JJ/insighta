/**
 * src/modules/chatbot-rag/note-loader.ts
 *
 * Block N source — compact excerpt of the user's note document for the
 * current mandala.
 *
 * `note_documents.content_json` is TipTap-format JSON. We flatten it to
 * plain text by walking the doc tree and concatenating `text` nodes, then
 * cap to MAX_NOTE_EXCERPT_CHARS so the system prompt stays compact even
 * when users write long notes (>10K chars).
 *
 * Per-(user, mandala) uniqueness invariant comes from the DB unique
 * constraint `uq_note_documents_user_mandala` (schema.prisma).
 *
 * Failures degrade silently to `null` (no row → user hasn't started a
 * note for this mandala yet; query error → don't block chatbot).
 */

import { getPrismaClient } from '@/modules/database/client';
import { logger } from '@/utils/logger';
import { MAX_NOTE_EXCERPT_CHARS, type NoteDraftContext } from './types';

const log = logger.child({ module: 'chatbot-rag/note-loader' });

export interface LoadNoteContextParams {
  userId: string;
  mandalaId: string;
}

interface TipTapNode {
  type?: string;
  text?: string;
  content?: TipTapNode[];
}

/**
 * Walks a TipTap doc and concatenates all text nodes with paragraph
 * breaks. Insertion of newline at block-level node boundaries keeps the
 * excerpt readable when rendered into a prompt.
 */
function flattenTipTap(doc: unknown): string {
  const parts: string[] = [];
  const visit = (node: TipTapNode | null | undefined): void => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.text === 'string') {
      parts.push(node.text);
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) visit(child);
      // Block-level nodes (paragraph, heading, listItem, etc.) get a
      // newline at the end so adjacent blocks don't run together.
      const blockTypes = new Set(['paragraph', 'heading', 'listItem', 'blockquote', 'codeBlock']);
      if (typeof node.type === 'string' && blockTypes.has(node.type)) {
        parts.push('\n');
      }
    }
  };
  if (doc && typeof doc === 'object') {
    visit(doc as TipTapNode);
  }
  // Collapse any stretch of whitespace > 2 chars into a single newline —
  // TipTap leaves stray spaces when content is sparse.
  return parts
    .join('')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

export async function loadNoteContext(
  params: LoadNoteContextParams
): Promise<NoteDraftContext | null> {
  if (!params.userId || !params.mandalaId) return null;
  const prisma = getPrismaClient();

  try {
    const row = await prisma.note_documents.findFirst({
      where: {
        user_id: params.userId,
        mandala_id: params.mandalaId,
      },
      select: {
        content_json: true,
        updated_at: true,
      },
    });
    if (!row) return null;

    const fullText = flattenTipTap(row.content_json);
    if (fullText.length === 0) return null;

    const truncated = fullText.length > MAX_NOTE_EXCERPT_CHARS;
    const excerpt = truncated ? fullText.slice(0, MAX_NOTE_EXCERPT_CHARS) : fullText;

    return {
      mandala_id: params.mandalaId,
      total_chars: fullText.length,
      excerpt,
      truncated,
      last_edited_at: row.updated_at.toISOString(),
    };
  } catch (err) {
    log.warn('note-loader query failed', {
      userId: params.userId,
      mandalaId: params.mandalaId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
