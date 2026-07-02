/**
 * Global Search API — GET /api/v1/search?q=&limit=
 *
 * Unified user-data search for the ⌘K palette (cards / mandalas / notes /
 * v2 summaries). Auth required; every group query is user-scoped inside
 * src/modules/search/global-search.ts (R3 — no cross-user leak).
 *
 * Design: docs/design/global-search-cmdk-2026-07-02.md
 */
import { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import {
  globalSearch,
  SEARCH_GROUP_LIMIT_DEFAULT,
  SEARCH_GROUP_LIMIT_MAX,
} from '../../modules/search/global-search';
import { logger } from '../../utils/logger';

function getUserId(request: FastifyRequest, reply: FastifyReply): string | null {
  if (!request.user || !('userId' in request.user)) {
    void reply.status(401).send({ error: 'Unauthorized' });
    return null;
  }
  return (request.user as { userId: string }).userId;
}

export const searchRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.get<{ Querystring: { q?: string; limit?: string } }>(
    '/',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = getUserId(request, reply);
      if (!userId) return;

      const q = (request.query.q ?? '').trim();
      if (q.length === 0) {
        return reply.status(400).send({ error: 'Query parameter "q" is required' });
      }

      const parsedLimit = Number.parseInt(request.query.limit ?? '', 10);
      const limitPerGroup = Number.isFinite(parsedLimit)
        ? Math.min(Math.max(parsedLimit, 1), SEARCH_GROUP_LIMIT_MAX)
        : SEARCH_GROUP_LIMIT_DEFAULT;

      try {
        const result = await globalSearch(userId, q, { limitPerGroup });
        return reply.send(result);
      } catch (err) {
        logger.error('[search] global search failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        return reply.status(500).send({ error: 'Search failed' });
      }
    }
  );

  done();
};
