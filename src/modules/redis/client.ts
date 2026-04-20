/**
 * Redis — Insighta read client (ACL user `insighta`)
 *
 * Lazy singleton over the self-hosted Redis (prod: EC2 Tailscale bind).
 * Scope is read-only per `docker/redis/redis.acl.template`:
 * `~video:* ~topic:* ~channel:* ~trend:* ~whitelist:* ~blacklist:*` with
 * `+smembers +sismember +scard +zrange +get +hget +hgetall ...`.
 *
 * Caller contract:
 * - `getInsightaRedisClient()` returns a connected client or `null` when
 *   Redis is not configured (`REDIS_HOST` unset). Callers MUST treat
 *   `null` as "Redis unavailable" and fall back to the flag-off path —
 *   no throw in the serving hot path (dual-whitelist.md §3.2 Q2).
 * - `closeInsightaRedisClient()` tears the singleton down (graceful shutdown).
 * - `resetForTesting()` is test-only.
 */

import { createClient, type RedisClientType } from 'redis';

import { logger } from '@/utils/logger';

const log = logger.child({ module: 'redis/client' });

const DEFAULT_PORT = 6379;
const DEFAULT_DB = 0;
const DEFAULT_USER = 'insighta';
const DEFAULT_CONNECT_TIMEOUT_MS = 5000;

export interface RedisEnv {
  REDIS_HOST?: string;
  REDIS_PORT?: string;
  REDIS_DB?: string;
  REDIS_USER?: string;
  REDIS_INSIGHTA_PASSWORD?: string;
  REDIS_CONNECT_TIMEOUT_MS?: string;
}

interface ResolvedConfig {
  host: string;
  port: number;
  database: number;
  username: string;
  password: string;
  connectTimeout: number;
}

let singleton: RedisClientType | null = null;
let connectPromise: Promise<RedisClientType | null> | null = null;

/** Connection factory — overridable for tests. */
export type RedisClientFactory = (cfg: ResolvedConfig) => RedisClientType;

const defaultFactory: RedisClientFactory = (cfg) =>
  createClient({
    socket: { host: cfg.host, port: cfg.port, connectTimeout: cfg.connectTimeout },
    database: cfg.database,
    username: cfg.username,
    password: cfg.password,
  }) as RedisClientType;

let factory: RedisClientFactory = defaultFactory;

function resolveConfig(env: RedisEnv): ResolvedConfig | null {
  const host = env.REDIS_HOST?.trim();
  if (!host) return null;
  const password = env.REDIS_INSIGHTA_PASSWORD?.trim();
  if (!password) {
    log.warn('redis.config.missing_password host=%s — returning null (fail-open)', host);
    return null;
  }
  return {
    host,
    port: parseIntOr(env.REDIS_PORT, DEFAULT_PORT),
    database: parseIntOr(env.REDIS_DB, DEFAULT_DB),
    username: env.REDIS_USER?.trim() || DEFAULT_USER,
    password,
    connectTimeout: parseIntOr(env.REDIS_CONNECT_TIMEOUT_MS, DEFAULT_CONNECT_TIMEOUT_MS),
  };
}

function parseIntOr(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Return the shared Insighta Redis client, connecting on first call.
 *
 * Returns `null` when `REDIS_HOST` is unset (dev/CI) or password is missing,
 * or when the connection attempt throws. Callers MUST handle `null`.
 */
export async function getInsightaRedisClient(
  env: RedisEnv = process.env as RedisEnv
): Promise<RedisClientType | null> {
  if (singleton !== null) return singleton;
  if (connectPromise) return connectPromise;

  const cfg = resolveConfig(env);
  if (!cfg) return null;

  connectPromise = (async () => {
    try {
      const client = factory(cfg);
      client.on('error', (err: Error) => {
        log.warn(`redis.client.error: ${err.message}`);
      });
      await client.connect();
      singleton = client;
      log.info(`redis.client.connected host=${cfg.host} db=${cfg.database} user=${cfg.username}`);
      return client;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`redis.client.connect_failed — returning null (fail-open): ${msg}`);
      singleton = null;
      return null;
    } finally {
      connectPromise = null;
    }
  })();

  return connectPromise;
}

/** Graceful shutdown. Safe to call when no client exists. Idempotent. */
export async function closeInsightaRedisClient(): Promise<void> {
  const client = singleton;
  singleton = null;
  connectPromise = null;
  if (!client) return;
  try {
    await client.quit();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`redis.client.close_failed: ${msg}`);
  }
}

/** Test-only: clear singleton state and override the connection factory. */
export function resetForTesting(nextFactory?: RedisClientFactory): void {
  singleton = null;
  connectPromise = null;
  factory = nextFactory ?? defaultFactory;
}
