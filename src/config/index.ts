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

  // LLM Provider
  OLLAMA_URL: z.string().default('http://localhost:11434'),
  OLLAMA_EMBED_MODEL: z.string().default('nomic-embed-text'),
  OLLAMA_GENERATE_MODEL: z.string().default('qwen3.5:9b'),
  LLM_PROVIDER: z.enum(['gemini', 'ollama', 'openrouter', 'auto']).default('auto'),

  // OpenRouter
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default('qwen/qwen3.5-9b'),
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

  // Chatbot
  CHATBOT_PROVIDER: z.enum(['gemini', 'openrouter', 'local']).default('openrouter'),
  CHATBOT_MODEL: z.string().default('google/gemini-2.5-flash'),
  CHATBOT_LOCAL_URL: z.string().default('http://localhost:11434/v1'),

  // Gmail SMTP Relay (IP-authenticated via EC2)
  GMAIL_SMTP_HOST: z.string().default('smtp-relay.gmail.com'),
  GMAIL_SMTP_PORT: z.coerce.number().default(587),
  GMAIL_SMTP_FROM: z.string().default('noreply@insighta.one'),
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
    openRouterBaseUrl: env.OPENROUTER_EMBED_BASE_URL,
    openRouterModel: env.OPENROUTER_EMBED_MODEL,
    openRouterDimension: env.OPENROUTER_EMBED_DIMENSION,
  },

  // LLM Provider
  llm: {
    provider: env.LLM_PROVIDER,
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
  },

  // Gemini
  gemini: {
    apiKey: env.GEMINI_API_KEY,
    model: env.GEMINI_MODEL,
  },

  // Chatbot (CopilotKit runtime)
  chatbot: {
    provider: env.CHATBOT_PROVIDER as 'gemini' | 'openrouter' | 'local',
    model: env.CHATBOT_MODEL,
    localUrl: env.CHATBOT_LOCAL_URL,
  },

  // Gmail SMTP Relay (IP-authenticated, no password)
  gmail: {
    smtpHost: env.GMAIL_SMTP_HOST,
    smtpPort: env.GMAIL_SMTP_PORT,
    smtpFrom: env.GMAIL_SMTP_FROM,
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
