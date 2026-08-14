/**
 * Share v2 — single short-link backbone (2026-07-14 design:
 * docs/design/share-v2-2026-07-14.md).
 *
 * Every share surface mints one share_links row; GET /s/:code resolves it.
 * Server-side lookup (not a self-verifying token) so links stay short
 * (8 chars — the 150-char HMAC token exceeded Fastify's default
 * maxParamLength=100 and 404'd before reaching any handler) and revocable.
 */

import { customAlphabet } from 'nanoid';
import { getPrismaClient } from '@/modules/database/client';
import { MS_PER_DAY, MS_PER_HOUR } from '@/utils/time-constants';

// Unambiguous URL-safe alphabet (no 0/O/1/l/I) — codes are read aloud and
// retyped from chat messages.
const CODE_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 8;
const genCode = customAlphabet(CODE_ALPHABET, CODE_LENGTH);

export const GUEST_LISTEN_TTL_HOURS = 48;

export type ShareTargetType = 'note_episode' | 'learning_video' | 'mandala';
export type ShareMode = 'guest_listen' | 'view' | 'view_cards' | 'clone';

export interface ShareLinkRow {
  id: string;
  code: string;
  target_type: string;
  target_id: string;
  video_id: string | null;
  mode: string;
  expires_at: Date | null;
  revoked_at: Date | null;
  created_by: string;
}

export type ShareLinkState = 'valid' | 'expired' | 'revoked' | 'unknown';

/** Pure state machine — unit-tested; keep free of I/O. */
export function shareLinkState(row: ShareLinkRow | null, now: Date): ShareLinkState {
  if (!row) return 'unknown';
  if (row.revoked_at) return 'revoked';
  if (row.expires_at && row.expires_at.getTime() < now.getTime()) return 'expired';
  return 'valid';
}

/** Pure URL builder — single seam for every surface (and its length test). */
export function buildShortUrl(code: string, origin = 'https://insighta.one'): string {
  return `${origin}/s/${code}`;
}

export function isValidCode(code: string): boolean {
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c));
}

export interface CreateShareLinkInput {
  targetType: ShareTargetType;
  targetId: string;
  videoId?: string;
  mode?: ShareMode;
  expiresInDays?: number;
  userId: string;
}

/**
 * Mint a link. Ownership of the target mandala is verified here so every
 * calling route gets the same guarantee.
 */
export async function createShareLink(
  input: CreateShareLinkInput
): Promise<{ code: string; url: string; expiresAt: Date | null }> {
  const prisma = getPrismaClient();

  const mandala = await prisma.user_mandalas.findFirst({
    where: { id: input.targetId, user_id: input.userId },
    select: { id: true },
  });
  if (!mandala) throw new ShareLinkError('TARGET_NOT_FOUND');

  const mode: ShareMode =
    input.mode ?? (input.targetType === 'note_episode' ? 'guest_listen' : 'view');
  const expiresAt: Date | null =
    input.expiresInDays != null
      ? new Date(Date.now() + input.expiresInDays * MS_PER_DAY)
      : mode === 'guest_listen'
        ? new Date(Date.now() + GUEST_LISTEN_TTL_HOURS * MS_PER_HOUR)
        : null;

  // Reuse a live link for the same (creator, target, mode) — repeated share
  // taps must not pile up rows.
  const existing = await prisma.share_links.findFirst({
    where: {
      created_by: input.userId,
      target_type: input.targetType,
      target_id: input.targetId,
      video_id: input.videoId ?? null,
      mode,
      revoked_at: null,
    },
    orderBy: { created_at: 'desc' },
  });
  if (existing && shareLinkState(existing as ShareLinkRow, new Date()) === 'valid') {
    return {
      code: existing.code,
      url: buildShortUrl(existing.code),
      expiresAt: existing.expires_at,
    };
  }

  const row = await prisma.share_links.create({
    data: {
      code: genCode(),
      target_type: input.targetType,
      target_id: input.targetId,
      video_id: input.videoId ?? null,
      mode,
      expires_at: expiresAt,
      created_by: input.userId,
    },
  });
  return { code: row.code, url: buildShortUrl(row.code), expiresAt: row.expires_at };
}

export async function resolveShareLink(
  code: string
): Promise<{ state: ShareLinkState; row: ShareLinkRow | null }> {
  if (!isValidCode(code)) return { state: 'unknown', row: null };
  const row = (await getPrismaClient().share_links.findUnique({
    where: { code },
  })) as ShareLinkRow | null;
  return { state: shareLinkState(row, new Date()), row };
}

/** Guest listen access: resolve a code to its mandala id, or null. */
export async function resolveGuestMandala(code: string): Promise<string | null> {
  const { state, row } = await resolveShareLink(code);
  if (state !== 'valid' || !row) return null;
  if (row.target_type !== 'note_episode' || row.mode !== 'guest_listen') return null;
  return row.target_id;
}

export class ShareLinkError extends Error {
  constructor(public readonly code: 'TARGET_NOT_FOUND') {
    super(code);
  }
}
