import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createEmbeddingProvider, createGenerationProvider, resetProviders } from '../../../modules/llm';
import { isOllamaAvailable } from '../../../modules/llm/ollama';
import { config } from '../../../config';
import { createSuccessResponse } from '../../schemas/common.schema';

const UpdateLlmBodySchema = z.object({
  provider: z.enum(['auto', 'gemini', 'ollama', 'openrouter']),
  openrouter_model: z.string().optional(),
});

export async function adminLlmRoutes(fastify: FastifyInstance) {
  const adminAuth = { onRequest: [fastify.authenticate, fastify.authenticateAdmin] };

  // GET /api/v1/admin/llm — Current LLM config + provider status
  fastify.get('/', adminAuth, async (_request: FastifyRequest, reply: FastifyReply) => {
    const ollamaUp = await isOllamaAvailable();

    const [embeddingProvider, generationProvider] = await Promise.all([
      createEmbeddingProvider(),
      createGenerationProvider(),
    ]);

    return reply.send(createSuccessResponse({
      config: {
        provider: config.llm.provider,
        openrouter_model: config.openrouter.model,
        ollama_url: config.ollama.url,
        ollama_generate_model: config.ollama.generateModel,
        ollama_embed_model: config.ollama.embedModel,
      },
      active: {
        embedding: { provider: embeddingProvider.name, dimension: embeddingProvider.dimension },
        generation: { provider: generationProvider.name, model: generationProvider.model },
      },
      health: {
        ollama: ollamaUp,
        gemini: !!process.env['GEMINI_API_KEY'],
        openrouter: !!config.openrouter.apiKey,
      },
      // Auto-mode resolution order (for display)
      auto_priority: ['ollama', 'openrouter', 'gemini'],
    }));
  });

  // PUT /api/v1/admin/llm — Change LLM provider at runtime
  fastify.put('/', adminAuth, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = UpdateLlmBodySchema.parse(request.body);

    // Update runtime config (survives until container restart)
    (config.llm as { provider: string }).provider = body.provider;
    if (body.openrouter_model) {
      (config.openrouter as { model: string }).model = body.openrouter_model;
    }

    // Reset cached providers so next call picks up new config
    resetProviders();

    // Re-resolve to verify the new config works
    const [embeddingProvider, generationProvider] = await Promise.all([
      createEmbeddingProvider(),
      createGenerationProvider(),
    ]);

    return reply.send(createSuccessResponse({
      provider: body.provider,
      active: {
        embedding: { provider: embeddingProvider.name },
        generation: { provider: generationProvider.name, model: generationProvider.model },
      },
    }));
  });
}
