/**
 * Database Client
 *
 * Provides Prisma client instance with connection management
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '../../utils/logger';
import { DatabaseError } from '../../utils/errors';
import { config } from '../../config';

/**
 * Prisma client instance (singleton)
 */
let prismaInstance: PrismaClient | null = null;

/**
 * Get Prisma client instance
 */
export function getPrismaClient(): PrismaClient {
  if (!prismaInstance) {
    prismaInstance = new PrismaClient({
      log: config.app.isDevelopment
        ? [
            { emit: 'event', level: 'query' },
            { emit: 'event', level: 'error' },
            { emit: 'event', level: 'warn' },
          ]
        : [
            { emit: 'event', level: 'error' },
            { emit: 'event', level: 'warn' },
          ],
    });

    // Log queries in development
    if (config.app.isDevelopment) {
      prismaInstance.$on('query' as never, (e: any) => {
        logger.debug('Database query', {
          query: e.query,
          params: e.params,
          duration: e.duration,
        });
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
