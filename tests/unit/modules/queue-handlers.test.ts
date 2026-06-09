/**
 * Queue Handler Tests
 *
 * Tests for enrich-video and batch-scan handler registration + enqueue functions.
 * Handlers use pg-boss mocks — no real DB or network calls.
 */

// ============================================================================
// Mocks
// ============================================================================

const mockBossInstance = {
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
  work: jest.fn().mockResolvedValue('worker-id'),
  send: jest.fn().mockResolvedValue('job-123'),
  schedule: jest.fn().mockResolvedValue(undefined),
  getQueueSize: jest.fn().mockResolvedValue(0),
};

jest.mock('pg-boss', () => {
  return jest.fn().mockImplementation(() => mockBossInstance);
});

jest.mock('../../../src/config', () => ({
  config: {
    database: {
      url: 'postgresql://postgres:pass@127.0.0.1:5432/postgres',
      directUrl: undefined,
    },
    app: { isDevelopment: true, isProduction: false, isTest: true },
    // CP498: enrich-rich-summary (PR2) + enrich-relevance-quick (PR3b) workers
    // read these at registration.
    queue: { richSummaryConcurrency: 4, relevanceBackfillConcurrency: 4 },
  },
}));

jest.mock('../../../src/utils/logger', () => {
  // call-logger.ts (imported transitively via the rich-summary handler chain
  // when queue/index.ts is required) calls logger.child() at module load.
  const base: Record<string, unknown> = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  base['child'] = jest.fn(() => base);
  return { logger: base };
});

jest.mock('../../../src/modules/database/client', () => ({
  getPrismaClient: jest.fn().mockReturnValue({
    $queryRaw: jest.fn().mockResolvedValue([{ count: BigInt(0) }]),
    $executeRaw: jest.fn().mockResolvedValue(1),
  }),
}));

jest.mock('../../../src/modules/ontology/enrichment', () => ({
  enrichVideo: jest.fn().mockResolvedValue({
    videoId: 'test-vid',
    summaryEn: 'Summary',
    tags: [],
    model: 'test',
    cached: false,
  }),
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { getJobQueue } from '../../../src/modules/queue/manager';
import {
  registerEnrichVideoWorker,
  enqueueEnrichVideo,
} from '../../../src/modules/queue/handlers/enrich-video';
import { registerBatchScanWorker } from '../../../src/modules/queue/handlers/batch-scan';
import { JOB_NAMES, QUEUE_CONFIG, ENRICH_RETRY_OPTIONS } from '../../../src/modules/queue/types';

// ============================================================================
// Setup: start JobQueue before tests
// ============================================================================

beforeAll(async () => {
  await getJobQueue().start();
});

afterAll(async () => {
  await getJobQueue().stop();
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ============================================================================
// enrich-video handler tests
// ============================================================================

describe('enrich-video handler', () => {
  test('registerEnrichVideoWorker registers worker with correct config', async () => {
    await registerEnrichVideoWorker();

    expect(mockBossInstance.work).toHaveBeenCalledWith(
      JOB_NAMES.ENRICH_VIDEO,
      { teamConcurrency: QUEUE_CONFIG.ENRICH_CONCURRENCY, teamSize: 1 },
      expect.any(Function)
    );
  });

  test('enqueueEnrichVideo sends job with correct payload', async () => {
    const payload = {
      videoId: 'abc123',
      title: 'Test Video',
      url: 'https://youtube.com/watch?v=abc123',
      source: 'batch' as const,
    };

    const jobId = await enqueueEnrichVideo(payload);

    expect(jobId).toBe('job-123');
    expect(mockBossInstance.send).toHaveBeenCalledWith(
      JOB_NAMES.ENRICH_VIDEO,
      payload,
      expect.objectContaining({
        retryLimit: ENRICH_RETRY_OPTIONS.retryLimit,
        retryDelay: ENRICH_RETRY_OPTIONS.retryDelay,
        retryBackoff: ENRICH_RETRY_OPTIONS.retryBackoff,
        expireInMinutes: ENRICH_RETRY_OPTIONS.expireInMinutes,
      })
    );
  });

  test('enqueueEnrichVideo allows option overrides', async () => {
    const payload = {
      videoId: 'xyz',
      title: 'Priority',
      url: 'https://youtube.com/watch?v=xyz',
      source: 'user' as const,
    };

    await enqueueEnrichVideo(payload, { priority: 10 });

    const sendCall = mockBossInstance.send.mock.calls[0];
    expect(sendCall[2]).toEqual(
      expect.objectContaining({
        priority: 10,
        retryLimit: ENRICH_RETRY_OPTIONS.retryLimit,
      })
    );
  });

  test('enqueueEnrichVideo returns null when send fails', async () => {
    mockBossInstance.send.mockResolvedValueOnce(null);

    const result = await enqueueEnrichVideo({
      videoId: 'fail',
      title: 'Fail',
      url: 'https://example.com',
      source: 'batch',
    });

    expect(result).toBeNull();
  });
});

// ============================================================================
// batch-scan handler tests
// ============================================================================

describe('batch-scan handler', () => {
  test('registerBatchScanWorker registers worker and schedule', async () => {
    await registerBatchScanWorker();

    // Worker registration
    expect(mockBossInstance.work).toHaveBeenCalledWith(JOB_NAMES.BATCH_SCAN, expect.any(Function));

    // Schedule registration
    expect(mockBossInstance.schedule).toHaveBeenCalledWith(
      JOB_NAMES.BATCH_SCAN,
      QUEUE_CONFIG.BATCH_SCAN_CRON,
      { limit: 3 }
    );
  });

  test('batch-scan schedule uses correct cron expression', async () => {
    await registerBatchScanWorker();

    const scheduleCall = mockBossInstance.schedule.mock.calls[0];
    expect(scheduleCall[1]).toBe('*/30 * * * *');
  });
});

// ============================================================================
// initJobQueue integration
// ============================================================================

describe('initJobQueue integration', () => {
  test('initJobQueue registers all workers', async () => {
    // Reset mocks to count fresh
    mockBossInstance.work.mockClear();
    mockBossInstance.schedule.mockClear();

    const { initJobQueue } = require('../../../src/modules/queue');
    await initJobQueue();

    // Should register all 6 workers: enrich-video, batch-scan,
    // enrich-rich-summary, batch-video-collector, pool-maintenance,
    // enrich-relevance-quick (CP498 PR3b).
    expect(mockBossInstance.work).toHaveBeenCalledTimes(6);

    // Should schedule batch-scan
    expect(mockBossInstance.schedule).toHaveBeenCalledTimes(1);
    expect(mockBossInstance.schedule).toHaveBeenCalledWith(
      'batch-scan',
      '*/30 * * * *',
      expect.any(Object)
    );
  });
});
