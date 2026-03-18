import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../../../modules/database/client';
import {
  createErrorResponse,
  createPaginatedResponse,
  createSuccessResponse,
  ErrorCode,
  PaginationQuerySchema,
} from '../../schemas/common.schema';

const PROMOTION_TYPES = ['tier_upgrade', 'limit_increase', 'trial_extension'] as const;

const CreatePromotionSchema = z.object({
  code: z.string().min(3).max(50),
  type: z.enum(PROMOTION_TYPES),
  value: z.record(z.unknown()),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  maxRedemptions: z.number().int().min(1).optional(),
});

const UpdatePromotionSchema = z.object({
  code: z.string().min(3).max(50).optional(),
  type: z.enum(PROMOTION_TYPES).optional(),
  value: z.record(z.unknown()).optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  maxRedemptions: z.number().int().min(1).nullable().optional(),
  isActive: z.boolean().optional(),
});

const PromotionListQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(['active', 'inactive', 'expired', 'all']).optional().default('all'),
});

export async function adminPromotionRoutes(fastify: FastifyInstance) {
  const adminAuth = { onRequest: [fastify.authenticate, fastify.authenticateAdmin] };

  // GET /api/v1/admin/promotions
  fastify.get('/', adminAuth, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = PromotionListQuerySchema.parse(request.query);
    const { page, limit, status } = query;
    const offset = (page - 1) * limit;

    let statusFilter = '';
    if (status === 'active') {
      statusFilter = 'AND p.is_active = true AND (p.ends_at IS NULL OR p.ends_at > NOW())';
    } else if (status === 'inactive') {
      statusFilter = 'AND p.is_active = false';
    } else if (status === 'expired') {
      statusFilter = 'AND p.ends_at IS NOT NULL AND p.ends_at <= NOW()';
    }

    const countResult = await db.$queryRawUnsafe<Array<{ total: number }>>(
      `SELECT COUNT(*)::int as total FROM public.admin_promotions p WHERE 1=1 ${statusFilter}`
    );
    const total = countResult[0]?.total ?? 0;

    const promotions = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT
        p.*,
        u.email as created_by_email
      FROM public.admin_promotions p
      LEFT JOIN auth.users u ON u.id = p.created_by
      WHERE 1=1 ${statusFilter}
      ORDER BY p.created_at DESC
      LIMIT $1 OFFSET $2`,
      limit,
      offset
    );

    return reply.send(createPaginatedResponse(promotions, page, limit, total));
  });

  // POST /api/v1/admin/promotions
  fastify.post('/', adminAuth, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = CreatePromotionSchema.parse(request.body);
    const adminId = request.user.userId;

    const result = await db.$queryRaw<Array<Record<string, unknown>>>`
      INSERT INTO public.admin_promotions (code, type, value, starts_at, ends_at, max_redemptions, created_by)
      VALUES (
        ${body.code},
        ${body.type},
        ${JSON.stringify(body.value)}::jsonb,
        ${body.startsAt ? new Date(body.startsAt) : null}::timestamptz,
        ${body.endsAt ? new Date(body.endsAt) : null}::timestamptz,
        ${body.maxRedemptions ?? null}::int,
        ${adminId}::uuid
      )
      RETURNING *
    `;

    // Audit log
    await db.$queryRaw`
      INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, new_value)
      VALUES (${adminId}::uuid, 'create_promotion', 'promotion', ${result[0]!['id'] as string}::uuid, ${JSON.stringify(body)}::jsonb)
    `;

    return reply.code(201).send(createSuccessResponse(result[0]));
  });

  // PATCH /api/v1/admin/promotions/:id
  fastify.patch<{ Params: { id: string } }>(
    '/:id',
    adminAuth,
    async (request, reply) => {
      const { id } = request.params;
      const body = UpdatePromotionSchema.parse(request.body);
      const adminId = request.user.userId;

      // Fetch current for audit
      const current = await db.$queryRaw<Array<Record<string, unknown>>>`
        SELECT * FROM public.admin_promotions WHERE id = ${id}::uuid
      `;
      if (current.length === 0) {
        return reply.code(404).send(
          createErrorResponse(ErrorCode.RESOURCE_NOT_FOUND, 'Promotion not found', request.url)
        );
      }

      const setClauses: string[] = [];
      const params: unknown[] = [id]; // $1 = id
      let idx = 2;

      if (body.code !== undefined) { setClauses.push(`code = $${idx}`); params.push(body.code); idx++; }
      if (body.type !== undefined) { setClauses.push(`type = $${idx}`); params.push(body.type); idx++; }
      if (body.value !== undefined) { setClauses.push(`value = $${idx}::jsonb`); params.push(JSON.stringify(body.value)); idx++; }
      if (body.startsAt !== undefined) { setClauses.push(`starts_at = $${idx}::timestamptz`); params.push(body.startsAt); idx++; }
      if (body.endsAt !== undefined) { setClauses.push(`ends_at = $${idx}::timestamptz`); params.push(body.endsAt); idx++; }
      if (body.maxRedemptions !== undefined) { setClauses.push(`max_redemptions = $${idx}`); params.push(body.maxRedemptions); idx++; }
      if (body.isActive !== undefined) { setClauses.push(`is_active = $${idx}`); params.push(body.isActive); idx++; }

      if (setClauses.length === 0) {
        return reply.code(400).send(
          createErrorResponse(ErrorCode.VALIDATION_ERROR, 'No fields to update', request.url)
        );
      }

      setClauses.push('updated_at = NOW()');

      const result = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `UPDATE public.admin_promotions SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
        ...params
      );

      // Audit log
      await db.$queryRawUnsafe(
        `INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, old_value, new_value)
         VALUES ($1::uuid, 'update_promotion', 'promotion', $2::uuid, $3::jsonb, $4::jsonb)`,
        adminId, id, JSON.stringify(current[0]), JSON.stringify(body)
      );

      return reply.send(createSuccessResponse(result[0]));
    }
  );

  // DELETE /api/v1/admin/promotions/:id (soft delete)
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    adminAuth,
    async (request, reply) => {
      const { id } = request.params;
      const adminId = request.user.userId;

      const result = await db.$queryRaw<Array<Record<string, unknown>>>`
        UPDATE public.admin_promotions
        SET is_active = false, updated_at = NOW()
        WHERE id = ${id}::uuid AND is_active = true
        RETURNING *
      `;

      if (result.length === 0) {
        return reply.code(404).send(
          createErrorResponse(ErrorCode.RESOURCE_NOT_FOUND, 'Promotion not found or already inactive', request.url)
        );
      }

      // Audit log
      await db.$queryRaw`
        INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, old_value)
        VALUES (${adminId}::uuid, 'delete_promotion', 'promotion', ${id}::uuid, ${JSON.stringify(result[0])}::jsonb)
      `;

      return reply.send(createSuccessResponse({ deleted: true }));
    }
  );
}
