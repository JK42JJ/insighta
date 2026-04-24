/**
 * Internal trigger endpoint for the trend-collector skill.
 *
 * Mirrors the batch-video-collector pattern: protected by the same
 * shared token (`INTERNAL_BATCH_TOKEN`). Called by GitHub Actions
 * before batch-video-collector so trend_signals rows exist when
 * the batch collector reads them.
 *
 * POST /api/v1/internal/skills/trend-collector/run
 *   Headers: x-internal-token: <token>
 *   Body: {} (no params needed)
 *   Response: { status, data, metrics }
 *
 * CP426 (2026-04-25): created to fix "all GHA batch-video-collector
 * runs fail with empty_trend_signals" — trend-collector had no
 * automation, only a manual script (`scripts/run-trend-collector.ts`).
 */

import type { FastifyPluginAsync } from 'fastify';
import { skillRegistry } from '@/modules/skills/registry';
import { createGenerationProvider } from '@/modules/llm';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'api/internal/trend-collector' });

const SKILL_ID = 'trend-collector';
const DEFAULT_INTERNAL_USER_ID = '00000000-0000-0000-0000-000000000000';

export const internalTrendCollectorRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/trend-collector/run', async (request, reply) => {
    const expected = process.env['INTERNAL_BATCH_TOKEN'];
    if (!expected) {
      log.warn('INTERNAL_BATCH_TOKEN not set — refusing to run');
      return reply.code(503).send({ error: 'internal trigger not configured' });
    }
    const got = request.headers['x-internal-token'];
    if (typeof got !== 'string' || got !== expected) {
      log.warn('internal trigger rejected: bad token');
      return reply.code(401).send({ error: 'invalid internal token' });
    }

    const userId = process.env['INSIGHTA_BOT_USER_ID']?.trim() || DEFAULT_INTERNAL_USER_ID;

    try {
      const llm = await createGenerationProvider();
      const result = await skillRegistry.execute(SKILL_ID, {
        userId,
        mandalaId: '',
        tier: 'admin',
        llm,
      });
      return reply.code(result.success ? 200 : 500).send(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`trend-collector trigger failed: ${msg}`);
      return reply.code(500).send({ error: msg });
    }
  });
};
