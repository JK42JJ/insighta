/**
 * Database Client
 *
 * Provides Prisma client instance with connection management
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '../../utils/logger';
import { DatabaseError } from '../../utils/errors';
import { config } from '../../config';
import { buildConnectionUrl, getPoolLimit } from './connection-url';

/**
 * Prisma client instance (singleton)
 */
let prismaInstance: PrismaClient | null = null;

/**
 * Slow-query logging threshold for prod diagnostics (2026-04-18).
 *
 * When > 0, Prisma emits a `query` event per SQL and the listener below
 * logs only the rows whose `duration` meets or exceeds this threshold
 * (ms). Set to 0 to fully disable the listener + the underlying event
 * emission (zero overhead path). Default 1000 so the next P2028 incident
 * leaves a SQL-level trail in `docker logs`. Override at runtime via the
 * `PRISMA_SLOW_QUERY_LOG_MS` env var — no redeploy needed to disable.
 */
const DEFAULT_SLOW_QUERY_MS = 1000;

function getSlowQueryThresholdMs(): number {
  const raw = process.env['PRISMA_SLOW_QUERY_LOG_MS'];
  if (raw === undefined) return DEFAULT_SLOW_QUERY_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_SLOW_QUERY_MS;
}

/**
 * Get Prisma client instance
 */
export function getPrismaClient(): PrismaClient {
  if (!prismaInstance) {
    // Override DATABASE_URL's connection_limit at client construction so the
    // committed .env (CP358-protected) can stay at the conservative default
    // while prod gets a larger pool. See connection-url.ts for the full
    // rationale + the P2024 / wizard-10s-hang prod incident this addresses.
    const poolLimit = getPoolLimit();
    const url = buildConnectionUrl(process.env['DATABASE_URL'], poolLimit);
    const slowQueryMs = getSlowQueryThresholdMs();

    const prodLog: Array<{ emit: 'event'; level: 'query' | 'error' | 'warn' }> = [
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' },
    ];
    if (slowQueryMs > 0) {
      prodLog.push({ emit: 'event', level: 'query' });
    }

    prismaInstance = new PrismaClient({
      datasources: { db: { url } },
      log: config.app.isDevelopment
        ? [
            { emit: 'event', level: 'query' },
            { emit: 'event', level: 'error' },
            { emit: 'event', level: 'warn' },
          ]
        : prodLog,
    });

    logger.info('Prisma client initialized', { pool_limit: poolLimit });
    // Mirror the init line to docker stdout via pino-compatible JSON so the
    // container logs aggregator picks it up (winston in this codebase writes
    // to file only — docker logs was empty when we needed to verify
    // connection_limit and pool settings on 2026-04-18).
    console.info(
      '[prisma-init]',
      JSON.stringify({
        pool_limit: poolLimit,
        slow_query_ms: slowQueryMs,
        url_scheme: url.split('?')[0],
      })
    );

    // Log queries in development (existing winston path)
    if (config.app.isDevelopment) {
      prismaInstance.$on('query' as never, (e: any) => {
        logger.debug('Database query', {
          query: e.query,
          params: e.params,
          duration: e.duration,
        });
      });
    }

    // Prod slow-query listener. Only registered when the threshold is > 0
    // (guarded above via prodLog so event emission is also skipped).
    if (!config.app.isDevelopment && slowQueryMs > 0) {
      prismaInstance.$on('query' as never, (e: any) => {
        const durationMs = typeof e?.duration === 'number' ? e.duration : 0;
        if (durationMs < slowQueryMs) return;
        console.info(
          '[prisma-slow-query]',
          JSON.stringify({
            duration_ms: durationMs,
            target: typeof e?.target === 'string' ? e.target : undefined,
            query: String(e?.query ?? '').slice(0, 250),
          })
        );
      });
    }

    // Log errors
    prismaInstance.$on('error' as never, (e: any) => {
      logger.error('Database error', { error: e });
    });

    // Log warnings
    prismaInstance.$on('warn' as never, (e: any) => {
      logger.warn('Database warning', { warning: e });
    });
  }

  return prismaInstance;
}

/**
 * Retry wrapper for transient database errors
 * Handles PgBouncer connection issues and transient failures
 */
/**
 * Check if a Prisma error indicates a stale/broken connection pool
 */
function isConnectionError(error: any): boolean {
  return (
    error?.code === 'P2024' || // Timed out fetching a new connection from the connection pool
    error?.code === 'P1017' || // Server has closed the connection
    error?.code === 'P1001' || // Can't reach database server
    error?.code === 'P1002' || // Database server reached but timed out
    error?.message?.includes('prepared statement') ||
    error?.message?.includes('server closed the connection') ||
    error?.message?.includes('Connection refused') ||
    error?.message?.includes('connection pool')
  );
}

/**
 * Force-reset the Prisma client (disconnect + destroy singleton).
 * Next call to getPrismaClient() creates a fresh instance with a new pool.
 */
export async function resetConnectionPool(): Promise<void> {
  return resetPrismaClient();
}

async function resetPrismaClient(): Promise<void> {
  if (prismaInstance) {
    logger.warn('Resetting Prisma client — creating fresh connection pool');
    try {
      await prismaInstance.$disconnect();
    } catch {
      // ignore disconnect errors during reset
    }
    prismaInstance = null;
  }
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 100
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      if (!isConnectionError(error) || attempt === maxRetries) {
        throw error;
      }

      // On connection errors, reset the pool before retrying
      await resetPrismaClient();

      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      logger.warn('Transient DB error, retrying with fresh pool', {
        attempt,
        maxRetries,
        code: error?.code,
        message: error?.message?.substring(0, 100),
        delayMs: delay,
      });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error('Unreachable');
}

/**
 * Connect to database
 */
export async function connectDatabase(): Promise<void> {
  try {
    const client = getPrismaClient();
    await client.$connect();
    logger.info('Database connected successfully');
  } catch (error) {
    logger.error('Failed to connect to database', { error });
    throw new DatabaseError('Database connection failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Disconnect from database
 */
export async function disconnectDatabase(): Promise<void> {
  try {
    if (prismaInstance) {
      await prismaInstance.$disconnect();
      prismaInstance = null;
      logger.info('Database disconnected successfully');
    }
  } catch (error) {
    logger.error('Error disconnecting from database', { error });
    throw new DatabaseError('Database disconnection failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Test database connection
 */
export async function testDatabaseConnection(): Promise<boolean> {
  try {
    const client = getPrismaClient();
    await client.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    logger.error('Database connection test failed', { error });
    return false;
  }
}

/**
 * Execute transaction
 */
export async function executeTransaction<T>(
  callback: (prisma: PrismaClient) => Promise<T>
): Promise<T> {
  const client = getPrismaClient();
  try {
    return await client.$transaction(async (tx) => {
      return await callback(tx as PrismaClient);
    });
  } catch (error) {
    logger.error('Transaction failed', { error });
    throw new DatabaseError('Transaction execution failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export const db = getPrismaClient();
export default db;
