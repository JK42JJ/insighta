/**
 * Snapshot get-or-extract endpoint (⑤).
 *
 * The slidegen consumer (④) sends a video_id + the high-relevance timestamps it
 * wants figures for; this returns FigureRef[] from cache, extracting the misses.
 *
 * Auth: x-internal-token (shared INTERNAL_BATCH_TOKEN), same as the other
 * internal routes. Serve-from-cache works even when the extractor is disabled.
 *
 *   POST /api/v1/internal/snapshot/get-or-extract
 *   body { videoId: string, ts: number[] }  →  { figures: FigureRef[] }
 */

import type { FastifyPluginAsync } from 'fastify';

import { getInternalBatchToken } from '@/config/internal-auth';
import { getOrExtractSnapshots } from '@/modules/snapshot/get-or-extract';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'api/internal/snapshot' });

interface GetOrExtractBody {
  videoId?: string;
  ts?: unknown;
}

export const internalSnapshotRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: GetOrExtractBody }>('/snapshot/get-or-extract', async (request, reply) => {
    const expected = getInternalBatchToken();
    if (!expected) return reply.code(503).send({ error: 'internal trigger not configured' });
    const got = request.headers['x-internal-token'];
    if (typeof got !== 'string' || got !== expected) {
      return reply.code(401).send({ error: 'invalid internal token' });
    }

    const body = request.body ?? {};
    const videoId = typeof body.videoId === 'string' ? body.videoId.trim() : '';
    if (!videoId) return reply.code(400).send({ error: 'videoId required' });

    const ts = Array.isArray(body.ts)
      ? body.ts.filter((t): t is number => typeof t === 'number' && Number.isFinite(t))
      : [];
    if (ts.length === 0) return reply.code(400).send({ error: 'ts (number[]) required' });

    const figures = await getOrExtractSnapshots(videoId, ts);
    log.info('snapshot get-or-extract', {
      videoId,
      requested: ts.length,
      returned: figures.length,
    });
    return reply.code(200).send({ figures });
  });
};
