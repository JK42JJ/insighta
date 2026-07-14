/**
 * Guest listen — 48h logged-out access to a shared note (Share v2, 2026-07-14).
 *
 * v1 shipped a 150-char self-verifying HMAC token in the URL path; Fastify's
 * default maxParamLength (100) rejected it before any handler ran, and the
 * URL itself was unshippable in chat. v2 keys guest access on the 8-char
 * share_links code instead: short, revocable, one DB lookup
 * (docs/design/share-v2-2026-07-14.md).
 *
 * Routes stay read-only with NO render triggers (cost guard) — guests can
 * never enqueue ElevenLabs work.
 */

import { FastifyInstance } from 'fastify';
import { getPrismaClient } from '@/modules/database/client';
import { config } from '@/config/index';
import { resolveGuestMandala } from '@/modules/share-links/manager';
import type { EpisodeManifest } from '@/modules/narration/render-episode';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'routes/guest-share' });

/** Read-only guest routes (no auth). Prefix: /guest */
export async function guestNoteRoutes(fastify: FastifyInstance): Promise<void> {
  // 노트(book) — 제목 + 만다라 id (게스트 화면 타이틀·완청 localStorage 키용)
  fastify.get<{ Params: { code: string } }>('/:code/book', async (request, reply) => {
    const mandalaId = await resolveGuestMandala(request.params.code);
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
      data: {
        title: mandala.title,
        book: rows[0].book_json,
        sourceVideos: rows[0].source_videos,
        mandalaId,
      },
    });
  });

  // 에피소드 오디오 — 캐시된 매니페스트만 (렌더 트리거 없음 = 비용 가드)
  fastify.get<{ Params: { code: string } }>('/:code/episode-audio', async (request, reply) => {
    const mandalaId = await resolveGuestMandala(request.params.code);
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
  fastify.get<{ Params: { code: string; vid: string } }>(
    '/:code/video/:vid/rich-summary',
    async (request, reply) => {
      const mandalaId = await resolveGuestMandala(request.params.code);
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

  log.info('guest share routes registered (share-links v2)');
}
