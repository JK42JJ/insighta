/**
 * Job Queue Unit Tests
 *
 * Tests for:
 * - JobQueueManager lifecycle (start/stop/singleton)
 * - Connection string handling (DIRECT_URL, PgBouncer stripping)
 * - Job types and constants
 */

// ============================================================================
// Mocks
// ============================================================================

const mockBossInstance = {
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
  work: jest.fn().mockResolvedValue('worker-id'),
  send: jest.fn().mockResolvedValue('job-id'),
  schedule: jest.fn().mockResolvedValue(undefined),
  getQueueSize: jest.fn().mockResolvedValue(0),
};

const MockPgBoss = jest.fn().mockImplementation(() => mockBossInstance);

jest.mock('pg-boss', () => {
  return MockPgBoss;
});

jest.mock('../../../src/config', () => ({
  config: {
    database: {
      url: 'postgresql://postgres:pass@127.0.0.1:5432/postgres',
      directUrl: undefined,
    },
    app: {
      isDevelopment: true,
      isProduction: false,
      isTest: true,
    },
  },
}));

jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../../src/modules/database/client', () => ({
  getPrismaClient: jest.fn().mockReturnValue({
    $queryRaw: jest.fn().mockResolvedValue([{ count: BigInt(0) }]),
    $executeRaw: jest.fn().mockResolvedValue(1),
  }),
}));

jest.mock('../../../src/modules/ontology/enrichment', () => ({
  enrichVideo: jest.fn().mockResolvedValue({
    videoId: 'test-video',
    summaryEn: 'Test summary',
    tags: ['test'],
    model: 'test-model',
    cached: false,
  }),
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import {
  JOB_NAMES,
  QUEUE_CONFIG,
  DEFAULT_RETRY_OPTIONS,
  ENRICH_RETRY_OPTIONS,
  BATCH_SCAN_OPTIONS,
} from '../../../src/modules/queue/types';
import { JobQueueManager, getJobQueue } from '../../../src/modules/queue/manager';

// ============================================================================
// Type Constants Tests
// ============================================================================

describe('Job Queue Types', () => {
  test('JOB_NAMES contains expected queue names', () => {
    expect(JOB_NAMES.ENRICH_VIDEO).toBe('enrich-video');
    expect(JOB_NAMES.BATCH_SCAN).toBe('batch-scan');
  });

  test('QUEUE_CONFIG has valid cron expression', () => {
    expect(QUEUE_CONFIG.BATCH_SCAN_CRON).toBe('*/30 * * * *');
    expect(QUEUE_CONFIG.ENRICH_CONCURRENCY).toBe(1);
    expect(QUEUE_CONFIG.ARCHIVE_COMPLETED_AFTER_DAYS).toBe(7);
    expect(QUEUE_CONFIG.ARCHIVE_FAILED_AFTER_DAYS).toBe(14);
  });

  test('retry options are properly configured', () => {
    expect(DEFAULT_RETRY_OPTIONS.retryLimit).toBe(2);
    expect(DEFAULT_RETRY_OPTIONS.retryBackoff).toBe(true);
    expect(ENRICH_RETRY_OPTIONS.retryLimit).toBe(1);
    expect(ENRICH_RETRY_OPTIONS.expireInMinutes).toBe(10);
    expect(BATCH_SCAN_OPTIONS.retryLimit).toBe(0);
  });
});

// ============================================================================
// JobQueueManager Tests
// ============================================================================

describe('JobQueueManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('start() initializes pg-boss with connection string', async () => {
    const manager = new JobQueueManager();
    await manager.start();

    expect(MockPgBoss).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionString: 'postgresql://postgres:pass@127.0.0.1:5432/postgres',
        schema: 'pgboss',
      })
    );
    expect(mockBossInstance.start).toHaveBeenCalled();
    expect(manager.isRunning()).toBe(true);
  });

  test('start() is idempotent', async () => {
    const manager = new JobQueueManager();
    await manager.start();

    const callCount = MockPgBoss.mock.calls.length;
    await manager.start(); // second call should no-op

    expect(MockPgBoss).toHaveBeenCalledTimes(callCount); // no new constructor
    expect(mockBossInstance.start).toHaveBeenCalledTimes(1);
  });

  test('stop() stops pg-boss gracefully', async () => {
    const manager = new JobQueueManager();
    await manager.start();
    await manager.stop();

    expect(mockBossInstance.stop).toHaveBeenCalledWith({ graceful: true, timeout: 10000 });
    expect(manager.isRunning()).toBe(false);
  });

  test('stop() is safe when not started', async () => {
    const manager = new JobQueueManager();
    await manager.stop(); // should not throw
    expect(mockBossInstance.stop).not.toHaveBeenCalled();
  });

  test('getInstance() throws when not started', () => {
    const manager = new JobQueueManager();
    expect(() => manager.getInstance()).toThrow('JobQueue not started');
  });

  test('getInstance() returns pg-boss after start', async () => {
    const manager = new JobQueueManager();
    await manager.start();
    expect(manager.getInstance()).toBe(mockBossInstance);
  });

  test('registers error and monitor-states handlers', async () => {
    const manager = new JobQueueManager();
    await manager.start();

    expect(mockBossInstance.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(mockBossInstance.on).toHaveBeenCalledWith('monitor-states', expect.any(Function));
  });

  test('getStatus() returns empty when not started', async () => {
    const manager = new JobQueueManager();
    const status = await manager.getStatus();
    expect(status).toEqual({ running: false, queues: {} });
  });

  test('getStatus() returns queue sizes when started', async () => {
    mockBossInstance.getQueueSize.mockResolvedValue(5);
    const manager = new JobQueueManager();
    await manager.start();
    const status = await manager.getStatus();

    expect(status.running).toBe(true);
    expect(status.queues['enrich-video']).toEqual({ pending: 5 });
    expect(status.queues['batch-scan']).toEqual({ pending: 5 });
  });

  test('start() failure cleans up state', async () => {
    mockBossInstance.start.mockRejectedValueOnce(new Error('connection refused'));

    const manager = new JobQueueManager();
    await expect(manager.start()).rejects.toThrow('connection refused');

    expect(manager.isRunning()).toBe(false);
    expect(() => manager.getInstance()).toThrow('JobQueue not started');
  });
});

// ============================================================================
// Singleton Tests
// ============================================================================

describe('getJobQueue singleton', () => {
  test('returns same instance on repeated calls', () => {
    const a = getJobQueue();
    const b = getJobQueue();
    expect(a).toBe(b);
  });

  test('instance is a JobQueueManager', () => {
    const instance = getJobQueue();
    expect(instance).toBeInstanceOf(JobQueueManager);
  });
});

// ============================================================================
// Connection String Tests
// ============================================================================

describe('Connection String Handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('strips PgBouncer params from DATABASE_URL', async () => {
    // Override config mock for this test
    const configMod = require('../../../src/config');
    configMod.config.database.url =
      'postgresql://user:pass@host:6543/db?pgbouncer=true&connection_limit=1';
    configMod.config.database.directUrl = undefined;

    const manager = new JobQueueManager();
    await manager.start();

    const call = MockPgBoss.mock.calls[MockPgBoss.mock.calls.length - 1][0];
    expect(call.connectionString).not.toContain('pgbouncer');
    expect(call.connectionString).not.toContain('connection_limit');

    // Restore
    configMod.config.database.url = 'postgresql://postgres:pass@127.0.0.1:5432/postgres';
  });

  test('prefers DIRECT_URL over DATABASE_URL', async () => {
    const configMod = require('../../../src/config');
    configMod.config.database.url = 'postgresql://user:pass@host:6543/db?pgbouncer=true';
    configMod.config.database.directUrl = 'postgresql://user:pass@host:5432/db';

    const manager = new JobQueueManager();
    await manager.start();

    const call = MockPgBoss.mock.calls[MockPgBoss.mock.calls.length - 1][0];
    expect(call.connectionString).toContain(':5432');

    // Restore
    configMod.config.database.url = 'postgresql://postgres:pass@127.0.0.1:5432/postgres';
    configMod.config.database.directUrl = undefined;
  });

  test('throws on SQLite DATABASE_URL', async () => {
    const configMod = require('../../../src/config');
    configMod.config.database.url = 'file:./data/db.sqlite';
    configMod.config.database.directUrl = undefined;

    const manager = new JobQueueManager();
    await expect(manager.start()).rejects.toThrow('JobQueue requires PostgreSQL');

    // Restore
    configMod.config.database.url = 'postgresql://postgres:pass@127.0.0.1:5432/postgres';
  });
});
