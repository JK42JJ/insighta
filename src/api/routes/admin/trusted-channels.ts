/**
 * Admin registry for the newsletter's trusted channels.
 *
 * Mirrors `admin/channel-blocklist.ts` — list / add / update / remove, every
 * mutation admin-gated and logged. The difference is what the list means: the
 * blocklist keeps channels out of every surface, this one decides what a
 * single brief reads every week.
 *
 * A channel is added by pasting whatever the editor has — a URL, an @handle,
 * or a raw UC id — and the route resolves it against the YouTube API. Ids are
 * never typed by hand and never accepted unverified: a list whose entries were
 * transcribed is a list that silently points at the wrong channel.
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getPrismaClient } from '@/modules/database/client';
import { resolveChannel } from '@/modules/curation/channel-resolve';
import { resolveVideosApiKeys } from '@/skills/plugins/video-discover/v2/youtube-client';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'admin-trusted-channels' });

/** The ten brief categories (master spec §23). Mirrors admin/newsletter.ts. */
const CATEGORY_KEYS = new Set([
  'ai-tech',
  'career',
  'english',
  'investing',
  'shopping',
  'productivity',
  'dev',
  'health',
  'startup',
  'news-trend',
]);

const UUID = /^[0-9a-f-]{36}$/i;

const AddSchema = z.object({
  /** A channel URL, an @handle, or a bare UC id — whatever the editor has. */
  ref: z.string().min(2).max(200),
  categoryKey: z.string().min(1).max(40),
  tier: z.enum(['core', 'watch']).default('core'),
  reason: z.string().min(3),
});

const UpdateSchema = z.object({
  tier: z.enum(['core', 'watch']).optional(),
  reason: z.string().min(3).optional(),
  isActive: z.boolean().optional(),
});

export async function adminTrustedChannelsRoutes(fastify: FastifyInstance) {
  const adminAuth = { onRequest: [fastify.authenticate, fastify.authenticateAdmin] };

  // GET /api/v1/admin/trusted-channels?category=ai-tech
  fastify.get<{ Querystring: { category?: string } }>('/', adminAuth, async (request, reply) => {
    const category = request.query.category;
    const rows = await getPrismaClient().newsletter_trusted_channels.findMany({
      where: category ? { category_key: category } : undefined,
      orderBy: [{ category_key: 'asc' }, { tier: 'asc' }, { created_at: 'desc' }],
    });
    return reply.send({ status: 'ok', data: { entries: rows } });
  });

  // POST /api/v1/admin/trusted-channels
  fastify.post('/', adminAuth, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = AddSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        status: 'error',
        code: 'INVALID_BODY',
        message: parsed.error.issues[0]?.message ?? 'invalid body',
      });
    }
    const body = parsed.data;
    if (!CATEGORY_KEYS.has(body.categoryKey)) {
      return reply.code(400).send({
        status: 'error',
        code: 'UNKNOWN_CATEGORY',
        message: `unknown categoryKey "${body.categoryKey}"`,
      });
    }

    // Resolve before writing, through the same resolver channel-based curation
    // uses. An entry that does not correspond to a live channel is worse than
    // no entry: the harvest would skip it every week and report nothing wrong.
    // Costs 1 quota unit and returns the uploads playlist in the same response.
    const resolved = await resolveChannel(body.ref, resolveVideosApiKeys(process.env));
    if (!resolved) {
      return reply.code(404).send({
        status: 'error',
        code: 'CHANNEL_NOT_FOUND',
        message: `유튜브에서 "${body.ref}" 에 해당하는 채널을 찾지 못했습니다`,
      });
    }
    if (!resolved.uploadsPlaylistId) {
      return reply.code(422).send({
        status: 'error',
        code: 'NO_UPLOADS_PLAYLIST',
        message: `${resolved.title ?? resolved.channelId} 에 업로드 재생목록이 없어 수집할 것이 없습니다`,
      });
    }

    const existing = await getPrismaClient().newsletter_trusted_channels.findUnique({
      where: {
        category_key_channel_id: {
          category_key: body.categoryKey,
          channel_id: resolved.channelId,
        },
      },
      select: { id: true },
    });
    if (existing) {
      return reply.code(409).send({
        status: 'error',
        code: 'ALREADY_TRUSTED',
        message: `${resolved.title} 은(는) 이미 이 주제의 신뢰 채널입니다`,
      });
    }

    const userId = (request as unknown as { userId?: string }).userId ?? null;
    const row = await getPrismaClient().newsletter_trusted_channels.create({
      data: {
        channel_id: resolved.channelId,
        channel_title: resolved.title,
        uploads_playlist_id: resolved.uploadsPlaylistId,
        category_key: body.categoryKey,
        tier: body.tier,
        reason: body.reason,
        created_by: userId,
      },
    });
    log.info(
      `trusted channel added: ${resolved.channelId} (${resolved.title}) for ${body.categoryKey} by ${userId ?? '-'}`
    );
    return reply.code(201).send({ status: 'ok', data: { entry: row } });
  });

  // PATCH /api/v1/admin/trusted-channels/:id — tier, reason, active
  fastify.patch<{ Params: { id: string } }>('/:id', adminAuth, async (request, reply) => {
    if (!UUID.test(request.params.id)) {
      return reply.code(400).send({ status: 'error', code: 'INVALID_ID', message: 'invalid id' });
    }
    const parsed = UpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        status: 'error',
        code: 'INVALID_BODY',
        message: parsed.error.issues[0]?.message ?? 'invalid body',
      });
    }
    const body = parsed.data;
    if (Object.keys(body).length === 0) {
      return reply
        .code(400)
        .send({ status: 'error', code: 'NOTHING_TO_UPDATE', message: 'nothing to update' });
    }

    const row = await getPrismaClient()
      .newsletter_trusted_channels.update({
        where: { id: request.params.id },
        data: {
          ...(body.tier !== undefined ? { tier: body.tier } : {}),
          ...(body.reason !== undefined ? { reason: body.reason } : {}),
          ...(body.isActive !== undefined ? { is_active: body.isActive } : {}),
        },
      })
      .catch(() => null);
    if (!row)
      return reply.code(404).send({ status: 'error', code: 'NOT_FOUND', message: 'not found' });

    log.info(`trusted channel updated: ${request.params.id} ${JSON.stringify(body)}`);
    return reply.send({ status: 'ok', data: { entry: row } });
  });

  // DELETE /api/v1/admin/trusted-channels/:id
  fastify.delete<{ Params: { id: string } }>('/:id', adminAuth, async (request, reply) => {
    if (!UUID.test(request.params.id)) {
      return reply.code(400).send({ status: 'error', code: 'INVALID_ID', message: 'invalid id' });
    }
    const deleted = await getPrismaClient()
      .newsletter_trusted_channels.delete({ where: { id: request.params.id } })
      .catch(() => null);
    if (!deleted)
      return reply.code(404).send({ status: 'error', code: 'NOT_FOUND', message: 'not found' });
    log.info(`trusted channel removed: ${request.params.id}`);
    return reply.send({ status: 'ok', data: { ok: true } });
  });
}
