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
import {
  resolveChatbotModel,
  type ChatbotProvider,
  type ProviderDefaults,
} from './copilotkit-model-resolver';
import { getEffectiveProvider, startProviderHealthPoller } from './copilotkit-provider-poller';

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
      // CP477+4 — Use QwenRunpodAdapter (chat.completions forced) instead of
      // CopilotKit's default OpenAIAdapter (which routes via Responses API
      // -> not supported by OpenRouter -> Bug 1 "Invalid Responses API request"
      // on turn 2). includeChatTemplateKwargs disabled because OpenRouter is
      // not vLLM and the field is undocumented there.
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
// CP477+14 — tracks which provider the current lazyYoga was built for, so
// the background poller's failover callback can force a rebuild when the
// effective provider flips (qwen-runpod ↔ openrouter). With the flag off
// `getEffectiveProvider()` always returns `config.chatbot.provider` and
// this never changes, so the existing settings-only rebuild path is
// preserved byte-for-byte.
let lazyBuiltProvider: ChatbotProvider | null = null;

async function getYoga(): Promise<YogaHandler> {
  const settings = await getChatbotSettings();
  // Read-only synchronous lookup — no await, no health probe, no race with
  // PR #732's `req.pause()` paused window.
  const provider = getEffectiveProvider();
  if (!lazyYoga || settings.updatedAt.getTime() > lazyBuildAt || provider !== lazyBuiltProvider) {
    const model = resolveChatbotModel(provider, config.chatbot.model, buildProviderDefaults(), {
      qwenRunpodModel: settings.qwenRunpodModel,
      openrouterModel: settings.openrouterModel,
    });
    const serviceAdapter = createServiceAdapter(provider, model);
    const runtime = new CopilotRuntime();
    lazyYoga = copilotRuntimeNodeHttpEndpoint({
      runtime,
      serviceAdapter,
      endpoint: '/api/v1/chat',
    });
    lazyBuildAt = Date.now();
    lazyBuiltProvider = provider;
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
      // CP477+7 — Pause the request stream BEFORE the async getYoga() wait
      // so raw HTTP 'data'/'end' events don't fire and get lost while yoga
      // is being lazily built or while chatbot_settings 5-min cache is being
      // refreshed (DB query ~50-200ms). Without this pause the body is
      // swallowed → yoga receives empty payload → "Invalid JSON payload" 400.
      // Triggers: cold start (lazyYoga === null), settings cache miss every
      // 5 min, admin model PUT (updatedAt advances).
      req.pause();
      void (async () => {
        try {
          const handler = await getYoga();
          req.resume();
          await handler(req, res);
        } catch (err) {
          // Pre-handler async step failed (e.g., chatbot_settings DB
          // unreachable, adapter env missing). Without this catch the
          // rejection is silent and the client hangs until socket timeout.
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json');
            res.end(
              JSON.stringify({
                error: 'chat_runtime_unavailable',
                message: err instanceof Error ? err.message : 'unknown error',
              })
            );
          }
        }
      })();
      return;
    }
    for (const listener of originalListeners) {
      listener(req, res);
    }
  });

  fastify.get('/config', { onRequest: [fastify.authenticate] }, async (_request, reply) => {
    // Resolve the live model the same way getYoga() does so /config always
    // reflects the value the next chat request will actually use —
    // including the CP477+14 background-poller failover (qwen-runpod →
    // openrouter when Pod /health probe fails). Returns both `effective`
    // (what the next chat will use) and `configured` (the env value) so
    // admin UIs can tell when failover is active.
    const configured = config.chatbot.provider;
    const effective = getEffectiveProvider();
    const settings = await getChatbotSettings();
    const model = resolveChatbotModel(effective, config.chatbot.model, buildProviderDefaults(), {
      qwenRunpodModel: settings.qwenRunpodModel,
      openrouterModel: settings.openrouterModel,
    });
    return reply.send({
      status: 200,
      data: { provider: effective, configured, model },
    });
  });

  // CP477+14 — start the background provider-health poller. No-op when
  // `CHATBOT_FAILOVER_ENABLED=false` (default) or when the configured
  // provider has no failover target. When active, the poller updates the
  // module-level `effectiveProvider` every 5 s; this callback invalidates
  // the lazy yoga so the next chat request rebuilds against the new
  // provider's service adapter.
  startProviderHealthPoller(() => {
    lazyYoga = null;
    lazyBuiltProvider = null;
    lazyBuildAt = 0;
  });

  done();
};
