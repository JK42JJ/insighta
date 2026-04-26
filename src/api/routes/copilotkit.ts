import 'reflect-metadata';
import { FastifyPluginCallback } from 'fastify';
import { CopilotRuntime, OpenAIAdapter, copilotRuntimeNodeHttpEndpoint } from '@copilotkit/runtime';
import OpenAI from 'openai';
import { config } from '@/config/index';

type ChatbotProvider = 'gemini' | 'openrouter' | 'local';

function createServiceAdapter(provider: ChatbotProvider, model?: string): OpenAIAdapter {
  switch (provider) {
    case 'gemini':
    case 'openrouter':
      return new OpenAIAdapter({
        openai: new OpenAI({
          apiKey: config.openrouter.apiKey,
          baseURL: 'https://openrouter.ai/api/v1',
        }),
        model: model || 'google/gemini-2.5-flash',
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
    case 'openrouter':
      return 'google/gemini-2.5-flash';
    case 'local':
      return config.ollama.generateModel;
  }
}

export const copilotKitRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  const provider = config.chatbot.provider;
  const model = config.chatbot.model;
  const serviceAdapter = createServiceAdapter(provider, model);
  const runtime = new CopilotRuntime();

  const yoga = copilotRuntimeNodeHttpEndpoint({
    runtime,
    serviceAdapter,
    endpoint: '/api/v1/chat',
  });

  // yoga is a graphql-yoga instance — register on raw HTTP server
  // to bypass Fastify body parsing entirely.
  const server = fastify.server;
  const originalListeners = server.listeners('request');

  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    if (req.url?.startsWith('/api/v1/chat') && !req.url?.startsWith('/api/v1/chat/config')) {
      void yoga(req, res);
      return;
    }
    for (const listener of originalListeners) {
      listener(req, res);
    }
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
