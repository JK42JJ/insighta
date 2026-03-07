import { FastifyPluginCallback } from 'fastify';
import { getMandalaManager } from '../../modules/mandala';

interface MandalaLevelBody {
  levelKey: string;
  centerGoal: string;
  subjects: string[];
  position: number;
  depth: number;
  color?: string | null;
  parentLevelKey?: string | null;
}

interface UpsertMandalaBody {
  title: string;
  levels: MandalaLevelBody[];
}

interface CreateMandalaBody {
  title: string;
  levels?: MandalaLevelBody[];
}

interface UpdateMandalaBody {
  title?: string;
  isDefault?: boolean;
  position?: number;
}

interface UpdateMandalaLevelsBody {
  levels: MandalaLevelBody[];
}

interface UpdateLevelBody {
  centerGoal?: string;
  subjects?: string[];
  color?: string | null;
}

function getUserId(request: any, reply: any): string | null {
  if (!request.user || !('userId' in request.user)) {
    reply.code(401).send({ error: 'Unauthorized' });
    return null;
  }
  return request.user.userId;
}

export const mandalaRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // ─── Backward-compatible endpoints (Story #59) ───

  /**
   * GET /api/v1/mandalas - Get user's default mandala with all levels
   */
  fastify.get('/', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const userId = getUserId(request, reply);
    if (!userId) return;

    const mandala = await getMandalaManager().getMandala(userId);

    if (!mandala) {
      return reply.code(404).send({ error: 'Mandala not found' });
    }

    return reply.send({ mandala });
  });

  /**
   * PUT /api/v1/mandalas - Upsert default mandala with all levels (backward-compatible)
   */
  fastify.put<{ Body: UpsertMandalaBody }>(
    '/',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = getUserId(request, reply);
      if (!userId) return;

      const { title, levels } = request.body;

      if (!title || !Array.isArray(levels)) {
        return reply.code(400).send({ error: 'title and levels are required' });
      }

      const manager = getMandalaManager();
      const mandala = await manager.upsertMandala(userId, title, levels);

      // Link unlinked cards to this mandala (migration from localStorage)
      const linked = await manager.linkCardsToMandala(userId, mandala.id);

      return reply.send({ mandala, linked });
    }
  );

  /**
   * PATCH /api/v1/mandalas/levels/:levelKey - Update a single level (backward-compatible)
   */
  fastify.patch<{ Params: { levelKey: string }; Body: UpdateLevelBody }>(
    '/levels/:levelKey',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = getUserId(request, reply);
      if (!userId) return;

      await getMandalaManager().updateLevel(userId, request.params.levelKey, request.body);

      return reply.send({ success: true });
    }
  );

  // ─── Multi-Mandala CRUD endpoints (Story #60) ───

  /**
   * GET /api/v1/mandalas/quota - Get user's mandala quota info
   */
  fastify.get('/quota', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const userId = getUserId(request, reply);
    if (!userId) return;

    const quota = await getMandalaManager().getUserQuota(userId);

    return reply.send({ quota });
  });

  /**
   * GET /api/v1/mandalas/list - List all user mandalas with pagination
   */
  fastify.get<{ Querystring: { page?: string; limit?: string } }>(
    '/list',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = getUserId(request, reply);
      if (!userId) return;

      const page = request.query.page ? parseInt(request.query.page, 10) : undefined;
      const limit = request.query.limit ? parseInt(request.query.limit, 10) : undefined;

      if (
        (page !== undefined && (isNaN(page) || page < 1)) ||
        (limit !== undefined && (isNaN(limit) || limit < 1 || limit > 100))
      ) {
        return reply.code(400).send({ error: 'Invalid pagination parameters' });
      }

      const result = await getMandalaManager().listMandalas(userId, { page, limit });

      return reply.send(result);
    }
  );

  /**
   * POST /api/v1/mandalas/create - Create a new mandala
   */
  fastify.post<{ Body: CreateMandalaBody }>(
    '/create',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = getUserId(request, reply);
      if (!userId) return;

      const { title, levels } = request.body;

      if (!title || typeof title !== 'string' || title.trim().length === 0) {
        return reply.code(400).send({ error: 'title is required' });
      }

      if (title.length > 200) {
        return reply.code(400).send({ error: 'title must be 200 characters or less' });
      }

      try {
        const manager = getMandalaManager();
        const mandala = await manager.createMandala(userId, title.trim(), levels ?? []);

        // If this is the first (default) mandala, link unlinked cards
        if (mandala.isDefault) {
          await manager.linkCardsToMandala(userId, mandala.id);
        }

        return reply.code(201).send({ mandala });
      } catch (err: any) {
        if (err.message === 'Mandala quota exceeded') {
          return reply.code(409).send({
            error: 'Mandala quota exceeded',
            quota: err.quota,
            current: err.current,
          });
        }
        throw err;
      }
    }
  );

  /**
   * GET /api/v1/mandalas/:id - Get specific mandala by ID
   */
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = getUserId(request, reply);
      if (!userId) return;

      const mandala = await getMandalaManager().getMandalaById(userId, request.params.id);

      if (!mandala) {
        return reply.code(404).send({ error: 'Mandala not found' });
      }

      return reply.send({ mandala });
    }
  );

  /**
   * PUT /api/v1/mandalas/:id - Update mandala metadata
   */
  fastify.put<{ Params: { id: string }; Body: UpdateMandalaBody }>(
    '/:id',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = getUserId(request, reply);
      if (!userId) return;

      const { title, isDefault, position } = request.body;

      if (title !== undefined && (typeof title !== 'string' || title.trim().length === 0)) {
        return reply.code(400).send({ error: 'title must be a non-empty string' });
      }

      if (title !== undefined && title.length > 200) {
        return reply.code(400).send({ error: 'title must be 200 characters or less' });
      }

      try {
        const mandala = await getMandalaManager().updateMandala(userId, request.params.id, {
          title: title?.trim(),
          isDefault,
          position,
        });

        return reply.send({ mandala });
      } catch (err: any) {
        if (err.message === 'Mandala not found') {
          return reply.code(404).send({ error: 'Mandala not found' });
        }
        throw err;
      }
    }
  );

  /**
   * PUT /api/v1/mandalas/:id/levels - Replace all levels of a specific mandala
   */
  fastify.put<{ Params: { id: string }; Body: UpdateMandalaLevelsBody }>(
    '/:id/levels',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = getUserId(request, reply);
      if (!userId) return;

      const { levels } = request.body;

      if (!Array.isArray(levels)) {
        return reply.code(400).send({ error: 'levels array is required' });
      }

      try {
        const mandala = await getMandalaManager().updateMandalaLevels(
          userId,
          request.params.id,
          levels
        );

        return reply.send({ mandala });
      } catch (err: any) {
        if (err.message === 'Mandala not found') {
          return reply.code(404).send({ error: 'Mandala not found' });
        }
        throw err;
      }
    }
  );

  /**
   * DELETE /api/v1/mandalas/:id - Delete a mandala (cascade deletes levels)
   */
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = getUserId(request, reply);
      if (!userId) return;

      try {
        await getMandalaManager().deleteMandala(userId, request.params.id);
        return reply.code(204).send();
      } catch (err: any) {
        if (err.message === 'Mandala not found') {
          return reply.code(404).send({ error: 'Mandala not found' });
        }
        throw err;
      }
    }
  );

  done();
};
