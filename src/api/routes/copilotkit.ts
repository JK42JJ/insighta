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
import { toRunpodOpenAiBase } from './copilotkit-base-url';
import {
  resolveChatbotModel,
  type ChatbotProvider,
  type ProviderDefaults,
} from './copilotkit-model-resolver';

const OPENROUTER_DEFAULT_MODEL = 'google/gemini-2.5-flash';

function buildProviderDefaults(): ProviderDefaults {
  return {
    openrouter: OPENROUTER_DEFAULT_MODEL,
    local: config.ollama.generateModel,
    qwenRunpod: config.qwenLora.model,
  };
}

function createServiceAdapter(provider: ChatbotProvider, model: string): CopilotServiceAdapter {
  switch (provider) {
    case 'gemini':
    case 'openrouter':
      return new OpenAIAdapter({
        openai: new OpenAI({
          apiKey: config.openrouter.apiKey,
          baseURL: 'https://openrouter.ai/api/v1',
        }),
        model,
      });

    case 'local':
      return new OpenAIAdapter({
        openai: new OpenAI({
          apiKey: 'not-needed',
          baseURL: config.chatbot.localUrl,
        }),
        model,
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
        model,
      });
  }
}

export const copilotKitRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  const provider = config.chatbot.provider;
  // CP475+2 — resolve via provider-aware fallback so `qwen-runpod` no
  // longer inherits the openrouter gemini-flash default and sends a
  // model name vLLM doesn't recognise. CHATBOT_MODEL env still wins.
  const model = resolveChatbotModel(provider, config.chatbot.model, buildProviderDefaults());
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
        // `model` is already provider-resolved above (CP475+2 fix); send as-is.
        model,
      },
    });
  });

  done();
};
