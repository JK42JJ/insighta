import 'reflect-metadata';
import { FastifyPluginCallback } from 'fastify';
import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNodeHttpEndpoint,
  type CopilotServiceAdapter,
} from '@copilotkit/runtime';
import OpenAI from 'openai';
import { config } from '@/config/index';
import { QwenRunpodAdapter } from '@/modules/chatbot-rag';

type ChatbotProvider = 'gemini' | 'openrouter' | 'local' | 'qwen-runpod';

// Normalise a RunPod endpoint URL to its OpenAI-compatible base.
// Accepts:
//   https://api.runpod.ai/v2/<id>/runsync     → .../v2/<id>/openai/v1
//   https://api.runpod.ai/v2/<id>/openai/v1   → unchanged
//   https://api.runpod.ai/v2/<id>             → .../v2/<id>/openai/v1
function toRunpodOpenAiBase(raw: string): string {
  const trimmed = raw.replace(/\/+$/, '');
  if (trimmed.endsWith('/openai/v1')) return trimmed;
  return trimmed.replace(/\/(?:runsync|run)$/, '') + '/openai/v1';
}

function createServiceAdapter(provider: ChatbotProvider, model?: string): CopilotServiceAdapter {
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

    case 'qwen-runpod':
      // CP474 — QwenRunpodAdapter uses createOpenAI({...}).chat(model) so the
      // request hits /v1/chat/completions (vLLM-compatible) instead of the
      // /v1/responses path that OpenAIAdapter's getLanguageModel() routes to.
      // This is the Bug 1 fix: multi-turn chats no longer fail with
      // "Invalid Responses API request" on the second turn.
      if (!config.qwenLora.apiUrl) throw new Error('QWEN_LORA_API_URL not set');
      if (!config.runpod.apiKey) throw new Error('RUNPOD_API_KEY not set');
      return new QwenRunpodAdapter({
        baseURL: toRunpodOpenAiBase(config.qwenLora.apiUrl),
        apiKey: config.runpod.apiKey,
        model: model || config.qwenLora.model,
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
    case 'qwen-runpod':
      return config.qwenLora.model;
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
