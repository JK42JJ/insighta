import 'reflect-metadata';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance, FastifyPluginCallback } from 'fastify';
import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNodeHttpEndpoint,
  type CopilotServiceAdapter,
} from '@copilotkit/runtime';
import OpenAI from 'openai';
import { config } from '@/config/index';
import { logger } from '@/utils/logger';
import { QwenRunpodAdapter } from '@/modules/chatbot-rag';
import { getChatbotSettings } from '@/modules/chatbot-settings/service';
import { extractTokenFromHeader } from '@/api/plugins/auth';
import { toRunpodOpenAiBase } from './copilotkit-base-url';
import {
  resolveChatbotModel,
  type ChatbotProvider,
  type ProviderDefaults,
} from './copilotkit-model-resolver';
import { getEffectiveProvider, startProviderHealthPoller } from './copilotkit-provider-poller';
import { runWithChatbotContext, type ChatbotRequestContext } from './chatbot-context-storage';
import { checkUserRateLimit, creditBlockedFromCache } from '@/modules/llm/cost-gate';
import { creditBlockMessage } from '@/modules/llm/credit-guard';
import { MINUTES_PER_HOUR, SECONDS_PER_MINUTE } from '@/utils/time-constants';

const OPENROUTER_DEFAULT_MODEL = 'google/gemini-2.5-flash';

/** Path prefix the CopilotKit runtime owns on the raw HTTP server. */
const CHAT_RUNTIME_PATH = '/api/v1/chat';
/** Fastify route under the same prefix; served by Fastify, not by the runtime. */
const CHAT_CONFIG_PATH = '/api/v1/chat/config';

const HTTP_UNAUTHORIZED = 401;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_INTERNAL_SERVER_ERROR = 500;
const HTTP_SERVICE_UNAVAILABLE = 503;

const UNAUTHORIZED_BODY = { error: 'unauthorized', message: '로그인이 필요합니다.' } as const;
const RATE_LIMITED_MESSAGE = '시간당 질문 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.';
/** Used only if the limiter refused without computing a wait: the full window. */
const RETRY_AFTER_FALLBACK_SEC = SECONDS_PER_MINUTE * MINUTES_PER_HOUR;

/**
 * Write a JSON answer from the listener. Every early exit here (401, 429,
 * 503, 500) goes through this so the shape and the content-type agree.
 */
function respondJson(
  res: ServerResponse,
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  for (const [name, value] of Object.entries(headers)) {
    res.setHeader(name, value);
  }
  res.end(JSON.stringify(body));
}

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

/**
 * Verify the request's JWT and return the caller's identity, or `null` when
 * the header is absent, malformed, expired or fails signature verification.
 * The listener answers `null` with 401: the chat is a per-user surface (the
 * prompt carries the caller's mandalas and notes, the ledger row carries
 * their `user_id`, the rate limit counts by it), so a request nobody can be
 * named for is refused rather than served anonymously as it was before.
 *
 * SYNCHRONOUS — this MUST stay sync. The function is called BEFORE
 * `req.pause()` (the PR #732 race-fix paused window), and adding an
 * `await` inside it caused CP477+15's first ship to break the chat
 * endpoint with 400 "Invalid JSON payload" — same failure mode as
 * PR #737 (CP477+11) which proved "two async hops inside the paused
 * window race against the HTTP parser's 'data' event delivery".
 * `@fastify/jwt`'s `fastify.jwt.verify(token)` is itself synchronous
 * (the async path is `request.jwtVerify()` which the raw HTTP listener
 * cannot use); we keep the same JWKS public key cache `fastify.authenticate`
 * uses, so verification is just a cached ES256 signature check.
 *
 * Same verifier as `fastify.authenticate` (`src/api/plugins/auth.ts`):
 * `request.jwtVerify()` there and `fastify.jwt.verify()` here are the two
 * entry points of the one `@fastify/jwt` instance `registerAuth` configured,
 * so key material, algorithm and expiry handling are shared, not copied.
 * Not mirrored: the `INSIGHTA_BOT_KEY` service-key path and the
 * `?access_token=` query fallback, neither of which the chat client uses.
 */
function extractChatbotContext(
  fastify: FastifyInstance,
  req: IncomingMessage
): ChatbotRequestContext | null {
  const authHeader = req.headers['authorization'];
  const token = typeof authHeader === 'string' ? extractTokenFromHeader(authHeader) : null;
  if (!token) {
    logger.info('[copilotkit] chat request refused: no bearer token');
    return null;
  }
  try {
    const claims = fastify.jwt.verify<{
      sub: string;
      email?: string;
      user_metadata?: Record<string, unknown>;
    }>(token);
    const userMeta = claims.user_metadata ?? {};
    const displayName =
      (userMeta['name'] as string | undefined) ??
      (userMeta['full_name'] as string | undefined) ??
      claims.email?.split('@')[0] ??
      undefined;
    if (!claims.sub) {
      logger.info('[copilotkit] chat request refused: token has no subject');
      return null;
    }
    return {
      userId: claims.sub,
      email: claims.email ?? '',
      displayName,
    };
  } catch (err) {
    // Expired, wrong signature, malformed. The message is @fastify/jwt's
    // ("Access token has expired" for the case the client can recover from
    // by refreshing).
    logger.info('[copilotkit] chat request refused: token rejected', {
      reason: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

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

/**
 * Hand the request to the CopilotKit runtime, applying the per-user rate
 * limit on the way when asked to.
 *
 * CP477+7 — Pause the request stream BEFORE the async wait so raw HTTP
 * 'data'/'end' events don't fire and get lost while yoga is being lazily
 * built or while the chatbot_settings 5-min cache is being refreshed (DB
 * query ~50-200ms). Without this pause the body is swallowed → yoga receives
 * an empty payload → "Invalid JSON payload" 400. Triggers: cold start
 * (lazyYoga === null), settings cache miss every 5 min, admin model PUT
 * (updatedAt advances).
 *
 * PR #732's race-fix tolerates a SINGLE async hop inside the paused window
 * (PR #737 and the first CP477+15 ship each added a second and broke chat).
 * The rate-limit count therefore runs alongside the runtime lookup under one
 * `await`, not after it.
 */
function runChatRuntime(
  req: IncomingMessage,
  res: ServerResponse,
  chatbotCtx: ChatbotRequestContext,
  opts: { enforceRateLimit: boolean }
): void {
  req.pause();
  void (async () => {
    try {
      const [handler, rate] = await Promise.all([
        getYoga(),
        opts.enforceRateLimit ? checkUserRateLimit(chatbotCtx.userId ?? null) : null,
      ]);
      if (rate && !rate.allowed) {
        const retryAfterSec = rate.retryAfterSec ?? RETRY_AFTER_FALLBACK_SEC;
        respondJson(
          res,
          HTTP_TOO_MANY_REQUESTS,
          { error: 'rate_limited', message: RATE_LIMITED_MESSAGE, retryAfterSec },
          { 'retry-after': String(retryAfterSec) }
        );
        return;
      }
      await runWithChatbotContext(chatbotCtx, async () => {
        req.resume();
        await handler(req, res);
      });
    } catch (err) {
      // Pre-handler async step failed (e.g., chatbot_settings DB
      // unreachable, adapter env missing). Without this catch the
      // rejection is silent and the client hangs until socket timeout.
      if (!res.headersSent) {
        respondJson(res, HTTP_INTERNAL_SERVER_ERROR, {
          error: 'chat_runtime_unavailable',
          message: err instanceof Error ? err.message : 'unknown error',
        });
      }
    }
  })();
}

export const copilotKitRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // BL-10 fix (2026-07-03) — WARM-UP the yoga runtime at boot, BEFORE the
  // server accepts connections, so the very first /api/v1/chat/info request
  // never hits the cold-start (lazyYoga === null) window. That window is the
  // root cause of the intermittent 400 "Invalid JSON payload" that hangs the
  // chatbot until refresh (PR #732/#737 partially mitigated it twice and it
  // still recurred — this eliminates the boot window rather than racing it).
  // onReady runs after all plugins load and BEFORE fastify.listen() starts
  // accepting requests = the readiness gate. A warm-up failure (DB not ready,
  // adapter env missing) is logged and swallowed: the lazy path + the FE retry
  // remain as the safety net for the rare admin-settings-change rebuild.
  fastify.addHook('onReady', async () => {
    try {
      await getYoga();
      logger.info('[copilotkit] yoga runtime warmed up at boot (cold-start window closed)');
    } catch (err) {
      logger.warn(
        `[copilotkit] boot warm-up failed (lazy path will retry): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  });

  // yoga is a graphql-yoga instance — register on raw HTTP server to bypass
  // Fastify body parsing entirely. CP475+3: build lazily on first request so
  // we can read admin DB settings async.
  const server = fastify.server;
  const originalListeners = server.listeners('request');

  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    if (req.url?.startsWith(CHAT_RUNTIME_PATH) && !req.url?.startsWith(CHAT_CONFIG_PATH)) {
      // A CORS preflight carries no credentials by specification, so it
      // cannot pass the identity check, and a 401 here would stop a
      // cross-origin client before its real request is sent. It never
      // reaches a provider; the runtime answers it itself.
      if (req.method === 'OPTIONS') {
        runChatRuntime(req, res, {}, { enforceRateLimit: false });
        return;
      }

      // Guard 1 — identity. Verified SYNCHRONOUSLY before `req.pause()`.
      // Headers are already parsed by Node's HTTP parser by the time this
      // 'request' event fires (the body is the only thing still streaming),
      // so reading them needs no await. Keeping this OUT of the paused
      // window is mandatory: PR #737 (CP477+11) and the first CP477+15 ship
      // both broke chat with 400 "Invalid JSON payload" by putting a second
      // `await` inside the pause window — body 'data' events race the
      // awaits and get lost. No valid JWT → 401, and nothing else runs.
      const chatbotCtx = extractChatbotContext(fastify, req);
      if (!chatbotCtx) {
        respondJson(res, HTTP_UNAUTHORIZED, UNAUTHORIZED_BODY);
        return;
      }

      // Guard 2 — provider credit / budget breaker. Synchronous on purpose:
      // this runs before `req.pause()` and adds no await, so the
      // single-async-hop rule the body handling depends on is untouched.
      // Reads the in-process cache only — a provider known to be refusing
      // gets a 503 here instead of a round trip that would certainly fail.
      // Cold cache lets the call through.
      const chatProvider = getEffectiveProvider();
      const chatCreditKey = chatProvider === 'qwen-runpod' ? 'qwen-runpod' : 'openrouter';
      const chatCredit = creditBlockedFromCache(chatCreditKey);
      if (chatCredit) {
        respondJson(res, HTTP_SERVICE_UNAVAILABLE, {
          error: 'chat_provider_out_of_credits',
          message: creditBlockMessage(chatCredit),
        });
        return;
      }

      // Guard 3 — per-user rate limit, inside the paused window (it needs
      // the ledger). Only POST reaches a provider: the GET `/info` bootstrap
      // and the runtime's other reads do not, so they are not counted or
      // refused, and a limited client can still load the chat surface.
      runChatRuntime(req, res, chatbotCtx, { enforceRateLimit: req.method === 'POST' });
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
