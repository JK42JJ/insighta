/**
 * Manual mock for '@/utils/logger' (jest picks this up on jest.mock('@/utils/logger')).
 *
 * Mirrors the real module's full export surface. Production modules call
 * top-level logger.info/warn at import time (e.g. modules/database Prisma
 * init) — hand-rolled child-only partial mocks throw at suite load, which
 * silently broke 5 non-smoke suites that CI never runs.
 */
const childLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

export const logger: any = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn(() => childLogger),
};

export function createLogger(_context: string) {
  return childLogger;
}

export const logQuotaUsage = jest.fn();
export const logSyncOperation = jest.fn();

export default logger;
