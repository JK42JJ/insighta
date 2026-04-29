/**
 * Internal video-pool promotion endpoint (CP438, 2026-04-29).
 *
 *   POST /api/v1/internal/video-pool/promote-from-v2
 *   Body: { limit?: number; dry_run?: boolean }
 *   Auth: x-internal-token (same secret as bulk-upsert + transcript).
 *
 * Promotes up to `limit` (default 100) v2-summary rows into `video_pool`.
 * Quality tier from completeness (≥0.9 gold else silver). Embedding via
 * Mac Mini Ollama (qwen3-embedding:8b, fail-open if unreachable).
 *
 * Hard Rule (CP438):
 *   - No LLM API call in this path (embedding is local Ollama, not paid API).
 *   - Inserts only — no UPDATE, no DELETE on video_pool / video_pool_embeddings.
 */

import type { FastifyPluginAsync } from 'fastify';

import { getInternalBatchToken } from '@/config/internal-auth';
import { promoteV2ToVideoPool } from '@/modules/video-pool/promote-from-v2';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'api/internal/video-pool-promote' });

interface PromoteBody {
  limit?: number;
  dry_run?: boolean;
}

const MAX_LIMIT = 500;

export const internalVideoPoolPromoteRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: PromoteBody }>('/video-pool/promote-from-v2', async (request, reply) => {
    const expected = getInternalBatchToken();
    if (!expected) {
      return reply.code(503).send({ error: 'internal trigger not configured' });
    }
    const got = request.headers['x-internal-token'];
    if (typeof got !== 'string' || got !== expected) {
      return reply.code(401).send({ error: 'invalid internal token' });
    }

    const limit = Math.max(
      1,
      Math.min(MAX_LIMIT, typeof request.body?.limit === 'number' ? request.body.limit : 100)
    );
    const dryRun = request.body?.dry_run === true;

    try {
      const result = await promoteV2ToVideoPool({ limit, dryRun });
      log.info('promote-from-v2 endpoint done', {
        limit,
        dry_run: dryRun,
        ...result,
        errors: result.errors.length,
      });
      return reply.code(200).send({
        limit,
        dry_run: dryRun,
        ...result,
        errors_sample: result.errors.slice(0, 5),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('promote-from-v2 endpoint failed', { err: msg });
      return reply.code(500).send({ error: msg.slice(0, 300) });
    }
  });
};
