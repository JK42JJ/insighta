/**
 * Internal playlist-import endpoint (CP458).
 *
 *   POST /api/v1/internal/playlist-import/from-user
 *   Body: { userId: string; limit?: number; dry_run?: boolean }
 *   Auth: x-internal-token (same shared secret as other internal/* routes).
 *
 * Imports all videos from the given user's curated YouTube playlists into
 * video_pool with source='user_playlist', quality_tier='gold'.
 * Embedding via Mac Mini Ollama (qwen3-embedding:8b, fail-open).
 *
 * Hard Rules:
 *   - No LLM API call in this path (embedding is local Ollama, not paid API).
 *   - Inserts only — no UPDATE, no DELETE on video_pool / video_pool_embeddings.
 */

import type { FastifyPluginAsync } from 'fastify';

import { getInternalBatchToken } from '@/config/internal-auth';
import { promotePlaylistsToVideoPool } from '@/modules/video-pool/promote-from-playlists';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'api/internal/playlist-import' });

interface PlaylistImportBody {
  userId: string;
  limit?: number;
  dry_run?: boolean;
}

const MAX_LIMIT = 500;

export const internalPlaylistImportRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: PlaylistImportBody }>('/from-user', async (request, reply) => {
    const expected = getInternalBatchToken();
    if (!expected) {
      return reply.code(503).send({ error: 'internal trigger not configured' });
    }
    const got = request.headers['x-internal-token'];
    if (typeof got !== 'string' || got !== expected) {
      return reply.code(401).send({ error: 'invalid internal token' });
    }

    const userId = request.body?.userId;
    if (!userId || typeof userId !== 'string') {
      return reply.code(400).send({ error: 'userId is required' });
    }

    const limit = Math.max(
      1,
      Math.min(MAX_LIMIT, typeof request.body?.limit === 'number' ? request.body.limit : 200)
    );
    const dryRun = request.body?.dry_run === true;

    try {
      const result = await promotePlaylistsToVideoPool({ userId, limit, dryRun });
      log.info('playlist-import endpoint done', {
        userId,
        limit,
        dry_run: dryRun,
        ...result,
        errors: result.errors.length,
      });
      return reply.code(200).send({
        userId,
        limit,
        dry_run: dryRun,
        ...result,
        errors_sample: result.errors.slice(0, 5),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('playlist-import endpoint failed', { userId, err: msg });
      return reply.code(500).send({ error: msg.slice(0, 300) });
    }
  });
};
