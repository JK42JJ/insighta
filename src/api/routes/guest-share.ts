/**
 * Guest share — 48h logged-out listening for a shared note (2026-07-14).
 *
 * The share button on the note screen mints a signed token
 * (`g1.<payload>.<sig>`, HMAC-SHA256 with ENCRYPTION_SECRET) scoping ONE
 * mandala for 48 hours. Guests read the note through the /guest/* routes
 * below — no account, no writes, no render triggers (cost guard). After
 * expiry the player shows the login prompt.
 *
 * Self-contained on purpose: existing authenticated routes stay untouched
 * (in-flight mandalas.ts work from other sessions).
 */

import { FastifyInstance } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getPrismaClient } from '@/modules/database/client';
import { config } from '@/config/index';
import { logger } from '@/utils/logger';
import type { EpisodeManifest } from '@/modules/narration/render-episode';

const log = logger.child({ module: 'routes/guest-share' });

const GUEST_SHARE_TTL_HOURS = 48;
const TOKEN_PREFIX = 'g1';

interface GuestPayload {
  /** mandala id */
  m: string;
  /** expiry, epoch seconds */
  x: number;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function sign(payloadJson: string): string {
  return b64url(createHmac('sha256', config.encryption.secret).update(payloadJson).digest());
}

export function mintGuestToken(mandalaId: string): string {
  const payload: GuestPayload = {
    m: mandalaId,
    x: Math.floor(Date.now() / 1000) + GUEST_SHARE_TTL_HOURS * 3600,
  };
  const json = JSON.stringify(payload);
  return `${TOKEN_PREFIX}.${b64url(Buffer.from(json))}.${sign(json)}`;
}

/** Returns the mandala id for a valid, unexpired token; null otherwise. */
export function verifyGuestToken(token: string): string | null {
  try {
    const [prefix, payloadB64, sig] = token.split('.');
    if (prefix !== TOKEN_PREFIX || !payloadB64 || !sig) return null;
    const json = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const expected = sign(json);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(json) as GuestPayload;
    if (!payload.m || typeof payload.x !== 'number') return null;
    if (payload.x * 1000 < Date.now()) return null;
    return payload.m;
  } catch {
    return null;
  }
}

/** POST /mandalas/:id/share-token — owner mints a 48h guest link. */
export async function shareTokenRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Params: { id: string } }>(
    '/:id/share-token',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = (request.user as { userId?: string } | undefined)?.userId;
      if (!userId) return reply.code(401).send({ status: 'error', error: 'Unauthorized' });
      const { id: mandalaId } = request.params;

      const mandala = await getPrismaClient().user_mandalas.findFirst({
        where: { id: mandalaId, user_id: userId },
        select: { id: true },
      });
      if (!mandala) {
        return reply.code(404).send({ status: 'error', error: 'Mandala not found' });
      }
      const token = mintGuestToken(mandalaId);
      return reply.code(200).send({
        status: 'ok',
        data: { token, ttlHours: GUEST_SHARE_TTL_HOURS },
      });
    }
  );
}

/** Read-only guest routes (no auth). Prefix: /guest */
export async function guestNoteRoutes(fastify: FastifyInstance): Promise<void> {
  // 노트(book) — 제목 포함 (게스트 화면 타이틀용)
  fastify.get<{ Params: { token: string } }>('/:token/book', async (request, reply) => {
    const mandalaId = verifyGuestToken(request.params.token);
    if (!mandalaId) {
      return reply
        .code(401)
        .send({ status: 'error', code: 'GUEST_EXPIRED', message: 'link expired' });
    }
    const prisma = getPrismaClient();
    const mandala = await prisma.user_mandalas.findFirst({
      where: { id: mandalaId },
      select: { title: true },
    });
    const rows = await prisma.$queryRawUnsafe<Array<{ book_json: unknown; source_videos: number }>>(
      `SELECT book_json, source_videos FROM mandala_books WHERE mandala_id = $1::uuid LIMIT 1`,
      mandalaId
    );
    if (!mandala || !rows[0]) {
      return reply.code(404).send({ status: 'error', code: 'BOOK_NOT_FOUND' });
    }
    return reply.code(200).send({
      status: 'ok',
      data: { title: mandala.title, book: rows[0].book_json, sourceVideos: rows[0].source_videos },
    });
  });

  // 에피소드 오디오 — 캐시된 매니페스트만 (렌더 트리거 없음 = 비용 가드)
  fastify.get<{ Params: { token: string } }>('/:token/episode-audio', async (request, reply) => {
    const mandalaId = verifyGuestToken(request.params.token);
    if (!mandalaId) {
      return reply
        .code(401)
        .send({ status: 'error', code: 'GUEST_EXPIRED', message: 'link expired' });
    }
    if (!config.narration.enabled) {
      return reply.code(200).send({ status: 'ok', data: { enabled: false } });
    }
    const rows = await getPrismaClient().$queryRawUnsafe<
      Array<{ status: string; manifest_json: EpisodeManifest | null }>
    >(
      `SELECT status, manifest_json FROM mandala_episode_audio WHERE mandala_id = $1::uuid LIMIT 1`,
      mandalaId
    );
    const row = rows[0];
    if (row?.status === 'ready' && row.manifest_json) {
      return reply.code(200).send({
        status: 'ok',
        data: { enabled: true, status: 'ready', manifest: row.manifest_json },
      });
    }
    return reply.code(200).send({ status: 'ok', data: { enabled: true, status: 'rendering' } });
  });

  // 클립 경계용 rich-summary (모바일이 쓰는 필드만: segments.sections + oneLiner)
  fastify.get<{ Params: { token: string; vid: string } }>(
    '/:token/video/:vid/rich-summary',
    async (request, reply) => {
      const mandalaId = verifyGuestToken(request.params.token);
      if (!mandalaId) {
        return reply
          .code(401)
          .send({ status: 'error', code: 'GUEST_EXPIRED', message: 'link expired' });
      }
      const { vid } = request.params;
      if (!vid || vid.length > 20) {
        return reply.code(400).send({ status: 'error', error: 'invalid video id' });
      }
      const row = await getPrismaClient().video_rich_summaries.findUnique({
        where: { video_id: vid },
        select: { one_liner: true, segments: true },
      });
      if (!row) {
        return reply.code(404).send({ status: 'error', code: 'RICH_SUMMARY_NOT_FOUND' });
      }
      return reply.code(200).send({
        status: 'ok',
        data: { oneLiner: row.one_liner, segments: row.segments ?? null },
      });
    }
  );

  log.info('guest share routes registered');
}
