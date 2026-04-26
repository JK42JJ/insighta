import { FastifyInstance } from 'fastify';
import { config } from '@/config/index';
import { createSuccessResponse } from '../../schemas/common.schema';

export async function adminChatbotRoutes(fastify: FastifyInstance) {
  fastify.get('/', async (_request, reply) => {
    return reply.send(
      createSuccessResponse({
        provider: config.chatbot.provider,
        model: config.chatbot.model || getDefaultModel(config.chatbot.provider),
        localUrl: config.chatbot.localUrl,
        availableProviders: ['gemini', 'openrouter', 'local'],
        hasGeminiKey: !!config.gemini.apiKey,
        hasOpenRouterKey: !!config.openrouter.apiKey,
      })
    );
  });
}

function getDefaultModel(provider: string): string {
  switch (provider) {
    case 'gemini':
      return config.gemini.model || 'gemini-1.5-flash';
    case 'openrouter':
      return config.openrouter.model || 'google/gemini-flash-1.5';
    case 'local':
      return config.ollama.generateModel;
    default:
      return '';
  }
}
