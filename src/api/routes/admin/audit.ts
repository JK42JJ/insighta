import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../../../modules/database/client';
import { createPaginatedResponse, PaginationQuerySchema } from '../../schemas/common.schema';

const AuditLogQuerySchema = PaginationQuerySchema.extend({
  action: z.string().optional(),
  targetType: z.string().optional(),
  adminId: z.string().uuid().optional(),
});

export async function adminAuditRoutes(fastify: FastifyInstance) {
  const adminAuth = { onRequest: [fastify.authenticate, fastify.authenticateAdmin] };

  // GET /api/v1/admin/audit-log
  fastify.get('/', adminAuth, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = AuditLogQuerySchema.parse(request.query);
    const { page, limit, action, targetType, adminId } = query;
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (action) {
      conditions.push(`a.action = $${idx}`);
      params.push(action);
      idx++;
    }
    if (targetType) {
      conditions.push(`a.target_type = $${idx}`);
      params.push(targetType);
      idx++;
    }
    if (adminId) {
      conditions.push(`a.admin_id = $${idx}::uuid`);
      params.push(adminId);
      idx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await db.$queryRawUnsafe<Array<{ total: number }>>(
      `SELECT COUNT(*)::int as total FROM public.admin_audit_log a ${whereClause}`,
      ...params
    );
    const total = countResult[0]?.total ?? 0;

    const logs = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT
        a.*,
        u.email as admin_email
      FROM public.admin_audit_log a
      LEFT JOIN auth.users u ON u.id = a.admin_id
      ${whereClause}
      ORDER BY a.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}`,
      ...params,
      limit,
      offset
    );

    return reply.send(createPaginatedResponse(logs, page, limit, total));
  });
}
