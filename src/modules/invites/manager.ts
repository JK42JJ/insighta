/**
 * Invite tickets v2 — shareable invite links (2026-07-15 approved design).
 *
 * Each member gets config.invites.defaultTickets (2) invite LINKS. A link is
 * shared via the OS share sheet (any channel) and consumed only when someone
 * SIGNS UP through it (redeemed) — so an unredeemed link can be re-shared
 * freely until it lands a signup. Resolved through the /s/:code backbone.
 *
 * Supersedes the v1 email-input flow (docs/design invite v2 시안).
 */

import { customAlphabet } from 'nanoid';
import { getPrismaClient } from '@/modules/database/client';
import { config } from '@/config/index';

const CODE_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 8;
const genCode = customAlphabet(CODE_ALPHABET, CODE_LENGTH);

export function isValidInviteCode(code: string): boolean {
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c));
}

export interface InviteTicket {
  code: string;
  url: string;
  redeemed: boolean;
  inviteeMasked: string | null;
  redeemedAt: Date | null;
}

function shortUrl(code: string): string {
  return `${config.share.publicOrigin}/s/${code}`;
}

/**
 * Return the member's invite tickets, minting missing open slots so the user
 * always has `defaultTickets` links total (open + redeemed).
 */
export async function listTickets(
  userId: string
): Promise<{ total: number; tickets: InviteTicket[] }> {
  const prisma = getPrismaClient();
  const total = config.invites.defaultTickets;

  const existing = await prisma.invite_links.findMany({
    where: { inviter_id: userId },
    orderBy: { created_at: 'asc' },
  });

  // Top up open slots so the user always sees `total` tickets.
  const missing = total - existing.length;
  if (missing > 0) {
    for (let i = 0; i < missing; i++) {
      await prisma.invite_links.create({ data: { code: genCode(), inviter_id: userId } });
    }
    return listTickets(userId); // re-read once, now full
  }

  // Resolve invitee display (masked email) for redeemed links.
  const inviteeIds = existing.map((r) => r.invitee_id).filter((v): v is string => !!v);
  const emails = await inviteeEmails(inviteeIds);

  const tickets: InviteTicket[] = existing.slice(0, total).map((r) => ({
    code: r.code,
    url: shortUrl(r.code),
    redeemed: !!r.redeemed_at,
    inviteeMasked: r.invitee_id ? maskEmail(emails.get(r.invitee_id)) : null,
    redeemedAt: r.redeemed_at,
  }));
  return { total, tickets };
}

/** Inviter display name for the invite landing card. */
export async function inviterName(userId: string): Promise<string | null> {
  const map = await inviterNames([userId]);
  return map.get(userId) ?? null;
}

export async function inviterNames(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  try {
    const { Prisma } = await import('@prisma/client');
    const rows = await getPrismaClient().$queryRaw<Array<{ id: string; name: string | null }>>(
      Prisma.sql`SELECT id::text AS id, COALESCE(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name') AS name
                 FROM auth.users WHERE id IN (${Prisma.join(ids)})`
    );
    for (const r of rows) if (r.name?.trim()) out.set(r.id, r.name.trim());
  } catch {
    /* auth schema unreadable — fall back to null names */
  }
  return out;
}

async function inviteeEmails(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  try {
    const { Prisma } = await import('@prisma/client');
    const rows = await getPrismaClient().$queryRaw<Array<{ id: string; email: string }>>(
      Prisma.sql`SELECT id::text AS id, email FROM auth.users WHERE id IN (${Prisma.join(ids)})`
    );
    for (const r of rows) out.set(r.id, r.email);
  } catch {
    /* ignore */
  }
  return out;
}

function maskEmail(email: string | undefined): string | null {
  if (!email) return null;
  const [u, d] = email.split('@');
  return `${(u || '').slice(0, 3)}***@${d || ''}`;
}

export type RedeemResult = 'redeemed' | 'already' | 'self' | 'invalid' | 'used';

/**
 * Redeem an invite code for a freshly signed-up user. Idempotent per invitee:
 * a user can only ever be the invitee of one link.
 */
export async function redeemInvite(code: string, inviteeId: string): Promise<RedeemResult> {
  if (!isValidInviteCode(code)) return 'invalid';
  const prisma = getPrismaClient();

  const link = await prisma.invite_links.findUnique({ where: { code } });
  if (!link) return 'invalid';
  if (link.inviter_id === inviteeId) return 'self';
  if (link.redeemed_at) return 'used';

  // Has this user already been invited (via any link)? Then no-op.
  const priorAsInvitee = await prisma.invite_links.findFirst({ where: { invitee_id: inviteeId } });
  if (priorAsInvitee) return 'already';

  await prisma.invite_links.update({
    where: { code },
    data: { invitee_id: inviteeId, redeemed_at: new Date() },
  });
  return 'redeemed';
}

/** For the /s/:code resolver — is this code an invite link? Returns inviter id or null. */
export async function inviteInviterId(code: string): Promise<string | null> {
  if (!isValidInviteCode(code)) return null;
  const link = await getPrismaClient().invite_links.findUnique({
    where: { code },
    select: { inviter_id: true, redeemed_at: true },
  });
  if (!link || link.redeemed_at) return null;
  return link.inviter_id;
}
