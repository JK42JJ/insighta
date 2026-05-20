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
import { getChatbotSettings } from '@/modules/chatbot-settings/service';
import { toRunpodOpenAiBase } from './copilotkit-base-url';
import { resolveEffectiveProvider } from './copilotkit-health';
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
      // CP477+4 — Use QwenRunpodAdapter (chat.completions forced) instead
      // of CopilotKit's default OpenAIAdapter (which routes via Responses
      // API → not supported by OpenRouter for many models → Bug 1
      // "Invalid Responses API request" on turn 2). Same Bug 1 fix as
      // qwen-runpod path. chat_template_kwargs disabled because OpenRouter
      // is not vLLM and the field is undocumented there.
      if (!config.openrouter.apiKey) {
        throw new Error('OPENROUTER_API_KEY not set');
      }
      return new QwenRunpodAdapter({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: config.openrouter.apiKey,
        model,
        includeChatTemplateKwargs: false,
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

// ---------------------------------------------------------------------------
// Lazy yoga handler — rebuilt only when admin settings change (CP475+3).
//
// `getChatbotSettings()` is cheap (5-min in-memory cache hit, O(1)). We rebuild
// the yoga + serviceAdapter only when settings.updatedAt has advanced past
// the last build timestamp. PUT /admin/chatbot/models invalidates the cache,
// so the next request reads the new settings and rebuilds.
// ---------------------------------------------------------------------------

type YogaHandler = ReturnType<typeof copilotRuntimeNodeHttpEndpoint>;

let lazyYoga: YogaHandler | null = null;
let lazyBuildAt = 0;
let lazyEffectiveProvider: ChatbotProvider | null = null;

// CP477+3 — qwen-runpod ↔ openrouter health-check failover. Helpers live
// in `./copilotkit-health` so they can be unit-tested without pulling in
// the env-validating `config` module at jest import time.

async function getYoga(): Promise<YogaHandler> {
  const settings = await getChatbotSettings();
  const configured = config.chatbot.provider;
  const effective = await resolveEffectiveProvider(configured, config.qwenLora.apiUrl);
  if (
    !lazyYoga ||
    settings.updatedAt.getTime() > lazyBuildAt ||
    effective !== lazyEffectiveProvider
  ) {
    const model = resolveChatbotModel(effective, config.chatbot.model, buildProviderDefaults(), {
      qwenRunpodModel: settings.qwenRunpodModel,
      openrouterModel: settings.openrouterModel,
    });
    const serviceAdapter = createServiceAdapter(effective, model);
    const runtime = new CopilotRuntime();
    lazyYoga = copilotRuntimeNodeHttpEndpoint({
      runtime,
      serviceAdapter,
      endpoint: '/api/v1/chat',
    });
    lazyBuildAt = Date.now();
    lazyEffectiveProvider = effective;
  }
  return lazyYoga;
}

export const copilotKitRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // yoga is a graphql-yoga instance — register on raw HTTP server to bypass
  // Fastify body parsing entirely. CP475+3: build lazily on first request so
  // we can read admin DB settings async.
  const server = fastify.server;
  const originalListeners = server.listeners('request');

  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    if (req.url?.startsWith('/api/v1/chat') && !req.url?.startsWith('/api/v1/chat/config')) {
      void (async () => {
        const handler = await getYoga();
        await handler(req, res);
      })();
      return;
    }
    for (const listener of originalListeners) {
      listener(req, res);
    }
  });

  fastify.get('/config', { onRequest: [fastify.authenticate] }, async (_request, reply) => {
    // Resolve the live model the same way getYoga() does so /config always
    // reflects the value the next chat request will actually use — including
    // the CP477+3 health-check failover (qwen-runpod → openrouter when
    // Pod is unreachable).
    const configured = config.chatbot.provider;
    const effective = await resolveEffectiveProvider(configured, config.qwenLora.apiUrl);
    const settings = await getChatbotSettings();
    const model = resolveChatbotModel(effective, config.chatbot.model, buildProviderDefaults(), {
      qwenRunpodModel: settings.qwenRunpodModel,
      openrouterModel: settings.openrouterModel,
    });
    return reply.send({
      status: 200,
      data: {
        provider: effective,
        model,
        // Surface the configured-vs-effective split so the admin UI can show
        // "qwen-runpod (falling back to openrouter — Pod unreachable)".
        configuredProvider: configured,
        failoverActive: configured !== effective,
      },
    });
  });

  done();
};
