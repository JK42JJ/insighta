/**
 * Internal video-pool promotion endpoints.
 *
 *   POST /api/v1/internal/video-pool/promote-from-v2             (CP438)
 *   POST /api/v1/internal/video-pool/promote-from-youtube-videos (CP494 ②)
 *   Body: { limit?: number; dry_run?: boolean }
 *   Auth: x-internal-token (same secret as bulk-upsert + transcript).
 *
 * promote-from-v2: up to `limit` (default 100) v2-summary rows → video_pool.
 * Quality tier from completeness (≥0.9 gold else silver).
 *
 * promote-from-youtube-videos (supply bridge): youtube_videos rows (Mac Mini
 * quota-0 collector sink) → video_pool, source='yt_promoted'. classifyQuality
 * gate (gold/silver only). Flag-gated by SUPPLY_YT_BRIDGE_ENABLED (default
 * off → {enabled:false} no-op; the same flag gates the v5 poolSources read).
 *
 * Both: embedding via Mac Mini Ollama (qwen3-embedding:8b, fail-open).
 *
 * Hard Rule (CP438):
 *   - No LLM API call in this path (embedding is local Ollama, not paid API).
 *   - Inserts only — no UPDATE, no DELETE on video_pool / video_pool_embeddings.
 */

import type { FastifyPluginAsync } from 'fastify';

import { config } from '@/config/index';
import { getInternalBatchToken } from '@/config/internal-auth';
import { promoteV2ToVideoPool } from '@/modules/video-pool/promote-from-v2';
import { promoteYoutubeVideosToPool } from '@/modules/video-pool/promote-from-youtube-videos';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'api/internal/video-pool-promote' });

interface PromoteBody {
  limit?: number;
  dry_run?: boolean;
  /** yt-bridge only (CP494 ⑤): promote without video_pool_embeddings writes. */
  skip_embeddings?: boolean;
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

  // CP494 ② supply bridge — youtube_videos → video_pool (source='yt_promoted').
  fastify.post<{ Body: PromoteBody }>(
    '/video-pool/promote-from-youtube-videos',
    async (request, reply) => {
      const expected = getInternalBatchToken();
      if (!expected) {
        return reply.code(503).send({ error: 'internal trigger not configured' });
      }
      const got = request.headers['x-internal-token'];
      if (typeof got !== 'string' || got !== expected) {
        return reply.code(401).send({ error: 'invalid internal token' });
      }

      // Flag off (default) = no-op: prod behavior unchanged until ⑤ 누적측정.
      if (!config.supplyYtBridge.enabled) {
        return reply.code(200).send({ enabled: false, promoted: 0 });
      }

      const limit = Math.max(
        1,
        Math.min(MAX_LIMIT, typeof request.body?.limit === 'number' ? request.body.limit : 100)
      );
      const dryRun = request.body?.dry_run === true;
      const skipEmbeddings = request.body?.skip_embeddings === true;

      try {
        const result = await promoteYoutubeVideosToPool({ limit, dryRun, skipEmbeddings });
        log.info('promote-from-youtube-videos endpoint done', {
          limit,
          dry_run: dryRun,
          skip_embeddings: skipEmbeddings,
          ...result,
          errors: result.errors.length,
        });
        return reply.code(200).send({
          enabled: true,
          limit,
          dry_run: dryRun,
          ...result,
          errors_sample: result.errors.slice(0, 5),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error('promote-from-youtube-videos endpoint failed', { err: msg });
        return reply.code(500).send({ error: msg.slice(0, 300) });
      }
    }
  );
};
