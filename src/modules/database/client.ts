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
        : [{ emit: 'event', level: 'error' }],
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
