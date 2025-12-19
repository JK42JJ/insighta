/**
 * Configuration Management Module
 *
 * Provides centralized configuration management with environment validation
 * and type-safe access to application settings.
 */

import dotenv from 'dotenv';
import { z } from 'zod';
import path from 'path';

// Load environment variables
dotenv.config();

/**
 * Environment configuration schema with validation
 */
const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().default('file:./data/youtube-sync.db'),

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
      const missingVars = error.errors.map(err => `${err.path.join('.')}: ${err.message}`);
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
