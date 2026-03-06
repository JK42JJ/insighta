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

interface UpdateLevelBody {
  centerGoal?: string;
  subjects?: string[];
  color?: string | null;
}

export const mandalaRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  /**
   * GET /api/v1/mandalas - Get user's default mandala with all levels
   */
  fastify.get('/', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!request.user || !('userId' in request.user)) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const mandala = await getMandalaManager().getMandala(request.user.userId);

    if (!mandala) {
      return reply.code(404).send({ error: 'Mandala not found' });
    }

    return reply.send({ mandala });
  });

  /**
   * PUT /api/v1/mandalas - Upsert mandala with all levels
   */
  fastify.put<{ Body: UpsertMandalaBody }>(
    '/',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      if (!request.user || !('userId' in request.user)) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const { title, levels } = request.body;

      if (!title || !Array.isArray(levels)) {
        return reply.code(400).send({ error: 'title and levels are required' });
      }

      const mandala = await getMandalaManager().upsertMandala(request.user.userId, title, levels);

      return reply.send({ mandala });
    }
  );

  /**
   * PATCH /api/v1/mandalas/levels/:levelKey - Update a single level
   */
  fastify.patch<{ Params: { levelKey: string }; Body: UpdateLevelBody }>(
    '/levels/:levelKey',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      if (!request.user || !('userId' in request.user)) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      await getMandalaManager().updateLevel(
        request.user.userId,
        request.params.levelKey,
        request.body
      );

      return reply.send({ success: true });
    }
  );

  done();
};
