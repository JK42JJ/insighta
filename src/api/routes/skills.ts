/**
 * Skills API Routes — 3 endpoints
 *
 * GET  /api/v1/skills                   — List available skills for user's tier
 * POST /api/v1/skills/:skillId/preview  — Dry run (no actual execution)
 * POST /api/v1/skills/:skillId/execute  — Execute a skill
 *
 * Design: docs/design/skill-registry-handoff.md
 * Issue: #337 (Step 5)
 */

import { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { getPrismaClient } from '../../modules/database';
import { skillRegistry } from '../../modules/skills';
import { createGenerationProvider } from '../../modules/llm';
import type { Tier } from '../../config/quota';
import { createSuccessResponse, createErrorResponse, ErrorCode } from '../schemas/common.schema';

const SkillExecuteBodySchema = z.object({
  mandala_id: z.string().uuid(),
});

export const skillRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  /**
   * GET /api/v1/skills — List available skills for user's tier
   */
  fastify.get('/', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!request.user || !('userId' in request.user)) {
      return reply
        .code(401)
        .send(createErrorResponse(ErrorCode.UNAUTHORIZED, 'Unauthorized', '/skills'));
    }

    const db = getPrismaClient();
    const sub = await db.user_subscriptions.findUnique({
      where: { user_id: request.user.userId },
      select: { tier: true },
    });
    const tier = (sub?.tier ?? 'free') as Tier;

    const skills = skillRegistry.listForTier(tier).map((s) => ({
      id: s.id,
      description: s.description,
      version: s.version,
      trigger: s.trigger,
      inputSchema: s.inputSchema,
    }));

    return reply.send(createSuccessResponse(skills));
  });

  /**
   * POST /api/v1/skills/:skillId/preview — Dry run (no actual execution)
   */
  fastify.post<{ Params: { skillId: string }; Body: z.infer<typeof SkillExecuteBodySchema> }>(
    '/:skillId/preview',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      if (!request.user || !('userId' in request.user)) {
        return reply
          .code(401)
          .send(
            createErrorResponse(ErrorCode.UNAUTHORIZED, 'Unauthorized', '/skills/:skillId/preview')
          );
      }

      const { skillId } = request.params;
      const parsed = SkillExecuteBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(
            createErrorResponse(
              ErrorCode.VALIDATION_ERROR,
              parsed.error.message,
              '/skills/:skillId/preview'
            )
          );
      }

      const skill = skillRegistry.get(skillId);
      if (!skill) {
        return reply
          .code(404)
          .send(
            createErrorResponse(
              ErrorCode.RESOURCE_NOT_FOUND,
              `Skill not found: ${skillId}`,
              '/skills/:skillId/preview'
            )
          );
      }

      const db = getPrismaClient();
      const sub = await db.user_subscriptions.findUnique({
        where: { user_id: request.user.userId },
        select: { tier: true },
      });
      const tier = (sub?.tier ?? 'free') as Tier;
      const llm = await createGenerationProvider();

      const preview = await skill.dryRun({
        userId: request.user.userId,
        mandalaId: parsed.data.mandala_id,
        tier,
        llm,
      });

      return reply.send(createSuccessResponse(preview));
    }
  );

  /**
   * POST /api/v1/skills/:skillId/execute — Execute a skill
   */
  fastify.post<{ Params: { skillId: string }; Body: z.infer<typeof SkillExecuteBodySchema> }>(
    '/:skillId/execute',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      if (!request.user || !('userId' in request.user)) {
        return reply
          .code(401)
          .send(
            createErrorResponse(ErrorCode.UNAUTHORIZED, 'Unauthorized', '/skills/:skillId/execute')
          );
      }

      const { skillId } = request.params;
      const parsed = SkillExecuteBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(
            createErrorResponse(
              ErrorCode.VALIDATION_ERROR,
              parsed.error.message,
              '/skills/:skillId/execute'
            )
          );
      }

      const db = getPrismaClient();
      const sub = await db.user_subscriptions.findUnique({
        where: { user_id: request.user.userId },
        select: { tier: true },
      });
      const tier = (sub?.tier ?? 'free') as Tier;
      const llm = await createGenerationProvider();

      const result = await skillRegistry.execute(skillId, {
        userId: request.user.userId,
        mandalaId: parsed.data.mandala_id,
        tier,
        llm,
        params: parsed.data,
      });

      const statusCode = result.success ? 200 : 500;
      return reply.code(statusCode).send(createSuccessResponse(result));
    }
  );

  /**
   * GET /api/v1/skills/outputs — List user's skill outputs
   */
  fastify.get<{ Querystring: { mandala_id?: string; limit?: string } }>(
    '/outputs',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      if (!request.user || !('userId' in request.user)) {
        return reply
          .code(401)
          .send(createErrorResponse(ErrorCode.UNAUTHORIZED, 'Unauthorized', '/skills/outputs'));
      }

      const db = getPrismaClient();
      const mandalaId = request.query.mandala_id;
      const limit = Math.min(parseInt(request.query.limit ?? '10', 10), 50);

      const outputs = await db.$queryRaw`
        SELECT id, skill_type, title, content, cell_scope, card_count, model_used, created_at
        FROM skill_outputs
        WHERE user_id = ${request.user.userId}::uuid
          ${mandalaId ? Prisma.sql`AND mandala_id = ${mandalaId}::uuid` : Prisma.empty}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;

      return reply.send(createSuccessResponse(outputs));
    }
  );

  done();
};
