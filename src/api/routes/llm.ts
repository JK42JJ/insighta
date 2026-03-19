import { FastifyPluginCallback } from 'fastify';
import { createEmbeddingProvider, createGenerationProvider } from '../../modules/llm';
import { isOllamaAvailable } from '../../modules/llm/ollama';
import { config } from '../../config';

// ============================================================================
// LLM Routes — Provider status and health
// Issue: #251 (MA-2: GraphDB Service Layer)
// ============================================================================

export const llmRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // GET /status — current provider info and health
  fastify.get('/status', { onRequest: [fastify.authenticate] }, async (_request, reply) => {
    const ollamaUp = await isOllamaAvailable();

    const [embeddingProvider, generationProvider] = await Promise.all([
      createEmbeddingProvider(),
      createGenerationProvider(),
    ]);

    return reply.send({
      status: 'ok',
      data: {
        config: {
          provider: config.llm.provider,
          ollama: {
            url: config.ollama.url,
            embedModel: config.ollama.embedModel,
            generateModel: config.ollama.generateModel,
          },
        },
        active: {
          embedding: {
            provider: embeddingProvider.name,
            dimension: embeddingProvider.dimension,
          },
          generation: {
            provider: generationProvider.name,
          },
        },
        health: {
          ollama: ollamaUp,
          gemini: !!process.env['GEMINI_API_KEY'],
        },
      },
    });
  });

  done();
};
