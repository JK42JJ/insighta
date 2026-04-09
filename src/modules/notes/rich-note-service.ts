/**
 * Rich Note Service
 *
 * Backs the Notion-style side editor (Phase 1-4 MVP).
 * Persists Tiptap JSON in `user_video_states.user_note_json` (source of truth)
 * AND a plain-text extract in `user_video_states.user_note` so that the
 * existing eviction rule (WHERE user_note IS NULL) continues to work unchanged.
 *
 * Contract:
 *   - getRichNote(): returns Tiptap JSON if available; if only legacy plain text exists,
 *     wraps it into a read-only paragraph doc (DB is NOT modified here — write-through
 *     migration happens on the first PATCH).
 *   - saveRichNote(): dual-writes both columns atomically in a single UPDATE.
 *     Empty docs clear both columns so the card returns to eviction eligibility.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../database';
import type { TiptapDoc, TiptapNode } from './tiptap-schema';
import { extractPlainText, isEmptyDoc } from './tiptap-text-extract';
import { logger } from '../../utils/logger';

export interface RichNoteView {
  /** Tiptap JSON to render in the editor. Never null — legacy text is wrapped. */
  note: TiptapDoc | null;
  /** True when returned note was synthesized from a legacy plain-text value. */
  isLegacy: boolean;
  /** Last-updated timestamp (ISO string) from user_video_states.updatedAt. */
  updatedAt: string | null;
  /** Video metadata for the editor header. */
  video: {
    id: string;
    title: string;
    channel: string | null;
    durationSec: number | null;
    thumbnail: string | null;
  };
  /** Mandala cell context (where this card lives). null for scratchpad. */
  mandalaCell: { mandalaId: string; cellIndex: number } | null;
}

export class RichNoteNotFoundError extends Error {
  constructor(message = 'user_video_state row not found') {
    super(message);
    this.name = 'RichNoteNotFoundError';
  }
}

/** Wrap a legacy plain-text user_note into a minimal Tiptap doc. */
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

/** Type-narrow the Prisma JSON column value to TiptapDoc. */
function coerceTiptapDoc(value: Prisma.JsonValue | null): TiptapDoc | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  const obj = value as { type?: unknown };
  if (obj.type !== 'doc') return null;
  return value as unknown as TiptapDoc;
}

export class RichNoteService {
  constructor(private readonly db: PrismaClient = getPrismaClient()) {}

  async getRichNote(userId: string, videoId: string): Promise<RichNoteView> {
    const row = await this.db.userVideoState.findUnique({
      where: { user_id_videoId: { user_id: userId, videoId } },
      select: {
        user_note: true,
        user_note_json: true,
        updatedAt: true,
        mandala_id: true,
        cell_index: true,
        video: {
          select: {
            id: true,
            title: true,
            channel_title: true,
            duration_seconds: true,
            thumbnail_url: true,
          },
        },
      },
    });

    if (!row) {
      throw new RichNoteNotFoundError(`No user_video_state for user=${userId} video=${videoId}`);
    }

    const jsonDoc = coerceTiptapDoc(row.user_note_json ?? null);
    let note: TiptapDoc | null = null;
    let isLegacy = false;
    if (jsonDoc) {
      note = jsonDoc;
    } else if (row.user_note && row.user_note.length > 0) {
      note = wrapLegacyPlainText(row.user_note);
      isLegacy = true;
    }

    return {
      note,
      isLegacy,
      updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
      video: {
        id: row.video.id,
        title: row.video.title ?? '',
        channel: row.video.channel_title ?? null,
        durationSec: row.video.duration_seconds ?? null,
        thumbnail: row.video.thumbnail_url ?? null,
      },
      mandalaCell:
        row.mandala_id && typeof row.cell_index === 'number' && row.cell_index >= 0
          ? { mandalaId: row.mandala_id, cellIndex: row.cell_index }
          : null,
    };
  }

  /**
   * Dual-write Tiptap JSON + plain-text extract.
   * Empty docs clear both columns so the row becomes eligible for eviction again.
   */
  async saveRichNote(
    userId: string,
    videoId: string,
    doc: TiptapNode
  ): Promise<{ updatedAt: string }> {
    const empty = isEmptyDoc(doc);
    const plainText = empty ? null : extractPlainText(doc);

    try {
      const updated = await this.db.userVideoState.update({
        where: { user_id_videoId: { user_id: userId, videoId } },
        data: {
          user_note_json: empty ? Prisma.JsonNull : (doc as unknown as Prisma.InputJsonValue),
          user_note: plainText,
        },
        select: { updatedAt: true },
      });
      return { updatedAt: updated.updatedAt.toISOString() };
    } catch (err) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code?: string }).code === 'P2025'
      ) {
        throw new RichNoteNotFoundError(`No user_video_state for user=${userId} video=${videoId}`);
      }
      logger.error('rich-note-service: save failed', { err, userId, videoId, empty });
      throw err;
    }
  }
}

let singleton: RichNoteService | null = null;
export function getRichNoteService(): RichNoteService {
  if (!singleton) singleton = new RichNoteService();
  return singleton;
}
