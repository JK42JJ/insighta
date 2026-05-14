/**
 * Admin system_settings CRUD (CP456 Phase 5).
 *
 *   GET /api/v1/admin/settings/:key       — read current value
 *   PUT /api/v1/admin/settings/:key       — upsert, body { value }
 *
 * Both endpoints require `is_super_admin`. The settings module's in-memory
 * cache is invalidated on `setSetting` so the change propagates to the
 * billing-route guard immediately (no 30s wait).
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createErrorResponse, createSuccessResponse, ErrorCode } from '../../schemas/common.schema';
import { getSetting, setSetting } from '@/modules/system-settings';

const PutBodySchema = z.object({
  value: z.unknown(),
});

const KeyParamSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z][a-z0-9_]*$/, 'lowercase snake_case only'),
});

export async function adminSystemSettingsRoutes(fastify: FastifyInstance) {
  const adminAuth = { onRequest: [fastify.authenticate, fastify.authenticateAdmin] };

  fastify.get('/:key', adminAuth, async (request, reply) => {
    const params = KeyParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply
        .code(400)
        .send(createErrorResponse(ErrorCode.VALIDATION_ERROR, params.error.message, request.url));
    }
    const value = await getSetting<unknown>(params.data.key, null);
    return reply.send(createSuccessResponse({ key: params.data.key, value }));
  });

  fastify.put('/:key', adminAuth, async (request, reply) => {
    const params = KeyParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply
        .code(400)
        .send(createErrorResponse(ErrorCode.VALIDATION_ERROR, params.error.message, request.url));
    }
    const body = PutBodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply
        .code(400)
        .send(createErrorResponse(ErrorCode.VALIDATION_ERROR, body.error.message, request.url));
    }
    if (!request.user || !('userId' in request.user)) {
      return reply
        .code(401)
        .send(createErrorResponse(ErrorCode.UNAUTHORIZED, 'missing userId', request.url));
    }
    await setSetting(params.data.key, body.data.value, request.user.userId);
    return reply.send(createSuccessResponse({ key: params.data.key, value: body.data.value }));
  });
}
