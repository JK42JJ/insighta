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
import { DEFAULT_TIER, TIER_LIMITS } from '@/config/quota';

const UserListQuerySchema = PaginationQuerySchema.extend({
  search: z.string().optional(),
  tier: z.enum(['free', 'pro', 'lifetime', 'admin']).optional(),
});

const SubscriptionUpdateSchema = z.object({
  tier: z.enum(['free', 'pro', 'lifetime', 'admin']).optional(),
  localCardsLimit: z.number().int().min(0).optional(),
  mandalaLimit: z.number().int().min(0).optional(),
});

const StatusUpdateSchema = z.object({
  banned: z.boolean(),
  banReason: z.string().optional(),
});

export async function adminUserRoutes(fastify: FastifyInstance) {
  const adminAuth = { onRequest: [fastify.authenticate, fastify.authenticateAdmin] };

  // GET /api/v1/admin/users — List users with search and pagination
  fastify.get('/', adminAuth, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = UserListQuerySchema.parse(request.query);
    const { page, limit, search, tier } = query;
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (search) {
      conditions.push(
        `(u.email ILIKE $${paramIdx} OR u.raw_user_meta_data->>'full_name' ILIKE $${paramIdx})`
      );
      params.push(`%${search}%`);
      paramIdx++;
    }

    if (tier) {
      conditions.push(`COALESCE(s.tier, 'free') = $${paramIdx}`);
      params.push(tier);
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countQuery = `
      SELECT COUNT(*)::int as total
      FROM auth.users u
      LEFT JOIN public.user_subscriptions s ON s.user_id = u.id
      ${whereClause}
    `;
    const countResult = await db.$queryRawUnsafe<Array<{ total: number }>>(countQuery, ...params);
    const total = countResult[0]?.total ?? 0;

    const usersQuery = `
      SELECT
        u.id,
        u.email,
        u.raw_user_meta_data->>'full_name' as name,
        u.raw_user_meta_data->>'avatar_url' as avatar_url,
        u.created_at,
        u.last_sign_in_at,
        u.is_super_admin,
        u.banned_until,
        COALESCE(s.tier, '${DEFAULT_TIER}') as tier,
        COALESCE(s.local_cards_limit, ${TIER_LIMITS.free.cards}) as local_cards_limit,
        COALESCE(s.mandala_limit, ${TIER_LIMITS.free.mandalas}) as mandala_limit,
        (SELECT COUNT(*)::int FROM public.user_local_cards lc WHERE lc.user_id = u.id) as card_count,
        (SELECT COUNT(*)::int FROM public.user_mandalas um WHERE um.user_id = u.id) as mandala_count
      FROM auth.users u
      LEFT JOIN public.user_subscriptions s ON s.user_id = u.id
      ${whereClause}
      ORDER BY u.created_at DESC
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `;

    const users = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      usersQuery,
      ...params,
      limit,
      offset
    );

    return reply.send(createPaginatedResponse(users, page, limit, total));
  });

  // GET /api/v1/admin/users/:id — User detail
  fastify.get<{ Params: { id: string } }>('/:id', adminAuth, async (request, reply) => {
    const { id } = request.params;

    const users = await db.$queryRaw<Array<Record<string, unknown>>>`
      SELECT
        u.id,
        u.email,
        u.raw_user_meta_data->>'full_name' as name,
        u.raw_user_meta_data->>'avatar_url' as avatar_url,
        u.created_at,
        u.last_sign_in_at,
        u.is_super_admin,
        u.banned_until,
        COALESCE(s.tier, '${DEFAULT_TIER}') as tier,
        COALESCE(s.local_cards_limit, ${TIER_LIMITS.free.cards}) as local_cards_limit,
        COALESCE(s.mandala_limit, ${TIER_LIMITS.free.mandalas}) as mandala_limit,
        (SELECT COUNT(*)::int FROM public.user_local_cards lc WHERE lc.user_id = u.id) as card_count,
        (SELECT COUNT(*)::int FROM public.user_mandalas um WHERE um.user_id = u.id) as mandala_count
      FROM auth.users u
      LEFT JOIN public.user_subscriptions s ON s.user_id = u.id
      WHERE u.id = ${id}::uuid
    `;

    if (users.length === 0) {
      return reply
        .code(404)
        .send(createErrorResponse(ErrorCode.RESOURCE_NOT_FOUND, 'User not found', request.url));
    }

    return reply.send(createSuccessResponse(users[0]));
  });

  // PATCH /api/v1/admin/users/:id/subscription — Update subscription tier/limits
  fastify.patch<{ Params: { id: string } }>(
    '/:id/subscription',
    adminAuth,
    async (request, reply) => {
      const { id } = request.params;
      const body = SubscriptionUpdateSchema.parse(request.body);

      const userCheck = await db.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM auth.users WHERE id = ${id}::uuid
      `;
      if (userCheck.length === 0) {
        return reply
          .code(404)
          .send(createErrorResponse(ErrorCode.RESOURCE_NOT_FOUND, 'User not found', request.url));
      }

      // Build dynamic SET clause
      const setClauses: string[] = [];
      const setParams: unknown[] = [id]; // $1 = user_id
      let idx = 2;

      if (body.tier !== undefined) {
        setClauses.push(`tier = $${idx}`);
        setParams.push(body.tier);
        idx++;
      }
      if (body.localCardsLimit !== undefined) {
        setClauses.push(`local_cards_limit = $${idx}`);
        setParams.push(body.localCardsLimit);
        idx++;
      }
      if (body.mandalaLimit !== undefined) {
        setClauses.push(`mandala_limit = $${idx}`);
        setParams.push(body.mandalaLimit);
        idx++;
      }

      if (setClauses.length === 0) {
        return reply
          .code(400)
          .send(
            createErrorResponse(ErrorCode.VALIDATION_ERROR, 'No fields to update', request.url)
          );
      }

      const columns = setClauses.map((c) => c.split(' = ')[0]!);
      const valuePlaceholders = Array.from({ length: setClauses.length }, (_, i) => `$${i + 2}`);

      const upsertQuery = `
        INSERT INTO public.user_subscriptions (user_id, ${columns.join(', ')})
        VALUES ($1, ${valuePlaceholders.join(', ')})
        ON CONFLICT (user_id)
        DO UPDATE SET ${setClauses.join(', ')}, updated_at = NOW()
        RETURNING *
      `;

      const result = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
        upsertQuery,
        ...setParams
      );

      return reply.send(createSuccessResponse(result[0]));
    }
  );

  // PATCH /api/v1/admin/users/:id/status — Suspend/activate user
  fastify.patch<{ Params: { id: string } }>(
    '/:id/status',
    adminAuth,
    async (request, reply) => {
      const { id } = request.params;
      const body = StatusUpdateSchema.parse(request.body);

      // Prevent admin from banning themselves
      if (request.user.userId === id && body.banned) {
        return reply
          .code(400)
          .send(
            createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Cannot ban yourself', request.url)
          );
      }

      const bannedUntil = body.banned ? new Date('2099-12-31T23:59:59Z') : null;

      const result = await db.$queryRaw<Array<Record<string, unknown>>>`
        UPDATE auth.users
        SET banned_until = ${bannedUntil}::timestamptz
        WHERE id = ${id}::uuid
        RETURNING id, email, banned_until
      `;

      if (result.length === 0) {
        return reply
          .code(404)
          .send(
            createErrorResponse(ErrorCode.RESOURCE_NOT_FOUND, 'User not found', request.url)
          );
      }

      return reply.send(createSuccessResponse(result[0]));
    }
  );
}
