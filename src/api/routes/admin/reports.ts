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

const ReportListQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(['pending', 'reviewed', 'resolved', 'dismissed', 'all']).optional().default('all'),
  targetType: z.string().optional(),
});

const ResolveReportSchema = z.object({
  status: z.enum(['reviewed', 'resolved', 'dismissed']),
  resolutionNote: z.string().optional(),
});

const CreateReportSchema = z.object({
  targetType: z.enum(['mandala', 'card', 'user']),
  targetId: z.string().uuid(),
  reason: z.enum(['spam', 'inappropriate', 'copyright', 'other']),
  description: z.string().max(1000).optional(),
});

export async function adminReportRoutes(fastify: FastifyInstance) {
  const adminAuth = { onRequest: [fastify.authenticate, fastify.authenticateAdmin] };

  // GET /api/v1/admin/reports — List reports (admin)
  fastify.get('/', adminAuth, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = ReportListQuerySchema.parse(request.query);
    const { page, limit, status, targetType } = query;
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (status !== 'all') {
      conditions.push(`r.status = $${idx}`);
      params.push(status);
      idx++;
    }
    if (targetType) {
      conditions.push(`r.target_type = $${idx}`);
      params.push(targetType);
      idx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await db.$queryRawUnsafe<Array<{ total: number }>>(
      `SELECT COUNT(*)::int as total FROM public.content_reports r ${whereClause}`,
      ...params
    );
    const total = countResult[0]?.total ?? 0;

    const reports = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT
        r.*,
        reporter.email as reporter_email,
        resolver.email as resolver_email
      FROM public.content_reports r
      LEFT JOIN auth.users reporter ON reporter.id = r.reporter_id
      LEFT JOIN auth.users resolver ON resolver.id = r.resolved_by
      ${whereClause}
      ORDER BY
        CASE r.status WHEN 'pending' THEN 0 WHEN 'reviewed' THEN 1 ELSE 2 END,
        r.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}`,
      ...params,
      limit,
      offset
    );

    return reply.send(createPaginatedResponse(reports, page, limit, total));
  });

  // PATCH /api/v1/admin/reports/:id — Resolve/dismiss report
  fastify.patch<{ Params: { id: string } }>('/:id', adminAuth, async (request, reply) => {
    const { id } = request.params;
    const body = ResolveReportSchema.parse(request.body);
    const adminId = request.user.userId;

    const result = await db.$queryRaw<Array<Record<string, unknown>>>`
        UPDATE public.content_reports
        SET status = ${body.status},
            resolved_by = ${adminId}::uuid,
            resolved_at = NOW(),
            resolution_note = ${body.resolutionNote ?? null}
        WHERE id = ${id}::uuid
        RETURNING *
      `;

    if (result.length === 0) {
      return reply
        .code(404)
        .send(createErrorResponse(ErrorCode.RESOURCE_NOT_FOUND, 'Report not found', request.url));
    }

    return reply.send(createSuccessResponse(result[0]));
  });
}

export async function userReportRoutes(fastify: FastifyInstance) {
  // POST /api/v1/reports — User-facing: report content
  fastify.post(
    '/',
    { onRequest: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = CreateReportSchema.parse(request.body);
      const userId = request.user.userId;

      // Check for duplicate report
      const existing = await db.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM public.content_reports
        WHERE reporter_id = ${userId}::uuid
          AND target_type = ${body.targetType}
          AND target_id = ${body.targetId}::uuid
          AND status IN ('pending', 'reviewed')
      `;

      if (existing.length > 0) {
        return reply
          .code(409)
          .send(
            createErrorResponse(
              ErrorCode.DUPLICATE_RESOURCE,
              'You have already reported this content',
              request.url
            )
          );
      }

      const result = await db.$queryRaw<Array<Record<string, unknown>>>`
        INSERT INTO public.content_reports (reporter_id, target_type, target_id, reason, description)
        VALUES (${userId}::uuid, ${body.targetType}, ${body.targetId}::uuid, ${body.reason}, ${body.description ?? null})
        RETURNING *
      `;

      return reply.code(201).send(createSuccessResponse(result[0]));
    }
  );
}
