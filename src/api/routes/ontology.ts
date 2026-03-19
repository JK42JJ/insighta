import { FastifyPluginCallback } from 'fastify';
import { getOntologyManager } from '../../modules/ontology';
import { getNeighbors } from '../../modules/ontology/graph';
import { searchByVector, searchByText } from '../../modules/ontology/search';
import { generateEmbedding } from '../../modules/ontology/embedding';
import {
  ListNodesQuerySchema,
  CreateNodeBodySchema,
  UpdateNodeBodySchema,
  NeighborsQuerySchema,
  HistoryQuerySchema,
  ListEdgesQuerySchema,
  CreateEdgeBodySchema,
  VectorSearchBodySchema,
  TextSearchQuerySchema,
  SemanticSearchBodySchema,
  EnrichBodySchema,
  BatchEnrichBodySchema,
  AutoEnrichBodySchema,
} from '../schemas/ontology.schema';
import { enrichResourceNode, batchEnrichResources, enrichBySourceRef } from '../../modules/ontology/enrichment';

// ============================================================================
// Ontology Routes — 12 endpoints
// ============================================================================

function getUserId(request: any, reply: any): string | null {
  if (!request.user || !('userId' in request.user)) {
    reply
      .code(401)
      .send({ status: 'error', code: 'UNAUTHORIZED', message: 'Authentication required' });
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
        return reply
          .code(400)
          .send({ status: 'error', code: 'VALIDATION_ERROR', message: err.message });
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
      return reply
        .code(404)
        .send({ status: 'error', code: 'NODE_NOT_FOUND', message: 'Node not found' });
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
        return reply
          .code(404)
          .send({ status: 'error', code: 'NODE_NOT_FOUND', message: 'Node not found' });
      }
      if (err.message?.includes('Invalid properties')) {
        return reply
          .code(400)
          .send({ status: 'error', code: 'VALIDATION_ERROR', message: err.message });
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
        return reply
          .code(404)
          .send({ status: 'error', code: 'NODE_NOT_FOUND', message: 'Node not found' });
      }
      throw err;
    }
  });

  // GET /nodes/:id/neighbors — graph traversal
  fastify.get(
    '/nodes/:id/neighbors',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = getUserId(request, reply);
      if (!userId) return;

      const { id } = request.params as { id: string };
      const query = NeighborsQuerySchema.parse(request.query);
      const neighbors = await getNeighbors(id, userId, query.relation, query.depth);
      return reply.send({ status: 'ok', data: neighbors });
    }
  );

  // GET /nodes/:id/history — action_log
  fastify.get(
    '/nodes/:id/history',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = getUserId(request, reply);
      if (!userId) return;

      const { id } = request.params as { id: string };
      const query = HistoryQuerySchema.parse(request.query);
      const history = await manager.getNodeHistory(userId, id, query.limit);
      return reply.send({ status: 'ok', data: history });
    }
  );

  // ─── Edges ───

  // GET /edges — list/filter
  fastify.get('/edges', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const userId = getUserId(request, reply);
    if (!userId) return;

    const query = ListEdgesQuerySchema.parse(request.query);
    const result = await manager.listEdges(userId, query);
    return reply.send({ status: 'ok', data: result });
  });

  // POST /edges — create
  fastify.post('/edges', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const userId = getUserId(request, reply);
    if (!userId) return;

    const body = CreateEdgeBodySchema.parse(request.body);
    try {
      const edge = await manager.createEdge(userId, body);
      return reply.code(201).send({ status: 'ok', data: edge });
    } catch (err: any) {
      if (err.message === 'CROSS_DOMAIN_EDGE') {
        return reply.code(400).send({
          status: 'error',
          code: 'CROSS_DOMAIN_EDGE',
          message: 'Cannot create edge between nodes of different domains',
        });
      }
      if (err.message?.includes('violates foreign key')) {
        return reply.code(400).send({
          status: 'error',
          code: 'INVALID_INPUT',
          message: 'Source or target node not found',
        });
      }
      if (err.message?.includes('no_self_edge')) {
        return reply.code(400).send({
          status: 'error',
          code: 'INVALID_INPUT',
          message: 'Self-referencing edges are not allowed',
        });
      }
      if (err.message?.includes('unique_edge')) {
        return reply
          .code(409)
          .send({ status: 'error', code: 'DUPLICATE_RESOURCE', message: 'Edge already exists' });
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
        return reply
          .code(404)
          .send({ status: 'error', code: 'EDGE_NOT_FOUND', message: 'Edge not found' });
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
      domain: body.domain,
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
      domain: query.domain,
    });
    return reply.send({ status: 'ok', data: results });
  });

  // POST /search/semantic — text query → embed → vector search
  fastify.post(
    '/search/semantic',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const userId = getUserId(request, reply);
      if (!userId) return;

      const body = SemanticSearchBodySchema.parse(request.body);
      const embedding = await generateEmbedding(body.query);
      const results = await searchByVector(userId, embedding, {
        limit: body.limit,
        threshold: body.threshold,
        type_filter: body.type_filter,
        domain: body.domain,
      });
      return reply.send({
        status: 'ok',
        data: { results, query: body.query, embedding_dimension: embedding.length },
      });
    }
  );

  // ─── Enrichment ───

  // POST /enrich — enrich single resource node with YouTube transcript summary
  fastify.post('/enrich', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const userId = getUserId(request, reply);
    if (!userId) return;

    const body = EnrichBodySchema.parse(request.body);
    try {
      const result = await enrichResourceNode(body.node_id, userId);
      return reply.send({ status: 'ok', data: result });
    } catch (err: any) {
      if (err.message === 'NODE_NOT_FOUND') {
        return reply
          .code(404)
          .send({ status: 'error', code: 'NODE_NOT_FOUND', message: 'Node not found' });
      }
      if (err.message === 'MISSING_URL' || err.message === 'NOT_YOUTUBE_URL') {
        return reply
          .code(400)
          .send({ status: 'error', code: err.message, message: 'Node is not a YouTube resource' });
      }
      if (err.message?.startsWith('CAPTION_FAILED')) {
        return reply
          .code(422)
          .send({ status: 'error', code: 'CAPTION_FAILED', message: err.message });
      }
      throw err;
    }
  });

  // POST /enrich/auto — auto-enrich by source_ref (fire-and-forget from frontend after card add)
  fastify.post('/enrich/auto', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const userId = getUserId(request, reply);
    if (!userId) return;

    const body = AutoEnrichBodySchema.parse(request.body);
    try {
      const result = await enrichBySourceRef(userId, body.source_table, body.source_id);
      if (!result) {
        return reply.send({ status: 'ok', data: { enriched: false, reason: 'node_not_found_or_not_youtube' } });
      }
      return reply.send({ status: 'ok', data: result });
    } catch (err: any) {
      // Non-fatal for auto-enrich: log and return graceful response
      const code = err.message?.split(':')[0] || 'ENRICH_FAILED';
      return reply.send({ status: 'ok', data: { enriched: false, reason: code } });
    }
  });

  // POST /enrich/batch — batch enrich YouTube resource nodes without summary (limit=0 for all)
  fastify.post('/enrich/batch', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const userId = getUserId(request, reply);
    if (!userId) return;

    const body = BatchEnrichBodySchema.parse(request.body);
    const result = await batchEnrichResources(userId, {
      limit: body.limit,
      delayMs: body.delay_ms,
    });
    return reply.send({ status: 'ok', data: result });
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
