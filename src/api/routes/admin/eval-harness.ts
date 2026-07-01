/**
 * Admin Eval Harness route (Observability G2-b).
 *
 * Triggers the Phase 3 golden-cohort gc baseline (run-harness.ts) and returns
 * the distribution. This is the G3 before/after baseline surface.
 *
 *   GET  /api/v1/admin/eval-harness/cohort  → the fixed golden cohort (confirm)
 *   POST /api/v1/admin/eval-harness/run     → run + upsert search_metrics_daily
 *        body { cacheOnly?: boolean, capPerMandala?: number }
 *
 * ⚠️ Governance: `cacheOnly=false` scores cache-misses via OpenRouter Haiku —
 * that is a PROD runtime admin action (James triggers, aware of scale/cost).
 * `cacheOnly=true` uses only stored relevance_pct (no LLM) and is the safe verify.
 *
 * Guarded by authenticate + authenticateAdmin.
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { createSuccessResponse } from '../../schemas/common.schema';
import { runGoldenCohortHarness } from '@/modules/eval-harness/run-harness';
import { GOLDEN_COHORT } from '@/modules/eval-harness/golden-cohort';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'AdminEvalHarness' });

const RunBodySchema = z.object({
  cacheOnly: z.boolean().optional(),
  capPerMandala: z.number().int().positive().max(200).optional(),
});

export async function adminEvalHarnessRoutes(fastify: FastifyInstance) {
  const adminAuth = { onRequest: [fastify.authenticate, fastify.authenticateAdmin] };

  /** GET /cohort — the frozen golden cohort (James confirms this set). */
  fastify.get('/cohort', adminAuth, async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(
      createSuccessResponse({ count: GOLDEN_COHORT.length, cohort: GOLDEN_COHORT })
    );
  });

  /**
   * POST /run — run the golden-cohort gc baseline.
   * cacheOnly=true → no Haiku (safe). cacheOnly=false → prod Haiku scoring of
   * cache-misses up to capPerMandala. Upserts today's search_metrics_daily.
   */
  fastify.post('/run', adminAuth, async (request: FastifyRequest, reply: FastifyReply) => {
    const { cacheOnly, capPerMandala } = RunBodySchema.parse(request.body ?? {});
    log.info('eval harness run requested', { cacheOnly, capPerMandala });
    const result = await runGoldenCohortHarness({ cacheOnly, capPerMandala });
    return reply.send(createSuccessResponse(result));
  });
}
