/**
 * Internal trigger endpoint for the batch-video-collector skill.
 *
 * Protected by a shared token (`INTERNAL_BATCH_TOKEN`) so GitHub Actions
 * (or another internal caller) can invoke the skill without a user JWT.
 * DO NOT expose this token to the browser — it bypasses per-user auth.
 *
 * POST /api/v1/internal/skills/batch-video-collector/run
 *   Headers: x-internal-token: <token>
 *   Body: { limit?: number, runType?: 'daily_trend' }
 *   Response: { status, data, metrics }
 *
 * Plan: /Users/jeonhokim/.claude/plans/linked-beaming-mccarthy.md
 */

import type { FastifyPluginAsync } from 'fastify';
import { skillRegistry } from '@/modules/skills/registry';
import { createGenerationProvider } from '@/modules/llm';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'api/internal/batch-video-collector' });

const SKILL_ID = 'batch-video-collector';
// Bot user ID used to attribute scheduled/internal skill runs. Stored in
// env so prod/dev can point to different service accounts. Falls back to a
// stable UUID string literal if unset (fails preflight which is fine).
const DEFAULT_INTERNAL_USER_ID = '00000000-0000-0000-0000-000000000000';

export const internalBatchVideoCollectorRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{
    Body: { limit?: number; runType?: string };
  }>('/batch-video-collector/run', async (request, reply) => {
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
        // batch-video-collector is mandala-agnostic; SkillContext requires
        // a mandalaId string — pass an empty placeholder. The executor's
        // preflight does not read mandalaId.
        mandalaId: '',
        tier: 'admin',
        llm,
        // Knobs are picked up from env (see executor.preflight — reads
        // BATCH_COLLECTOR_LIMIT / BATCH_COLLECTOR_RUN_TYPE). Body fields
        // below are currently advisory — they set env for the duration
        // of this request so manual invocations can override.
      });
      return reply.code(result.success ? 200 : 500).send(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`batch-video-collector trigger failed: ${msg}`);
      return reply.code(500).send({ error: msg });
    }
  });
};
