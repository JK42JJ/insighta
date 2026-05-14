/**
 * Internal Google CSE search endpoint — PoC for web fallback.
 *
 * Use-case: video_pool sparse-domain mandalas (e.g. "baseball draft",
 * niche K-pop topics) where YouTube-only discovery returns < 6 cards.
 * This endpoint lets an internal caller verify CSE result quality before
 * a full video_pool integration PR.
 *
 * Protected by the shared `INTERNAL_BATCH_TOKEN` (x-internal-token header),
 * identical to other internal/* routes. DO NOT expose to the browser.
 *
 * GET /api/v1/internal/google-cse/search?q=<query>&num=10&safe=off
 *   Headers: x-internal-token: <INTERNAL_BATCH_TOKEN>
 *   Response: { enabled, query, totalResults, items: [...] }
 *
 * When GOOGLE_CSE_API_KEY or GOOGLE_CSE_CX are unset:
 *   503 { error: 'google-cse not configured', enabled: false }
 *
 * CP458 T4-1 PoC — video_pool integration is a SEPARATE follow-up PR.
 */

import type { FastifyPluginAsync } from 'fastify';
import { getInternalBatchToken } from '@/config/internal-auth';
import { googleCseConfig, createGoogleCseClient } from '@/modules/google-cse';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'api/internal/google-cse' });

export const internalGoogleCseRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{
    Querystring: { q?: string; num?: string; safe?: string };
  }>('/search', async (request, reply) => {
    // Token guard — same pattern as batch-video-collector.ts
    const expected = getInternalBatchToken();
    if (!expected) {
      log.warn('INTERNAL_BATCH_TOKEN not set — refusing google-cse request');
      return reply.code(503).send({ error: 'internal trigger not configured' });
    }
    const got = request.headers['x-internal-token'];
    if (typeof got !== 'string' || got !== expected) {
      log.warn('google-cse internal route: invalid token');
      return reply.code(401).send({ error: 'invalid internal token' });
    }

    // Enabled guard
    if (!googleCseConfig.enabled) {
      return reply.code(503).send({
        enabled: false,
        error: 'google-cse not configured (GOOGLE_CSE_API_KEY or GOOGLE_CSE_CX unset)',
      });
    }

    const query = (request.query.q ?? '').trim();
    if (!query) {
      return reply.code(400).send({ error: 'q parameter is required' });
    }

    const num = Math.min(parseInt(request.query.num ?? '10', 10) || 10, 10);
    const safe = request.query.safe === 'active' ? 'active' : ('off' as const);

    const client = createGoogleCseClient(googleCseConfig);
    const result = await client.searchWeb(query, { num, safe });

    if (result.error && result.items.length === 0) {
      log.warn(`CSE search returned error: query="${query}" error=${result.error}`);
      return reply.code(502).send({ enabled: true, query, error: result.error });
    }

    return reply.code(200).send({
      enabled: true,
      query,
      totalResults: result.totalResults,
      count: result.items.length,
      items: result.items,
    });
  });
};
