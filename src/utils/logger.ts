/**
 * Logger Utility
 *
 * Provides structured logging with multiple transports and log levels
 */

import winston from 'winston';
import path from 'path';
import { config } from '../config';

/**
 * Custom log format
 */
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

/**
 * Console format for development
 */
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} ${level}: ${message}`;
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta, null, 2)}`;
    }
    return msg;
  })
);

/**
 * Check if running in serverless environment (Vercel, AWS Lambda, etc.)
 */
const isServerless = !!(
  process.env['VERCEL'] ||
  process.env['AWS_LAMBDA_FUNCTION_NAME'] ||
  process.env['FUNCTION_NAME']
);

/**
 * Create logger instance
 */
const transports: winston.transport[] = [];

// File transports only in non-serverless environments
if (!isServerless) {
  transports.push(
    new winston.transports.File({
      filename: path.join(config.paths.logs, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(config.paths.logs, 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  );
}

// Console transport for development or serverless
if (!config.app.isProduction || isServerless) {
  transports.push(
    new winston.transports.Console({
      format: isServerless ? logFormat : consoleFormat,
    })
  );
}

export const logger = winston.createLogger({
  level: config.app.logLevel,
  format: logFormat,
  defaultMeta: { service: 'youtube-sync' },
  transports,
});

/**
 * Create child logger with context
 */
export function createLogger(context: string) {
  return logger.child({ context });
}

/**
 * Log API quota usage
 */
export function logQuotaUsage(operation: string, cost: number, remaining: number) {
  logger.info('API quota usage', {
    operation,
    cost,
    remaining,
    percentUsed: ((config.quota.dailyLimit - remaining) / config.quota.dailyLimit * 100).toFixed(2),
  });

  if (remaining < (config.quota.dailyLimit - config.quota.warningThreshold)) {
    logger.warn('API quota warning', {
      remaining,
      threshold: config.quota.warningThreshold,
    });
  }
}

/**
 * Log sync operation
 */
export function logSyncOperation(
  playlistId: string,
  status: 'started' | 'completed' | 'failed',
  details?: Record<string, any>
) {
  const logFn = status === 'failed' ? logger.error : logger.info;
  logFn(`Sync ${status}`, {
    playlistId,
    ...details,
  });
}

export default logger;
