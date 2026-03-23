import { FastifyPluginCallback } from 'fastify';
import { saveKey, listKeys, deleteKey, updatePriorities } from '../../modules/settings/llm-keys';

function getUserId(request: any, reply: any): string | null {
  if (!request.user || !('userId' in request.user)) {
    reply.code(401).send({ status: 401, code: 'UNAUTHORIZED', message: 'Unauthorized' });
    return null;
  }
  return request.user.userId;
}

export const settingsRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  /**
   * POST /api/v1/settings/llm-keys — Save or update an LLM API key
   * Body: { provider: string, apiKey: string }
   */
  fastify.post<{ Body: { provider: string; apiKey: string } }>(
    '/llm-keys',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = getUserId(request, reply);
      if (!userId) return;

      const { provider, apiKey } = request.body;

      if (!provider || !apiKey) {
        return reply
          .code(400)
          .send({ status: 400, code: 'MISSING_FIELDS', message: 'provider and apiKey required' });
      }

      try {
        const result = await saveKey(userId, provider, apiKey);
        return reply.send({ status: 200, data: result });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to save key';
        return reply.code(400).send({ status: 400, code: 'INVALID_PROVIDER', message });
      }
    }
  );

  /**
   * GET /api/v1/settings/llm-keys — List saved LLM API keys (masked)
   */
  fastify.get('/llm-keys', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const userId = getUserId(request, reply);
    if (!userId) return;

    const keys = await listKeys(userId);
    return reply.send({ status: 200, data: keys });
  });

  /**
   * DELETE /api/v1/settings/llm-keys/:provider — Remove an LLM API key
   */
  fastify.delete<{ Params: { provider: string } }>(
    '/llm-keys/:provider',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = getUserId(request, reply);
      if (!userId) return;

      try {
        await deleteKey(userId, request.params.provider);
        return reply.send({ status: 200, data: { deleted: true } });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to delete key';
        return reply.code(400).send({ status: 400, code: 'INVALID_PROVIDER', message });
      }
    }
  );

  /**
   * PUT /api/v1/settings/llm-keys/priorities — Batch update provider priorities and status
   * Body: { items: [{ provider: string, priority: number, status: 'active' | 'inactive' }] }
   */
  fastify.put<{ Body: { items: { provider: string; priority: number; status: string }[] } }>(
    '/llm-keys/priorities',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = getUserId(request, reply);
      if (!userId) return;

      const { items } = request.body;
      if (!Array.isArray(items)) {
        return reply
          .code(400)
          .send({ status: 400, code: 'INVALID_BODY', message: 'items array required' });
      }

      try {
        await updatePriorities(userId, items);
        return reply.send({ status: 200, data: { updated: true } });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to update priorities';
        return reply.code(400).send({ status: 400, code: 'UPDATE_FAILED', message });
      }
    }
  );

  fastify.log.info('Settings routes registered');
  done();
};

export default settingsRoutes;
