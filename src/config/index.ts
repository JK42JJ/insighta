/**
 * Configuration Management Module
 *
 * Provides centralized configuration management with environment validation
 * and type-safe access to application settings.
 */

import dotenv from 'dotenv';
import { z } from 'zod';
import path from 'path';

// Load environment variables (.env.local overrides .env)
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });
dotenv.config();

/**
 * Environment configuration schema with validation
 */
const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().default('file:./data/youtube-sync.db'),
  DIRECT_URL: z.string().optional(),

  // Supabase
  SUPABASE_URL: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_JWT_SECRET: z.string().optional(),

  // YouTube API
  YOUTUBE_API_KEY: z.string().optional(),
  YOUTUBE_CLIENT_ID: z.string().optional(),
  YOUTUBE_CLIENT_SECRET: z.string().optional(),
  YOUTUBE_REDIRECT_URI: z.string().default('http://localhost:3000/oauth/callback'),

  // Encryption
  ENCRYPTION_SECRET: z.string().min(64, 'Encryption secret must be at least 64 characters'),

  // Application
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug', 'verbose']).default('info'),

  // Paths
  CACHE_DIR: z.string().default('./cache'),
  LOG_DIR: z.string().default('./logs'),
  DATA_DIR: z.string().default('./data'),

  // Sync Configuration
  DEFAULT_SYNC_INTERVAL: z.coerce.number().default(3600000), // 1 hour
  MAX_CONCURRENT_SYNCS: z.coerce.number().default(5),
  // CP498 PR2 — pg-boss enrich-rich-summary (Heart path) worker concurrency.
  // unset ⇒ 4. Roll back to serial via RICH_SUMMARY_CONCURRENCY=1.
  RICH_SUMMARY_CONCURRENCY: z.coerce.number().int().min(1).default(4),
  RETRY_ATTEMPTS: z.coerce.number().default(3),
  BACKOFF_MULTIPLIER: z.coerce.number().default(2),

  // YouTube API Quota
  DAILY_QUOTA_LIMIT: z.coerce.number().default(10000),
  QUOTA_WARNING_THRESHOLD: z.coerce.number().default(9000),

  // Mandala Generation (dedicated Ollama instance on Mac Mini)
  MANDALA_GEN_URL: z.string().default('http://localhost:11434'),
  MANDALA_GEN_MODEL: z.string().default('mandala-gen'),
  MANDALA_EMBED_MODEL: z.string().default('qwen3-embedding:8b'),
  MANDALA_EMBED_DIMENSION: z.coerce.number().default(4096),

  // Mandala embedding provider switch (Phase 1, 2026-04-22).
  // 'ollama' keeps the legacy Mac-mini path bit-identical. 'openrouter' routes
  // the service-flow embedGoalForMandala call through OpenRouter instead.
  // Default = ollama so flag-off = pre-Phase-1 behaviour (CLAUDE.md C5).
  MANDALA_EMBED_PROVIDER: z.enum(['ollama', 'openrouter']).default('ollama'),

  // CP504 — race the wizard goal embed across BOTH providers (OpenRouter +
  // Mac Mini Ollama) and take the first to SUCCEED. Eliminates the single
  // point of failure that took the wizard down when OpenRouter ran out of
  // credits (402): the fast cloud provider wins in the common case (speed
  // preserved), but if it dies the Mac Mini qwen3-embedding:8b survives the
  // race (availability). Both are same-family Qwen3-Embedding-8B @ 4096d, so
  // either vector matches the existing mandala_embeddings corpus (search.ts).
  // Default false = the MANDALA_EMBED_PROVIDER selector (existing behaviour);
  // flip true in prod, config-only rollback.
  MANDALA_EMBED_RACE: z
    .preprocess((v) => String(v).toLowerCase() === 'true', z.boolean())
    .default(false),

  // IKS-scorer / shared embedBatch provider switch (Issue #543, 2026-04-28).
  // Distinct from MANDALA_EMBED_PROVIDER: governs the multi-text batch
  // path used by ensureMandalaEmbeddings, v3 executor semantic gate,
  // iks-scorer, batch-video-collector, and v2 video-embedder.
  //   'ollama'     → Mac-mini Ollama first; on transport/HTTP failure,
  //                  auto-fallback to OpenRouter same-model embeddings.
  //   'openrouter' → skip Mac-mini entirely (use when Mac-mini blocked).
  // Reuses OPENROUTER_EMBED_BASE_URL / _MODEL / _DIMENSION below.
  IKS_EMBED_PROVIDER: z.enum(['ollama', 'openrouter']).default('ollama'),

  // LLM Provider
  OLLAMA_URL: z.string().default('http://localhost:11434'),
  OLLAMA_EMBED_MODEL: z.string().default('nomic-embed-text'),
  OLLAMA_GENERATE_MODEL: z.string().default('qwen3.5:9b'),
  LLM_PROVIDER: z.enum(['gemini', 'ollama', 'openrouter', 'auto']).default('auto'),
  LLM_DAILY_COST_LIMIT_USD: z.coerce.number().optional(),
  LLM_MONTHLY_COST_LIMIT_USD: z.coerce.number().optional(),

  // OpenRouter
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default('qwen/qwen3.5-9b'),
  // W2 (CP499+) — belt-and-suspenders thinking suppression for Qwen models.
  // generate() already sends `reasoning: {enabled:false}`, but some OpenRouter
  // providers ignore it (prod 2026-06-10: reasoning-only 1024-token responses
  // + 20-48s calls DESPITE the param). 'true' additionally appends the Qwen
  // chat-template soft switch `/no_think` to the prompt — provider-agnostic.
  // Default false = 기존 동작 (rollback = unset; CLAUDE.md env-default rule).
  OPENROUTER_QWEN_NO_THINK: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  // OpenRouter embedding endpoint (Phase 1). Same OPENROUTER_API_KEY is
  // reused for auth. Base URL is OpenAI-compatible; model id is exact
  // string as listed on the OpenRouter model catalogue. Dim must match
  // the vector(N) column on mandala_embeddings — 4096 is correct for
  // the Qwen3-Embedding-8B family currently in use.
  OPENROUTER_EMBED_BASE_URL: z.string().default('https://openrouter.ai/api/v1'),
  OPENROUTER_EMBED_MODEL: z.string().default('qwen/qwen3-embedding-8b'),
  OPENROUTER_EMBED_DIMENSION: z.coerce.number().default(4096),

  // Gemini
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-1.5-flash'),

  // Chatbot — CopilotKit runtime provider.
  // 'qwen-runpod' routes through CopilotKit OpenAIAdapter against the
  // OpenAI-compatible endpoint exposed by RunPod's worker-vllm
  // (`<base>/openai/v1/chat/completions`). The model id sent in requests
  // is `insighta-chatbot` (vLLM `--served-model-name`).
  CHATBOT_PROVIDER: z.enum(['gemini', 'openrouter', 'local', 'qwen-runpod']).default('openrouter'),
  // CHATBOT_MODEL — explicit override only. When unset, the route falls
  // back to `getDefaultModel(provider)` so each provider picks its native
  // model (qwen-runpod → `insighta-chatbot`, openrouter → gemini-flash).
  // CP475+2: pre-fix the default was `google/gemini-2.5-flash`, which the
  // route then force-injected into every provider's adapter — so the
  // RunPod path sent `model=google/gemini-2.5-flash` to vLLM and 404'd.
  CHATBOT_MODEL: z.string().optional(),
  CHATBOT_LOCAL_URL: z.string().default('http://localhost:11434/v1'),
  // CP477+14 — when 'true', a 5-second background poller updates the
  // effective chatbot provider based on RunPod Pod /health. Default
  // 'false' = no failover (current main HEAD behaviour exactly). Toggle
  // via `gh variable set CHATBOT_FAILOVER_ENABLED=true` + redeploy.
  // Rollback by setting back to 'false' + redeploy — no code revert.
  CHATBOT_FAILOVER_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),

  // Qwen-LoRA serving — RunPod Serverless endpoint base URL.
  // Accepts either the legacy runsync form (`.../<id>/runsync`) or the
  // OpenAI-compatible form (`.../<id>/openai/v1`); the adapter normalises
  // both to the OpenAI form at request time.
  QWEN_LORA_API_URL: z.string().optional(),
  QWEN_LORA_MODEL: z.string().default('insighta-chatbot'),
  RUNPOD_API_KEY: z.string().optional(),

  // CORS — comma-separated origin allowlist (consumed by @fastify/cors AND by
  // routes that bypass the plugin via reply.hijack() such as /wizard-stream).
  CORS_ORIGIN: z
    .string()
    .default(
      'http://localhost:3000,http://localhost:5173,http://localhost:8081,http://localhost:8082'
    ),

  // KG Bridge
  KG_BRIDGE_SIMILAR_TO_THRESHOLD: z.coerce.number().default(0.7),

  // Gmail SMTP Relay (IP-authenticated via EC2)
  GMAIL_SMTP_HOST: z.string().default('smtp-relay.gmail.com'),
  GMAIL_SMTP_PORT: z.coerce.number().default(587),
  GMAIL_SMTP_FROM: z.string().default('noreply@insighta.one'),

  // Observability Phase 2-A — ops alarm recipient (admin inbox). Empty = the
  // alarm job logs the count but sends NO email (inert until the operator sets a
  // real inbox). An email address is config, not a secret (CP392).
  OBSERVABILITY_ALERT_EMAIL: z.string().default(''),
  // Alarm when active YouTube SEARCH keys exceed this — multi-key distribution
  // across Google projects is a ToS ban risk (M4: 8 keys). Expected steady = 1.
  OBSERVABILITY_KEY_ALARM_MAX: z.coerce.number().int().min(1).default(1),

  // Pipeline events — round id stamped on each measurement event (paper §6.2).
  // Increment when starting a new measurement batch.
  PIPELINE_EVENTS_ROUND: z.coerce.number().int().min(1).default(1),

  // Trend collector keyword extraction (D1-b, 2026-05-13).
  //   'ollama'     → Mac-mini Ollama first, OpenRouter race fallback.
  //   'openrouter' → skip Mac Mini, OpenRouter only.
  // See docs/design/mac-mini-deprecation-2026-05-13.md.
  TREND_EXTRACT_PROVIDER: z.enum(['ollama', 'openrouter']).default('ollama'),

  // Cohere Rerank API (hybrid-retrieval spec 2026-05-12, Issue #610 fix).
  // Cross-encoder reranking via `rerank-multilingual-v3.0` (multilingual incl.
  // Korean). Chosen over Mac Mini self-host (temporary scaffold) and OpenRouter
  // (no reranker hosted, verified 2026-05-12). API key required — see
  // memory/credentials.md COHERE_API_KEY entry.
  COHERE_API_KEY: z.string().optional(),
  COHERE_RERANK_MODEL: z.string().default('rerank-multilingual-v3.0'),
  COHERE_RERANK_TIMEOUT_MS: z.coerce.number().default(5000),

  // V3 hybrid retrieval — pipeline flag (default OFF for safe rollout).
  // When true, v3 executor wraps candidate list through hybrid-rerank.ts
  // (tsvector keyword + Cohere rerank + 0-100 normalize + group by video).
  // Replaces V3_USE_YOUTUBE_RANKING_ONLY behavior (PR #555). Flip ON only
  // after manual smoke verifies the Issue #610 regression (mandala 7b99f68c).
  V3_ENABLE_HYBRID_RERANK: z
    .preprocess((v) => String(v).toLowerCase() === 'true', z.boolean())
    .default(false),

  // Per-step request/response trace capture for video-discovery (CP457+).
  // Off → near-zero overhead. On → fire-and-forget INSERT into
  // public.video_discover_traces for every LLM/YouTube/Cohere/embed call.
  V3_TRACE_ENABLED: z
    .preprocess((v) => String(v).toLowerCase() === 'true', z.boolean())
    .default(false),

  // Observability Phase 1 — per-request + per-candidate search trail log
  // (search_trace / search_trace_candidate). Off → near-zero overhead. On →
  // async fire-and-forget INSERT of the full Card Journey for every v5 live
  // search request (wizard | add_cards | pool_serve). Never blocks the serve path.
  SEARCH_TRACE_ENABLED: z
    .preprocess((v) => String(v).toLowerCase() === 'true', z.boolean())
    .default(false),

  // CP494 — video_pool ToS hygiene cron (soft-expire + scrub of stale metadata).
  // Default true: this is a compliance job. Kill-switch only — set 'false' to
  // pause the maintenance worker (the GHA cron will then no-op at the handler).
  POOL_MAINTENANCE_ENABLED: z
    .preprocess((v) => String(v).toLowerCase() !== 'false', z.boolean())
    .default(true),

  // CP512 — metadata REFRESH for active rows (videos.list re-fetch, keeps served
  // rows ToS-compliant AND titled). Default true; set 'false' to pause refresh
  // (scrub still only touches inactive rows, so active rows just stop aging-out).
  POOL_METADATA_REFRESH_ENABLED: z
    .preprocess((v) => String(v).toLowerCase() !== 'false', z.boolean())
    .default(true),

  // CP494 ② — supply bridge: promote youtube_videos (Mac Mini quota-0 sink)
  // into video_pool (source='yt_promoted'). ONE flag controls the write↔read
  // pair: off = promote endpoint no-ops AND v5 poolSources omits 'yt_promoted'
  // (current behavior, code-revert-free rollback). See v5/config.ts.
  SUPPLY_YT_BRIDGE_ENABLED: z
    .preprocess((v) => String(v).toLowerCase() === 'true', z.boolean())
    .default(false),

  // CP498 PR3b — A-stage relevance backfill (user-scoped score on uvs/ulc).
  // Gates the AUTO path only (pipeline-runner uvs + add-cards ulc). Default
  // OFF ⇒ no automatic scoring fires. The admin manual route deliberately
  // bypasses this flag so a controlled 1-mandala measurement can run while it
  // stays off (config-only rollback, no code revert).
  BACKFILL_RELEVANCE_ENABLED: z
    .preprocess((v) => String(v).toLowerCase() === 'true', z.boolean())
    .default(false),
  // Worker concurrency for the enrich-relevance-quick pool. Independent from
  // RICH_SUMMARY_CONCURRENCY (Heart path); both hit the same t3.medium, so
  // lower this if measurement B's CPU ceiling reappears. unset ⇒ 4.
  RELEVANCE_BACKFILL_CONCURRENCY: z.coerce.number().int().min(1).default(4),
  // ISO timestamp — the AUTO path only scores cards created strictly after
  // this (new cards only; existing cards are never auto-backfilled). Unset ⇒
  // the auto path applies no cutoff filter. The admin manual route ignores it.
  RELEVANCE_BACKFILL_CUTOFF: z.string().optional(),
});

type Env = z.infer<typeof envSchema>;

/**
 * Validate and parse environment variables
 */
function parseEnv(): Env {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingVars = error.errors.map((err) => `${err.path.join('.')}: ${err.message}`);
      throw new Error(`Configuration validation failed:\n${missingVars.join('\n')}`);
    }
    throw error;
  }
}

const env = parseEnv();

/**
 * Application Configuration
 *
 * Provides type-safe access to all configuration values
 */
export const config = {
  // Database
  database: {
    url: env.DATABASE_URL,
    directUrl: env.DIRECT_URL,
  },

  // Supabase
  supabase: {
    url: env.SUPABASE_URL,
    anonKey: env.SUPABASE_ANON_KEY,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    jwtSecret: env.SUPABASE_JWT_SECRET,
  },

  // YouTube API
  youtube: {
    apiKey: env.YOUTUBE_API_KEY,
    clientId: env.YOUTUBE_CLIENT_ID,
    clientSecret: env.YOUTUBE_CLIENT_SECRET,
    redirectUri: env.YOUTUBE_REDIRECT_URI,
  },

  // Encryption
  encryption: {
    secret: env.ENCRYPTION_SECRET,
  },

  // Application
  app: {
    env: env.NODE_ENV,
    isDevelopment: env.NODE_ENV === 'development',
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    logLevel: env.LOG_LEVEL,
  },

  // Paths (resolved to absolute paths)
  paths: {
    cache: path.resolve(process.cwd(), env.CACHE_DIR),
    logs: path.resolve(process.cwd(), env.LOG_DIR),
    data: path.resolve(process.cwd(), env.DATA_DIR),
  },

  // Sync Configuration
  sync: {
    defaultInterval: env.DEFAULT_SYNC_INTERVAL,
    maxConcurrent: env.MAX_CONCURRENT_SYNCS,
    retryAttempts: env.RETRY_ATTEMPTS,
    backoffMultiplier: env.BACKOFF_MULTIPLIER,
  },

  // Queue (pg-boss worker concurrency)
  queue: {
    richSummaryConcurrency: env.RICH_SUMMARY_CONCURRENCY,
    relevanceBackfillConcurrency: env.RELEVANCE_BACKFILL_CONCURRENCY,
  },

  // CP498 PR3b — A-stage relevance backfill (auto-path gate + cutoff).
  relevanceBackfill: {
    enabled: env.BACKFILL_RELEVANCE_ENABLED,
    cutoff: env.RELEVANCE_BACKFILL_CUTOFF,
  },

  // YouTube API Quota
  quota: {
    dailyLimit: env.DAILY_QUOTA_LIMIT,
    warningThreshold: env.QUOTA_WARNING_THRESHOLD,
  },

  // Mandala Generation (dedicated Ollama on Mac Mini)
  mandalaGen: {
    url: env.MANDALA_GEN_URL,
    model: env.MANDALA_GEN_MODEL,
    embedModel: env.MANDALA_EMBED_MODEL,
    embedDimension: env.MANDALA_EMBED_DIMENSION,
  },

  // Mandala embedding provider + OpenRouter embed endpoint (Phase 1,
  // 2026-04-22). See docs/design/wizard-service-redesign-2026-04-22.md.
  mandalaEmbed: {
    provider: env.MANDALA_EMBED_PROVIDER,
    race: env.MANDALA_EMBED_RACE,
    openRouterBaseUrl: env.OPENROUTER_EMBED_BASE_URL,
    openRouterModel: env.OPENROUTER_EMBED_MODEL,
    openRouterDimension: env.OPENROUTER_EMBED_DIMENSION,
  },

  // IKS / batch embed provider (Issue #543). Reuses the OpenRouter embed
  // endpoint config from mandalaEmbed.* — only `provider` differs.
  iksEmbed: {
    provider: env.IKS_EMBED_PROVIDER,
  },

  // LLM Provider
  llm: {
    provider: env.LLM_PROVIDER,
    dailyCostLimitUsd: env.LLM_DAILY_COST_LIMIT_USD,
    monthlyCostLimitUsd: env.LLM_MONTHLY_COST_LIMIT_USD,
  },

  // Ollama (local inference)
  ollama: {
    url: env.OLLAMA_URL,
    embedModel: env.OLLAMA_EMBED_MODEL,
    generateModel: env.OLLAMA_GENERATE_MODEL,
  },

  // OpenRouter (cloud inference)
  openrouter: {
    apiKey: env.OPENROUTER_API_KEY,
    model: env.OPENROUTER_MODEL,
    qwenNoThink: env.OPENROUTER_QWEN_NO_THINK,
  },

  // Cohere Rerank (cross-encoder reranking, hybrid-retrieval spec 2026-05-12)
  cohere: {
    apiKey: env.COHERE_API_KEY,
    rerankModel: env.COHERE_RERANK_MODEL,
    rerankTimeoutMs: env.COHERE_RERANK_TIMEOUT_MS,
  },

  // V3 feature flags (hybrid-retrieval spec 2026-05-12)
  v3HybridRerank: {
    enabled: env.V3_ENABLE_HYBRID_RERANK,
  },

  // Discover-pipeline tracing (CP457+).
  discoverTracing: {
    enabled: env.V3_TRACE_ENABLED,
  },

  // Observability Phase 1 — search trail log (search_trace + candidates).
  searchTrace: {
    enabled: env.SEARCH_TRACE_ENABLED,
  },

  // video_pool ToS hygiene cron (CP494).
  poolMaintenance: {
    enabled: env.POOL_MAINTENANCE_ENABLED,
    refreshEnabled: env.POOL_METADATA_REFRESH_ENABLED,
  },

  // Supply bridge: youtube_videos → video_pool promotion (CP494 ②).
  supplyYtBridge: {
    enabled: env.SUPPLY_YT_BRIDGE_ENABLED,
  },

  // Gemini
  gemini: {
    apiKey: env.GEMINI_API_KEY,
    model: env.GEMINI_MODEL,
  },

  // Chatbot (CopilotKit runtime)
  chatbot: {
    provider: env.CHATBOT_PROVIDER,
    model: env.CHATBOT_MODEL,
    localUrl: env.CHATBOT_LOCAL_URL,
    failoverEnabled: env.CHATBOT_FAILOVER_ENABLED,
  },

  // Qwen-LoRA serving — consumed by CopilotKit OpenAIAdapter when provider
  // is 'qwen-runpod'.
  qwenLora: {
    apiUrl: env.QWEN_LORA_API_URL,
    model: env.QWEN_LORA_MODEL,
  },

  // RunPod Serverless — Bearer token used when provider is 'qwen-runpod'.
  runpod: {
    apiKey: env.RUNPOD_API_KEY,
  },

  // CORS — pre-parsed allowlist (split from CORS_ORIGIN env). Consumed by
  // both @fastify/cors plugin (server.ts) and routes that bypass the
  // plugin via reply.hijack() (e.g., /wizard-stream SSE).
  cors: {
    allowedOrigins: env.CORS_ORIGIN.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },

  // KG Bridge
  kgBridge: {
    similarToThreshold: env.KG_BRIDGE_SIMILAR_TO_THRESHOLD,
  },

  // Gmail SMTP Relay (IP-authenticated, no password)
  gmail: {
    smtpHost: env.GMAIL_SMTP_HOST,
    smtpPort: env.GMAIL_SMTP_PORT,
    smtpFrom: env.GMAIL_SMTP_FROM,
  },

  // Observability Phase 2-A — ops alarms.
  observability: {
    alertEmail: env.OBSERVABILITY_ALERT_EMAIL,
    keyAlarmMaxKeys: env.OBSERVABILITY_KEY_ALARM_MAX,
  },

  // Pipeline events (paper §6.2 measurement)
  pipelineEvents: {
    round: env.PIPELINE_EVENTS_ROUND,
  },

  // Trend collector keyword extraction (D1-b)
  trendExtract: {
    provider: env.TREND_EXTRACT_PROVIDER,
  },

  // YouTube API costs (in quota units)
  quotaCosts: {
    playlistDetails: 1,
    playlistItems: 1, // per request (50 items max)
    videos: 1, // per request (50 items max)
    search: 100,
    channels: 1,
  },
} as const;

/**
 * Validate required API credentials
 */
export function validateApiCredentials(): void {
  const missing: string[] = [];

  if (!config.youtube.apiKey && !config.youtube.clientId) {
    missing.push('Either YOUTUBE_API_KEY or YOUTUBE_CLIENT_ID must be set');
  }

  if (config.youtube.clientId && !config.youtube.clientSecret) {
    missing.push('YOUTUBE_CLIENT_SECRET is required when using OAuth');
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required API credentials:\n${missing.join('\n')}\n\n` +
        'Please check .env.example for configuration instructions.'
    );
  }
}

/**
 * Get configuration value by path
 */
export function getConfig<T>(path: string): T {
  const parts = path.split('.');
  let value: any = config;

  for (const part of parts) {
    value = value?.[part];
    if (value === undefined) {
      throw new Error(`Configuration key not found: ${path}`);
    }
  }

  return value as T;
}

export default config;
