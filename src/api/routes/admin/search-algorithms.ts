/**
 * Admin — Search Algorithm Versions (CP488)
 *
 *   GET    /api/v1/admin/search-algorithms              list catalog
 *   POST   /api/v1/admin/search-algorithms              create new version
 *   PATCH  /api/v1/admin/search-algorithms/:id          update params / flip active
 *   PATCH  /api/v1/admin/search-algorithms/mandala/:mid override per mandala
 *   DELETE /api/v1/admin/search-algorithms/mandala/:mid clear mandala override
 *
 * Auth: `fastify.authenticate + authenticateAdmin` decorator chain
 *       (super_admin only via auth.users.is_super_admin = true).
 *
 * Spec source-of-truth: transcript conversation §search-algorithm-versioning,
 * migration prisma/migrations/search-quality-overhaul/001_algo_versions_catalog.sql,
 * resolver src/modules/search/algorithm-resolver.ts.
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { getPrismaClient } from '@/modules/database';
import { createSuccessResponse } from '../../schemas/common.schema';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'admin/search-algorithms' });

const algorithmIdSchema = z
  .string()
  .min(1)
  .max(50)
  .regex(/^[a-z0-9][a-z0-9._-]*$/i, 'id must be slug-style (a-z0-9._-)');

const createBodySchema = z.object({
  id: algorithmIdSchema,
  display_name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  parameters: z.record(z.unknown()),
  is_active: z.boolean().optional(),
});

const updateBodySchema = z.object({
  display_name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  parameters: z.record(z.unknown()).optional(),
  is_active: z.boolean().optional(),
});

const mandalaOverrideBodySchema = z.object({
  algorithm_version: algorithmIdSchema.nullable(),
});

interface AuthenticatedUser {
  sub?: string;
  userId?: string;
  user_id?: string;
}

function getUserId(request: FastifyRequest): string | null {
  const user = (request as FastifyRequest & { user?: AuthenticatedUser }).user;
  return user?.userId ?? user?.sub ?? user?.user_id ?? null;
}

export async function adminSearchAlgorithmsRoutes(fastify: FastifyInstance) {
  const adminAuth = { onRequest: [fastify.authenticate, fastify.authenticateAdmin] };

  // ── GET /  — list catalog (most-recently-created first) ──────────
  fastify.get('/', adminAuth, async (_request, reply) => {
    const prisma = getPrismaClient();
    const rows = await prisma.search_algorithm_versions.findMany({
      orderBy: [{ is_active: 'desc' }, { created_at: 'desc' }],
    });
    return reply.send(createSuccessResponse({ versions: rows, count: rows.length }));
  });

  // ── POST / — create new version. When body.is_active = true, flip the
  //    previously-active row to false in the same tx so the partial unique
  //    index (uniq_search_algo_active) holds. ────────────────────────────
  fastify.post('/', adminAuth, async (request, reply) => {
    const parsed = createBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ status: 'error', code: 'INVALID_BODY', message: parsed.error.message });
    }
    const userId = getUserId(request);
    const body = parsed.data;
    const prisma = getPrismaClient();

    try {
      await prisma.$transaction(async (tx) => {
        if (body.is_active === true) {
          await tx.search_algorithm_versions.updateMany({
            where: { is_active: true },
            data: { is_active: false },
          });
        }
        await tx.search_algorithm_versions.create({
          data: {
            id: body.id,
            display_name: body.display_name,
            description: body.description ?? null,
            parameters: body.parameters as Prisma.InputJsonValue,
            is_active: body.is_active ?? false,
            created_by: userId ?? null,
          },
        });
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`search-algorithms create failed id=${body.id}: ${msg}`);
      const isDup = msg.includes('Unique constraint') || msg.includes('duplicate key');
      return reply.code(isDup ? 409 : 500).send({
        status: 'error',
        code: isDup ? 'DUPLICATE_ID' : 'CREATE_FAILED',
        message: msg.slice(0, 200),
      });
    }
    return reply.code(201).send(createSuccessResponse({ id: body.id }));
  });

  // ── PATCH /:id — update params and/or flip active ─────────────────
  fastify.patch<{ Params: { id: string } }>('/:id', adminAuth, async (request, reply) => {
    const parsed = updateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ status: 'error', code: 'INVALID_BODY', message: parsed.error.message });
    }
    const { id } = request.params;
    const body = parsed.data;
    const prisma = getPrismaClient();

    try {
      const exists = await prisma.search_algorithm_versions.findUnique({ where: { id } });
      if (!exists) {
        return reply
          .code(404)
          .send({ status: 'error', code: 'NOT_FOUND', message: `algorithm ${id} not found` });
      }
      await prisma.$transaction(async (tx) => {
        if (body.is_active === true) {
          await tx.search_algorithm_versions.updateMany({
            where: { is_active: true, id: { not: id } },
            data: { is_active: false },
          });
        }
        await tx.search_algorithm_versions.update({
          where: { id },
          data: {
            display_name: body.display_name ?? undefined,
            description: body.description === undefined ? undefined : body.description,
            parameters:
              body.parameters === undefined
                ? undefined
                : (body.parameters as Prisma.InputJsonValue),
            is_active: body.is_active ?? undefined,
          },
        });
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`search-algorithms update failed id=${id}: ${msg}`);
      return reply
        .code(500)
        .send({ status: 'error', code: 'UPDATE_FAILED', message: msg.slice(0, 200) });
    }
    return reply.send(createSuccessResponse({ id }));
  });

  // ── PATCH /mandala/:mandalaId — set / clear per-mandala override ──
  fastify.patch<{ Params: { mandalaId: string } }>(
    '/mandala/:mandalaId',
    adminAuth,
    async (request, reply) => {
      const parsed = mandalaOverrideBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ status: 'error', code: 'INVALID_BODY', message: parsed.error.message });
      }
      const { mandalaId } = request.params;
      const { algorithm_version } = parsed.data;
      const prisma = getPrismaClient();

      try {
        // If non-null, verify the algorithm id exists (FK already enforces it
        // but we want a clean 400 rather than a 500 P2003).
        if (algorithm_version) {
          const algo = await prisma.search_algorithm_versions.findUnique({
            where: { id: algorithm_version },
            select: { id: true },
          });
          if (!algo) {
            return reply.code(400).send({
              status: 'error',
              code: 'UNKNOWN_ALGORITHM',
              message: `algorithm ${algorithm_version} not found`,
            });
          }
        }
        const updated = await prisma.$executeRaw`
          UPDATE public.user_mandalas
             SET search_algorithm_version = ${algorithm_version}::varchar(50)
           WHERE id = ${mandalaId}::uuid
        `;
        if (updated === 0) {
          return reply.code(404).send({
            status: 'error',
            code: 'MANDALA_NOT_FOUND',
            message: `mandala ${mandalaId} not found`,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(`mandala override failed mandala=${mandalaId}: ${msg}`);
        return reply
          .code(500)
          .send({ status: 'error', code: 'OVERRIDE_FAILED', message: msg.slice(0, 200) });
      }
      return reply.send(createSuccessResponse({ mandala_id: mandalaId, algorithm_version }));
    }
  );

  // ── DELETE /mandala/:mandalaId — clear override (use global default) ──
  fastify.delete<{ Params: { mandalaId: string } }>(
    '/mandala/:mandalaId',
    adminAuth,
    async (request, reply) => {
      const { mandalaId } = request.params;
      const prisma = getPrismaClient();
      try {
        const updated = await prisma.$executeRaw`
          UPDATE public.user_mandalas
             SET search_algorithm_version = NULL
           WHERE id = ${mandalaId}::uuid
        `;
        if (updated === 0) {
          return reply.code(404).send({
            status: 'error',
            code: 'MANDALA_NOT_FOUND',
            message: `mandala ${mandalaId} not found`,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply
          .code(500)
          .send({ status: 'error', code: 'CLEAR_FAILED', message: msg.slice(0, 200) });
      }
      return reply.send(createSuccessResponse({ mandala_id: mandalaId, algorithm_version: null }));
    }
  );

  // ── GET /comparison/:mandalaId — A/B view per mandala (run rollup) ──
  fastify.get<{ Params: { mandalaId: string } }>(
    '/comparison/:mandalaId',
    adminAuth,
    async (request, reply) => {
      const { mandalaId } = request.params;
      const prisma = getPrismaClient();
      try {
        const rows = await prisma.$queryRaw<
          Array<{
            algorithm_version: string | null;
            run_count: number;
            avg_duration_ms: number | null;
            recent_run_at: Date | null;
            total_cost: unknown;
          }>
        >`
          SELECT
            algorithm_version,
            count(*)::int AS run_count,
            round(avg(EXTRACT(EPOCH FROM (updated_at - created_at)) * 1000)::numeric, 0)::int
              AS avg_duration_ms,
            max(created_at) AS recent_run_at,
            jsonb_agg(total_cost_units) FILTER (WHERE total_cost_units IS NOT NULL)
              AS total_cost
          FROM public.mandala_pipeline_runs
          WHERE mandala_id = ${mandalaId}::uuid
          GROUP BY algorithm_version
          ORDER BY algorithm_version NULLS LAST
        `;
        return reply.send(createSuccessResponse({ mandala_id: mandalaId, comparison: rows }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply
          .code(500)
          .send({ status: 'error', code: 'COMPARISON_FAILED', message: msg.slice(0, 200) });
      }
    }
  );
}
