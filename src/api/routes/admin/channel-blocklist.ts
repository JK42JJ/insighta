/**
 * Admin registry for the channel blocklist (P0 scam-inflow, 2026-07-03).
 * List / add / remove. Every mutation is admin-gated and logged.
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getPrismaClient } from '@/modules/database/client';
import { resetChannelBlocklistCacheForTest } from '@/modules/moderation/channel-blocklist';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'admin-channel-blocklist' });

const AddSchema = z
  .object({
    channelId: z.string().max(64).optional(),
    channelName: z.string().max(200).optional(),
    reason: z.string().min(3),
  })
  .refine((v) => v.channelId || v.channelName, {
    message: 'channelId or channelName required',
  });

export async function adminChannelBlocklistRoutes(fastify: FastifyInstance) {
  const adminAuth = { onRequest: [fastify.authenticate, fastify.authenticateAdmin] };

  // GET /api/v1/admin/channel-blocklist
  fastify.get('/', adminAuth, async (_req: FastifyRequest, reply: FastifyReply) => {
    const rows = await getPrismaClient().channel_blocklist.findMany({
      orderBy: { created_at: 'desc' },
    });
    return reply.send({ entries: rows });
  });

  // POST /api/v1/admin/channel-blocklist
  fastify.post('/', adminAuth, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = AddSchema.parse(req.body);
    const userId = (req as unknown as { userId?: string }).userId ?? null;
    const row = await getPrismaClient().channel_blocklist.create({
      data: {
        channel_id: body.channelId ?? null,
        channel_name: body.channelName ?? null,
        reason: body.reason,
        created_by: userId,
      },
    });
    // Blocks must take effect promptly — drop the 60s snapshot.
    resetChannelBlocklistCacheForTest();
    log.info(
      `channel blocklisted: id=${body.channelId ?? '-'} name=${body.channelName ?? '-'} by=${userId ?? '-'}`
    );
    return reply.code(201).send({ entry: row });
  });

  // DELETE /api/v1/admin/channel-blocklist/:id
  fastify.delete('/:id', adminAuth, async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    await getPrismaClient().channel_blocklist.delete({ where: { id } });
    resetChannelBlocklistCacheForTest();
    log.info(`channel blocklist entry removed: ${id}`);
    return reply.send({ ok: true });
  });
}
