import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '@/modules/database/client';
import {
  createErrorResponse,
  createPaginatedResponse,
  createSuccessResponse,
  ErrorCode,
  PaginationQuerySchema,
} from '../../schemas/common.schema';

const ContentListQuerySchema = PaginationQuerySchema.extend({
  search: z.string().optional(),
  flagged: z.coerce.boolean().optional(),
});

const ContentActionSchema = z.object({
  hidden: z.boolean().optional(),
  flagged: z.boolean().optional(),
  flagReason: z.string().optional(),
});

export async function adminContentRoutes(fastify: FastifyInstance) {
  const adminAuth = { onRequest: [fastify.authenticate, fastify.authenticateAdmin] };

  // GET /api/v1/admin/content/mandalas — List all mandalas with owner info
  fastify.get('/mandalas', adminAuth, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = ContentListQuerySchema.parse(request.query);
    const { page, limit, search } = query;
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (search) {
      conditions.push(`(m.title ILIKE $${idx} OR u.email ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await db.$queryRawUnsafe<Array<{ total: number }>>(
      `SELECT COUNT(*)::int as total
       FROM public.user_mandalas m
       LEFT JOIN auth.users u ON u.id = m.user_id
       ${whereClause}`,
      ...params
    );
    const total = countResult[0]?.total ?? 0;

    const mandalas = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT
        m.id, m.title, m.is_public, m.share_slug, m.created_at, m.updated_at,
        u.id as owner_id, u.email as owner_email,
        u.raw_user_meta_data->>'full_name' as owner_name,
        (SELECT COUNT(*)::int FROM public.user_mandala_levels ml WHERE ml.mandala_id = m.id) as level_count
      FROM public.user_mandalas m
      LEFT JOIN auth.users u ON u.id = m.user_id
      ${whereClause}
      ORDER BY m.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}`,
      ...params,
      limit,
      offset
    );

    return reply.send(createPaginatedResponse(mandalas, page, limit, total));
  });

  // PATCH /api/v1/admin/content/mandalas/:id — Hide/unhide, flag
  fastify.patch<{ Params: { id: string } }>('/mandalas/:id', adminAuth, async (request, reply) => {
    const { id } = request.params;
    const body = ContentActionSchema.parse(request.body);
    const adminId = request.user.userId;

    const setClauses: string[] = [];
    const params: unknown[] = [id]; // $1
    let idx = 2;

    if (body.hidden !== undefined) {
      setClauses.push(`is_public = $${idx}`);
      params.push(!body.hidden); // hidden=true → is_public=false
      idx++;
    }

    if (setClauses.length === 0) {
      return reply
        .code(400)
        .send(createErrorResponse(ErrorCode.VALIDATION_ERROR, 'No changes specified', request.url));
    }

    setClauses.push('updated_at = NOW()');

    const result = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `UPDATE public.user_mandalas SET ${setClauses.join(', ')} WHERE id = $1::uuid RETURNING *`,
      ...params
    );

    if (result.length === 0) {
      return reply
        .code(404)
        .send(createErrorResponse(ErrorCode.RESOURCE_NOT_FOUND, 'Mandala not found', request.url));
    }

    // Audit log
    await db.$queryRawUnsafe(
      `INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, new_value)
         VALUES ($1::uuid, 'moderate_content', 'mandala', $2::uuid, $3::jsonb)`,
      adminId,
      id,
      JSON.stringify(body)
    );

    return reply.send(createSuccessResponse(result[0]));
  });

  // DELETE /api/v1/admin/content/mandalas/:id — Admin force-delete
  fastify.delete<{ Params: { id: string } }>('/mandalas/:id', adminAuth, async (request, reply) => {
    const { id } = request.params;
    const adminId = request.user.userId;

    // Get mandala info for audit
    const mandala = await db.$queryRaw<Array<Record<string, unknown>>>`
        SELECT * FROM public.user_mandalas WHERE id = ${id}::uuid
      `;

    if (mandala.length === 0) {
      return reply
        .code(404)
        .send(createErrorResponse(ErrorCode.RESOURCE_NOT_FOUND, 'Mandala not found', request.url));
    }

    // Delete levels first, then mandala
    await db.$queryRaw`DELETE FROM public.user_mandala_levels WHERE mandala_id = ${id}::uuid`;
    await db.$queryRaw`DELETE FROM public.user_mandalas WHERE id = ${id}::uuid`;

    // Audit log
    await db.$queryRawUnsafe(
      `INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, old_value)
         VALUES ($1::uuid, 'delete_content', 'mandala', $2::uuid, $3::jsonb)`,
      adminId,
      id,
      JSON.stringify(mandala[0])
    );

    return reply.send(createSuccessResponse({ deleted: true }));
  });
}
