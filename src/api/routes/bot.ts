/**
 * Bot Approval API Routes
 *
 * Provides approval flow for bot write operations.
 * Bot requests approval → user confirms → bot receives token → uses for write.
 *
 * Related: #304 (Clawbot snapshot + rollback + approval button)
 */

import { FastifyPluginCallback } from 'fastify';
import { Prisma } from '@prisma/client';
import { getPrismaClient } from '../../modules/database';
import { createErrorResponse, ErrorCode } from '../schemas/common.schema';
import { generateApprovalToken, getTokenExpiry } from '../plugins/bot-write-guard';

export const botRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  /**
   * POST /api/v1/bot/request-approval — Bot requests write approval
   * Returns a pending token that the user must approve
   */
  fastify.post(
    '/request-approval',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user.userId;
      const { action_summary, preview_data } = request.body as {
        action_summary: string;
        preview_data?: Record<string, unknown>;
      };

      if (!action_summary) {
        return reply
          .code(400)
          .send(
            createErrorResponse(
              ErrorCode.VALIDATION_ERROR,
              'action_summary is required',
              request.url
            )
          );
      }

      const prisma = getPrismaClient();
      const token = generateApprovalToken();
      const expiresAt = getTokenExpiry();

      const approval = await prisma.bot_approval_tokens.create({
        data: {
          user_id: userId,
          action_summary,
          preview_data: (preview_data ?? undefined) as Prisma.InputJsonValue | undefined,
          token,
          status: 'pending',
          expires_at: expiresAt,
        },
      });

      return reply.code(201).send({
        status: 'ok',
        data: {
          id: approval.id,
          action_summary,
          token,
          expires_at: expiresAt,
          status: 'pending',
          hint: 'User must call POST /api/v1/bot/approve/:token to activate',
        },
      });
    }
  );

  /**
   * POST /api/v1/bot/approve/:token — User approves a pending token
   */
  fastify.post('/approve/:token', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user.userId;
    const { token } = request.params as { token: string };
    const prisma = getPrismaClient();

    const approval = await prisma.bot_approval_tokens.findFirst({
      where: {
        token,
        user_id: userId,
        status: 'pending',
        expires_at: { gte: new Date() },
      },
    });

    if (!approval) {
      return reply
        .code(404)
        .send(
          createErrorResponse(
            ErrorCode.RESOURCE_NOT_FOUND,
            'Token not found, expired, or already used',
            request.url
          )
        );
    }

    await prisma.bot_approval_tokens.update({
      where: { id: approval.id },
      data: { status: 'approved' },
    });

    return reply.send({
      status: 'ok',
      data: {
        id: approval.id,
        action_summary: approval.action_summary,
        token: approval.token,
        status: 'approved',
      },
    });
  });

  /**
   * GET /api/v1/bot/pending — List pending approvals for current user
   */
  fastify.get('/pending', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user.userId;
    const prisma = getPrismaClient();

    const pending = await prisma.bot_approval_tokens.findMany({
      where: {
        user_id: userId,
        status: 'pending',
        expires_at: { gte: new Date() },
      },
      select: {
        id: true,
        action_summary: true,
        created_at: true,
        expires_at: true,
      },
      orderBy: { created_at: 'desc' },
      take: 10,
    });

    return reply.send({ status: 'ok', data: pending });
  });

  fastify.log.info('Bot approval routes registered');
  done();
};

export default botRoutes;
