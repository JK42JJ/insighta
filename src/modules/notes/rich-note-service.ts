/**
 * Rich Note Service
 *
 * Backs the Notion-style side editor (Phase 1-4 MVP).
 *
 * Source-aware routing (CP501 — ① note write-dead fix):
 *   A card id is an opaque uuid that can belong to EITHER user_video_states
 *   (uvs) OR user_local_cards (ulc). The caller passes the origin table via
 *   `sourceTable` so this single service routes read/write to the right table
 *   — no per-call-site branching (canonical-layer first application).
 *   - uvs: dual-writes Tiptap JSON (`user_note_json`, source of truth) + a
 *     plain-text extract (`user_note`) so the eviction rule (WHERE user_note
 *     IS NULL) keeps working.
 *   - ulc: has NO `user_note_json` column → stores the plain-text extract only
 *     (`user_note`). Rich formatting is not persisted for ulc cards (full rich
 *     parity would require a DDL column-add — tracked as (a)-B, out of scope).
 *
 * Contract:
 *   - getRichNote(): returns Tiptap JSON if available; if only legacy/plain text
 *     exists, wraps it into a read-only paragraph doc (DB is NOT modified here).
 *   - saveRichNote(): persists the user-edited doc. Empty docs clear the note
 *     column(s) so the card returns to eviction eligibility. Only the edited
 *     doc is written — no legacy/bulk write-through migration.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../database';
import type { TiptapDoc, TiptapNode } from './tiptap-schema';
import { extractPlainText, isEmptyDoc } from './tiptap-text-extract';
import { logger } from '../../utils/logger';

/** Origin table of a card id. Mirrors InsightCard.sourceTable on the FE. */
export type NoteSourceTable = 'user_video_states' | 'user_local_cards';

export interface RichNoteView {
  /** Tiptap JSON to render in the editor. Never null — legacy text is wrapped. */
  note: TiptapDoc | null;
  /** True when returned note was synthesized from a legacy/plain-text value. */
  isLegacy: boolean;
  /** Last-updated timestamp (ISO string). */
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
  constructor(message = 'card row not found') {
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

/** True when the Prisma error signals "row not found" for an update. */
function isRowNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'P2025'
  );
}

export class RichNoteService {
  constructor(private readonly db: PrismaClient = getPrismaClient()) {}

  /** Route a read to the correct origin table. Defaults to uvs (back-compat). */
  async getRichNote(
    userId: string,
    cardId: string,
    sourceTable: NoteSourceTable = 'user_video_states'
  ): Promise<RichNoteView> {
    return sourceTable === 'user_local_cards'
      ? this.getRichNoteFromLocalCard(userId, cardId)
      : this.getRichNoteFromVideoState(userId, cardId);
  }

  /** Route a write to the correct origin table. Defaults to uvs (back-compat). */
  async saveRichNote(
    userId: string,
    cardId: string,
    doc: TiptapNode,
    sourceTable: NoteSourceTable = 'user_video_states'
  ): Promise<{ updatedAt: string }> {
    return sourceTable === 'user_local_cards'
      ? this.saveRichNoteToLocalCard(userId, cardId, doc)
      : this.saveRichNoteToVideoState(userId, cardId, doc);
  }

  // ---------------------------------------------------------------------------
  // user_video_states (uvs) — dual-write JSON + plain extract (unchanged)
  // ---------------------------------------------------------------------------

  private async getRichNoteFromVideoState(userId: string, cardId: string): Promise<RichNoteView> {
    const row = await this.db.userVideoState.findFirst({
      where: { id: cardId, user_id: userId },
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
      throw new RichNoteNotFoundError(`No user_video_state for user=${userId} card=${cardId}`);
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
   *
   * Ownership is enforced by checking user_id before the UPDATE so an attacker
   * cannot overwrite another user's note by guessing a card UUID.
   */
  private async saveRichNoteToVideoState(
    userId: string,
    cardId: string,
    doc: TiptapNode
  ): Promise<{ updatedAt: string }> {
    const empty = isEmptyDoc(doc);
    const plainText = empty ? null : extractPlainText(doc);

    // Verify ownership: the row must exist and belong to this user.
    const existing = await this.db.userVideoState.findUnique({
      where: { id: cardId },
      select: { user_id: true },
    });
    if (!existing || existing.user_id !== userId) {
      throw new RichNoteNotFoundError(`No user_video_state for user=${userId} card=${cardId}`);
    }

    try {
      const updated = await this.db.userVideoState.update({
        where: { id: cardId },
        data: {
          user_note_json: empty ? Prisma.JsonNull : (doc as unknown as Prisma.InputJsonValue),
          user_note: plainText,
        },
        select: { updatedAt: true },
      });
      return { updatedAt: updated.updatedAt.toISOString() };
    } catch (err) {
      if (isRowNotFound(err)) {
        throw new RichNoteNotFoundError(`No user_video_state for user=${userId} card=${cardId}`);
      }
      logger.error('rich-note-service: uvs save failed', { err, userId, cardId, empty });
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // user_local_cards (ulc) — plain-text only (no user_note_json column)
  // ---------------------------------------------------------------------------

  private async getRichNoteFromLocalCard(userId: string, cardId: string): Promise<RichNoteView> {
    const row = await this.db.user_local_cards.findFirst({
      where: { id: cardId, user_id: userId },
      select: {
        user_note: true,
        updated_at: true,
        title: true,
        metadata_title: true,
        metadata_image: true,
        video_id: true,
        mandala_id: true,
        cell_index: true,
      },
    });

    if (!row) {
      throw new RichNoteNotFoundError(`No user_local_card for user=${userId} card=${cardId}`);
    }

    // ulc stores plain text only → any existing note is wrapped (always legacy).
    const note =
      row.user_note && row.user_note.length > 0 ? wrapLegacyPlainText(row.user_note) : null;

    return {
      note,
      isLegacy: note !== null,
      updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
      video: {
        id: row.video_id ?? cardId,
        title: row.title ?? row.metadata_title ?? '',
        channel: null,
        durationSec: null,
        thumbnail: row.metadata_image ?? null,
      },
      mandalaCell:
        row.mandala_id && typeof row.cell_index === 'number' && row.cell_index >= 0
          ? { mandalaId: row.mandala_id, cellIndex: row.cell_index }
          : null,
    };
  }

  /**
   * Write the plain-text extract to user_local_cards.user_note. ulc has no
   * user_note_json column, so rich formatting is not persisted (the editor
   * round-trips as plain text). Empty docs clear the note. updated_at is set
   * explicitly because ulc.updated_at is `@default(now())` without `@updatedAt`.
   */
  private async saveRichNoteToLocalCard(
    userId: string,
    cardId: string,
    doc: TiptapNode
  ): Promise<{ updatedAt: string }> {
    const empty = isEmptyDoc(doc);
    const plainText = empty ? null : extractPlainText(doc);

    const existing = await this.db.user_local_cards.findUnique({
      where: { id: cardId },
      select: { user_id: true },
    });
    if (!existing || existing.user_id !== userId) {
      throw new RichNoteNotFoundError(`No user_local_card for user=${userId} card=${cardId}`);
    }

    try {
      const now = new Date();
      const updated = await this.db.user_local_cards.update({
        where: { id: cardId },
        data: { user_note: plainText, updated_at: now },
        select: { updated_at: true },
      });
      return { updatedAt: (updated.updated_at ?? now).toISOString() };
    } catch (err) {
      if (isRowNotFound(err)) {
        throw new RichNoteNotFoundError(`No user_local_card for user=${userId} card=${cardId}`);
      }
      logger.error('rich-note-service: ulc save failed', { err, userId, cardId, empty });
      throw err;
    }
  }
}

let singleton: RichNoteService | null = null;
export function getRichNoteService(): RichNoteService {
  if (!singleton) singleton = new RichNoteService();
  return singleton;
}
