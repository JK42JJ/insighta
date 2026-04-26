import { FastifyPluginCallback } from 'fastify';
import { CopilotRuntime, GoogleGenerativeAIAdapter, OpenAIAdapter } from '@copilotkit/runtime';
import { copilotRuntimeNodeHttpEndpoint } from '@copilotkit/runtime';
import OpenAI from 'openai';
import { config } from '@/config/index';

type ChatbotProvider = 'gemini' | 'openrouter' | 'local';

function createServiceAdapter(
  provider: ChatbotProvider,
  model?: string
): GoogleGenerativeAIAdapter | OpenAIAdapter {
  switch (provider) {
    case 'gemini':
      return new GoogleGenerativeAIAdapter({
        model: model || config.gemini.model || 'gemini-1.5-flash',
        apiKey: config.gemini.apiKey,
      });

    case 'openrouter':
      return new OpenAIAdapter({
        openai: new OpenAI({
          apiKey: config.openrouter.apiKey,
          baseURL: 'https://openrouter.ai/api/v1',
        }),
        model: model || config.openrouter.model || 'google/gemini-flash-1.5',
      });

    case 'local':
      return new OpenAIAdapter({
        openai: new OpenAI({
          apiKey: 'not-needed',
          baseURL: config.chatbot.localUrl,
        }),
        model: model || config.ollama.generateModel,
      });
  }
}

function getDefaultModel(provider: ChatbotProvider): string {
  switch (provider) {
    case 'gemini':
      return config.gemini.model || 'gemini-1.5-flash';
    case 'openrouter':
      return config.openrouter.model || 'google/gemini-flash-1.5';
    case 'local':
      return config.ollama.generateModel;
  }
}

export const copilotKitRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  const runtime = new CopilotRuntime({
    actions: [],
  });

  const provider = config.chatbot.provider;
  const model = config.chatbot.model;
  const serviceAdapter = createServiceAdapter(provider, model);

  const handler = copilotRuntimeNodeHttpEndpoint({
    runtime,
    serviceAdapter,
    endpoint: '/api/v1/copilotkit',
  });

  fastify.all('/*', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    return handler(request.raw, reply.raw);
  });

  fastify.get('/config', { onRequest: [fastify.authenticate] }, async (_request, reply) => {
    return reply.send({
      status: 200,
      data: {
        provider,
        model: model || getDefaultModel(provider),
      },
    });
  });

  done();
};
