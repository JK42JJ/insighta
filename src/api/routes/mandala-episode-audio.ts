/**
 * Episode narration audio — manifest read + lazy render trigger.
 *
 * GET /api/v1/mandalas/:id/episode-audio
 *   Flag off        → 200 { enabled:false }
 *   No book yet     → 200 { enabled:true, status:'no-book' }
 *   Ready & fresh   → 200 { enabled:true, status:'ready', manifest }
 *   Otherwise       → 200 { enabled:true, status:'rendering' } and, for the
 *                     mandala owner, enqueues a singleton render job (lazy
 *                     pre-produce — first open pays the render, replays are
 *                     cached; stale book version re-renders changed beats only).
 *
 * Registered under the /mandalas prefix. Lives in its own file to avoid
 * conflicts with in-flight mandalas.ts work from other sessions.
 */

import { FastifyInstance } from 'fastify';
import { getPrismaClient } from '@/modules/database/client';
import { config } from '@/config/index';
import { logger } from '@/utils/logger';
import { enqueueEpisodeNarrationRender } from '@/modules/queue/handlers/episode-narration-render';
import { MANIFEST_V, type EpisodeManifest } from '@/modules/narration/render-episode';

const log = logger.child({ module: 'routes/mandala-episode-audio' });

interface EpisodeAudioRow {
  status: string;
  host: string;
  book_version: number;
  manifest_json: EpisodeManifest | null;
  error: string | null;
}

export async function mandalaEpisodeAudioRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Params: { id: string } }>(
    '/:id/episode-audio',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = (request.user as { userId?: string } | undefined)?.userId;
      if (!userId) {
        return reply.code(401).send({ status: 'error', error: 'Unauthorized' });
      }
      const { id: mandalaId } = request.params;

      if (!config.narration.enabled) {
        return reply.code(200).send({ status: 'ok', data: { enabled: false } });
      }

      const prisma = getPrismaClient();
      const mandala = await prisma.user_mandalas.findFirst({
        where: { id: mandalaId, OR: [{ user_id: userId }, { is_public: true }] },
        select: { id: true, user_id: true },
      });
      if (!mandala) {
        return reply.code(404).send({ status: 'error', error: 'Mandala not found' });
      }

      const books = await prisma.$queryRawUnsafe<Array<{ version: number }>>(
        `SELECT version FROM mandala_books WHERE mandala_id = $1::uuid LIMIT 1`,
        mandalaId
      );
      if (!books[0]) {
        return reply.code(200).send({ status: 'ok', data: { enabled: true, status: 'no-book' } });
      }
      const bookVersion = books[0].version;

      const rows = await prisma.$queryRawUnsafe<EpisodeAudioRow[]>(
        `SELECT status, host, book_version, manifest_json, error
         FROM mandala_episode_audio WHERE mandala_id = $1::uuid LIMIT 1`,
        mandalaId
      );
      const row = rows[0];

      if (
        row?.status === 'ready' &&
        row.book_version === bookVersion &&
        row.manifest_json?.v === MANIFEST_V
      ) {
        return reply.code(200).send({
          status: 'ok',
          data: { enabled: true, status: 'ready', manifest: row.manifest_json },
        });
      }

      // Terminal failure for the current book version — surface without
      // re-enqueueing (over-budget etc. would fail identically again).
      if (row?.status === 'failed' && row.book_version === bookVersion) {
        return reply.code(200).send({
          status: 'ok',
          data: { enabled: true, status: 'failed' },
        });
      }

      // Lazy trigger — owner only, and only when not already in flight.
      // singletonKey on the job dedupes racing requests.
      if (mandala.user_id === userId && row?.status !== 'rendering') {
        try {
          await enqueueEpisodeNarrationRender({ mandalaId });
        } catch (err) {
          log.error('failed to enqueue narration render', {
            mandalaId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return reply.code(200).send({ status: 'ok', data: { enabled: true, status: 'rendering' } });
    }
  );
}
