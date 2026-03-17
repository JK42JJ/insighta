import { FastifyPluginCallback } from 'fastify';
import { getOntologyManager } from '../../modules/ontology';
import { getNeighbors } from '../../modules/ontology/graph';
import { searchByVector, searchByText } from '../../modules/ontology/search';
import {
  ListNodesQuerySchema,
  CreateNodeBodySchema,
  UpdateNodeBodySchema,
  NeighborsQuerySchema,
  HistoryQuerySchema,
  CreateEdgeBodySchema,
  VectorSearchBodySchema,
  TextSearchQuerySchema,
} from '../schemas/ontology.schema';

// ============================================================================
// Ontology Routes — 12 endpoints
// ============================================================================

function getUserId(request: any, reply: any): string | null {
  if (!request.user || !('userId' in request.user)) {
    reply.code(401).send({ status: 'error', code: 'UNAUTHORIZED', message: 'Authentication required' });
    return null;
  }
  return request.user.userId;
}

export const ontologyRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  const manager = getOntologyManager();

  // ─── Nodes ───

  // GET /nodes — list/filter
  fastify.get('/nodes', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const userId = getUserId(request, reply);
    if (!userId) return;

    const query = ListNodesQuerySchema.parse(request.query);
    const result = await manager.listNodes(userId, query);
    return reply.send({ status: 'ok', data: result });
  });

  // POST /nodes — create
  fastify.post('/nodes', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const userId = getUserId(request, reply);
    if (!userId) return;

    const body = CreateNodeBodySchema.parse(request.body);
    try {
      const node = await manager.createNode(userId, body);
      return reply.code(201).send({ status: 'ok', data: node });
    } catch (err: any) {
      if (err.message?.includes('Invalid properties')) {
        return reply.code(400).send({ status: 'error', code: 'VALIDATION_ERROR', message: err.message });
      }
      throw err;
    }
  });

  // GET /nodes/:id — get single node
  fastify.get('/nodes/:id', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const userId = getUserId(request, reply);
    if (!userId) return;

    const { id } = request.params as { id: string };
    const node = await manager.getNode(userId, id);
    if (!node) {
      return reply.code(404).send({ status: 'error', code: 'NODE_NOT_FOUND', message: 'Node not found' });
    }
    return reply.send({ status: 'ok', data: node });
  });

  // PUT /nodes/:id — update
  fastify.put('/nodes/:id', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const userId = getUserId(request, reply);
    if (!userId) return;

    const { id } = request.params as { id: string };
    const body = UpdateNodeBodySchema.parse(request.body);
    try {
      const node = await manager.updateNode(userId, id, body);
      return reply.send({ status: 'ok', data: node });
    } catch (err: any) {
      if (err.message === 'NODE_NOT_FOUND') {
        return reply.code(404).send({ status: 'error', code: 'NODE_NOT_FOUND', message: 'Node not found' });
      }
      if (err.message?.includes('Invalid properties')) {
        return reply.code(400).send({ status: 'error', code: 'VALIDATION_ERROR', message: err.message });
      }
      throw err;
    }
  });

  // DELETE /nodes/:id — delete
  fastify.delete('/nodes/:id', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const userId = getUserId(request, reply);
    if (!userId) return;

    const { id } = request.params as { id: string };
    try {
      await manager.deleteNode(userId, id);
      return reply.send({ status: 'ok', data: { deleted: true } });
    } catch (err: any) {
      if (err.message === 'NODE_NOT_FOUND') {
        return reply.code(404).send({ status: 'error', code: 'NODE_NOT_FOUND', message: 'Node not found' });
      }
      throw err;
    }
  });

  // GET /nodes/:id/neighbors — graph traversal
  fastify.get('/nodes/:id/neighbors', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const userId = getUserId(request, reply);
    if (!userId) return;

    const { id } = request.params as { id: string };
    const query = NeighborsQuerySchema.parse(request.query);
    const neighbors = await getNeighbors(id, userId, query.relation, query.depth);
    return reply.send({ status: 'ok', data: neighbors });
  });

  // GET /nodes/:id/history — action_log
  fastify.get('/nodes/:id/history', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const userId = getUserId(request, reply);
    if (!userId) return;

    const { id } = request.params as { id: string };
    const query = HistoryQuerySchema.parse(request.query);
    const history = await manager.getNodeHistory(userId, id, query.limit);
    return reply.send({ status: 'ok', data: history });
  });

  // ─── Edges ───

  // POST /edges — create
  fastify.post('/edges', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const userId = getUserId(request, reply);
    if (!userId) return;

    const body = CreateEdgeBodySchema.parse(request.body);
    try {
      const edge = await manager.createEdge(userId, body);
      return reply.code(201).send({ status: 'ok', data: edge });
    } catch (err: any) {
      if (err.message?.includes('violates foreign key')) {
        return reply.code(400).send({ status: 'error', code: 'INVALID_INPUT', message: 'Source or target node not found' });
      }
      if (err.message?.includes('no_self_edge')) {
        return reply.code(400).send({ status: 'error', code: 'INVALID_INPUT', message: 'Self-referencing edges are not allowed' });
      }
      if (err.message?.includes('unique_edge')) {
        return reply.code(409).send({ status: 'error', code: 'DUPLICATE_RESOURCE', message: 'Edge already exists' });
      }
      throw err;
    }
  });

  // DELETE /edges/:id — delete
  fastify.delete('/edges/:id', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const userId = getUserId(request, reply);
    if (!userId) return;

    const { id } = request.params as { id: string };
    try {
      await manager.deleteEdge(userId, id);
      return reply.send({ status: 'ok', data: { deleted: true } });
    } catch (err: any) {
      if (err.message === 'EDGE_NOT_FOUND') {
        return reply.code(404).send({ status: 'error', code: 'EDGE_NOT_FOUND', message: 'Edge not found' });
      }
      throw err;
    }
  });

  // ─── Search ───

  // POST /search — vector similarity
  fastify.post('/search', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const userId = getUserId(request, reply);
    if (!userId) return;

    const body = VectorSearchBodySchema.parse(request.body);
    const results = await searchByVector(userId, body.query_embedding, {
      limit: body.limit,
      threshold: body.threshold,
      type_filter: body.type_filter,
    });
    return reply.send({ status: 'ok', data: results });
  });

  // GET /search-text — full-text keyword search
  fastify.get('/search-text', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const userId = getUserId(request, reply);
    if (!userId) return;

    const query = TextSearchQuerySchema.parse(request.query);
    const results = await searchByText(userId, query.q, {
      limit: query.limit,
      type_filter: query.type,
    });
    return reply.send({ status: 'ok', data: results });
  });

  // ─── Stats ───

  // GET /stats — graph statistics
  fastify.get('/stats', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const userId = getUserId(request, reply);
    if (!userId) return;

    const stats = await manager.getStats(userId);
    return reply.send({ status: 'ok', data: stats });
  });

  done();
};
