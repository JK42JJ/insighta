/**
 * Invite tickets (초대권) — 2026-07-15 design (approved 시안).
 *
 * Each beta member may spend config.invites.defaultTickets (2) invitations.
 * A ticket delegates the PROVEN beta-invite pipeline (beta_applications row
 * + the field-verified invite email) to the member — no new invite system.
 *
 * Policy (from the approved spec):
 * - remaining is DERIVED: default − count(invited_by = me). No counter column.
 * - A ticket is consumed only when the email actually sends; on send failure
 *   the row change is rolled back.
 * - Already invited/joined addresses: no consumption, friendly error.
 * - A pending applicant invited by a member is UPGRADED to invited (queue
 *   jump — a legitimate ticket use).
 */

import { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { getPrismaClient } from '@/modules/database/client';
import { config } from '@/config/index';
import { sendBetaInviteEmail } from '@/modules/email/transactional';
import { normalizeBetaEmail } from './beta';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'routes/invites' });

export interface SentInvite {
  email: string;
  invitedAt: Date | null;
  joined: boolean;
}

/** Pure — unit-tested. */
export function computeRemaining(defaultTickets: number, used: number): number {
  return Math.max(0, Math.trunc(defaultTickets) - Math.max(0, Math.trunc(used)));
}

async function inviterDisplayName(userId: string): Promise<string | null> {
  try {
    const rows = await getPrismaClient().$queryRaw<Array<{ name: string | null }>>(
      Prisma.sql`SELECT COALESCE(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name') AS name
                 FROM auth.users WHERE id = ${userId}::uuid LIMIT 1`
    );
    return rows[0]?.name?.trim() || null;
  } catch {
    return null;
  }
}

async function joinedEmailSet(emails: string[]): Promise<Set<string>> {
  if (!emails.length) return new Set();
  try {
    const rows = await getPrismaClient().$queryRaw<Array<{ email: string }>>(
      Prisma.sql`SELECT lower(email) AS email FROM auth.users WHERE lower(email) IN (${Prisma.join(emails)})`
    );
    return new Set(rows.map((r) => r.email));
  } catch {
    return new Set();
  }
}

export async function inviteRoutes(fastify: FastifyInstance): Promise<void> {
  const auth = { onRequest: [fastify.authenticate] };

  // 내 초대권 현황 — 잔여 + 보낸 초대(가입 여부 포함)
  fastify.get('/', auth, async (request, reply) => {
    const userId = (request.user as { userId?: string } | undefined)?.userId;
    if (!userId) return reply.code(401).send({ status: 'error', error: 'Unauthorized' });

    const prisma = getPrismaClient();
    const sent = await prisma.beta_applications.findMany({
      where: { invited_by: userId },
      orderBy: { invited_at: 'asc' },
      select: { email: true, invited_at: true },
    });
    const joined = await joinedEmailSet(sent.map((s) => s.email.toLowerCase()));
    const invites: SentInvite[] = sent.map((s) => ({
      email: s.email,
      invitedAt: s.invited_at,
      joined: joined.has(s.email.toLowerCase()),
    }));
    return reply.code(200).send({
      status: 'ok',
      data: {
        total: config.invites.defaultTickets,
        remaining: computeRemaining(config.invites.defaultTickets, sent.length),
        invites,
      },
    });
  });

  // 초대권 사용 — 명부 등록/승격 + 검증된 초대 메일 발송
  fastify.post<{ Body: { email?: string } }>('/', auth, async (request, reply) => {
    const userId = (request.user as { userId?: string } | undefined)?.userId;
    if (!userId) return reply.code(401).send({ status: 'error', error: 'Unauthorized' });

    const email = normalizeBetaEmail(request.body?.email);
    if (!email) {
      return reply.code(400).send({ status: 'error', code: 'INVALID_EMAIL' });
    }

    const prisma = getPrismaClient();
    const used = await prisma.beta_applications.count({ where: { invited_by: userId } });
    if (computeRemaining(config.invites.defaultTickets, used) <= 0) {
      return reply.code(409).send({ status: 'error', code: 'NO_TICKETS' });
    }

    const existing = await prisma.beta_applications.findUnique({ where: { email } });
    if (existing && existing.status === 'invited') {
      return reply.code(409).send({ status: 'error', code: 'ALREADY_INVITED' });
    }
    if ((await joinedEmailSet([email])).has(email)) {
      return reply.code(409).send({ status: 'error', code: 'ALREADY_MEMBER' });
    }

    // Register/upgrade first, then send; roll back on send failure so a
    // ticket is only consumed by a successfully delivered invitation.
    const prior = existing ? { status: existing.status, invited_by: existing.invited_by } : null;
    const row = existing
      ? await prisma.beta_applications.update({
          where: { email },
          data: { status: 'invited', invited_at: new Date(), invited_by: userId },
        })
      : await prisma.beta_applications.create({
          data: { email, status: 'invited', invited_at: new Date(), invited_by: userId },
        });

    try {
      const inviterName = await inviterDisplayName(userId);
      await sendBetaInviteEmail(row.email, { goal: row.goal, inviterName });
    } catch (err) {
      // rollback — the ticket must not be consumed
      if (prior) {
        await prisma.beta_applications.update({
          where: { email },
          data: { status: prior.status, invited_by: prior.invited_by },
        });
      } else {
        await prisma.beta_applications.deleteMany({ where: { email, invited_by: userId } });
      }
      log.error('invite email send failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return reply.code(502).send({ status: 'error', code: 'SEND_FAILED' });
    }

    return reply.code(200).send({
      status: 'ok',
      data: { remaining: computeRemaining(config.invites.defaultTickets, used + 1) },
    });
  });
}
