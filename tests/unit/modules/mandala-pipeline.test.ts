/**
 * mandala-pipeline worker + watchdog tests — P0 durability (2026-07-10).
 *
 * Locks the guarantee the fire-and-forget setImmediate pipeline lacked:
 *   - executePipelineRun throws ⇒ THROW (pg-boss retry engages);
 *   - success ⇒ createPipelineRun + executePipelineRun both run, no throw;
 *   - malformed payload (no mandalaId/userId) ⇒ drop without throw or run;
 *   - enqueue carries MANDALA_PIPELINE_OPTIONS + per-mandala singletonKey;
 *   - watchdog no-ops when the durable flag is off (legacy behavior);
 *   - watchdog re-enqueues each stale status=running run when the flag is on.
 */

const mockBossInstance = {
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
  work: jest.fn().mockResolvedValue('worker-id'),
  send: jest.fn().mockResolvedValue('job-123'),
  schedule: jest.fn().mockResolvedValue(undefined),
  getQueueSize: jest.fn().mockResolvedValue(0),
};
jest.mock('pg-boss', () => jest.fn().mockImplementation(() => mockBossInstance));

const mockCreateRun = jest.fn();
const mockExecuteRun = jest.fn();
jest.mock('@/modules/mandala/pipeline-runner', () => ({
  createPipelineRun: (...args: unknown[]) => mockCreateRun(...args),
  executePipelineRun: (...args: unknown[]) => mockExecuteRun(...args),
}));

const mockIsDurable = jest.fn();
jest.mock('@/config/pipeline-durable', () => ({
  isPipelineDurableEnabled: () => mockIsDurable(),
}));

const mockQueryRaw = jest.fn();
jest.mock('@/modules/database/client', () => ({
  getPrismaClient: () => ({ $queryRawUnsafe: (...args: unknown[]) => mockQueryRaw(...args) }),
}));

jest.mock('@/config/index', () => ({
  config: {
    database: { url: 'postgresql://postgres:pass@127.0.0.1:5432/postgres', directUrl: undefined },
    app: { isDevelopment: true, isProduction: false, isTest: true },
  },
}));

jest.mock('@/utils/logger', () => ({
  logger: {
    child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import type PgBoss from 'pg-boss';
import { getJobQueue } from '@/modules/queue/manager';
import {
  handleMandalaPipeline,
  handleMandalaPipelineWatchdog,
  enqueueMandalaPipeline,
} from '@/modules/queue/handlers/mandala-pipeline';
import { JOB_NAMES, MANDALA_PIPELINE_OPTIONS } from '@/modules/queue/types';
import type { MandalaPipelinePayload } from '@/modules/queue/types';

beforeAll(async () => {
  await getJobQueue().start();
});
afterAll(async () => {
  await getJobQueue().stop();
});

const job = (data: Partial<MandalaPipelinePayload>): PgBoss.Job<MandalaPipelinePayload> =>
  ({ id: 'job-1', data }) as PgBoss.Job<MandalaPipelinePayload>;

beforeEach(() => {
  mockCreateRun.mockResolvedValue('run-1');
  mockExecuteRun.mockResolvedValue(undefined);
});
afterEach(() => jest.clearAllMocks());

describe('handleMandalaPipeline (durability guarantee)', () => {
  it('success → creates run then executes, no throw', async () => {
    await expect(
      handleMandalaPipeline(job({ mandalaId: 'm-1', userId: 'u-1', trigger: 'wizard' }))
    ).resolves.toBeUndefined();
    expect(mockCreateRun).toHaveBeenCalledWith('m-1', 'u-1', 'wizard');
    expect(mockExecuteRun).toHaveBeenCalledWith('run-1');
  });

  it('executePipelineRun throws → rethrows so pg-boss retries', async () => {
    mockExecuteRun.mockRejectedValue(new Error('embedding timeout'));
    await expect(handleMandalaPipeline(job({ mandalaId: 'm-2', userId: 'u-2' }))).rejects.toThrow(
      /embedding timeout/
    );
  });

  it('malformed payload (no userId) is dropped without throw or run', async () => {
    await expect(handleMandalaPipeline(job({ mandalaId: 'm-3' }))).resolves.toBeUndefined();
    expect(mockCreateRun).not.toHaveBeenCalled();
  });
});

describe('enqueueMandalaPipeline', () => {
  it('sends with retry options + per-mandala singletonKey', async () => {
    const id = await enqueueMandalaPipeline({ mandalaId: 'm-4', userId: 'u-4', trigger: 'wizard' });
    expect(id).toBe('job-123');
    expect(mockBossInstance.send).toHaveBeenCalledWith(
      JOB_NAMES.MANDALA_PIPELINE,
      { mandalaId: 'm-4', userId: 'u-4', trigger: 'wizard' },
      expect.objectContaining({ ...MANDALA_PIPELINE_OPTIONS, singletonKey: 'mandala-pipeline-m-4' })
    );
  });
});

describe('handleMandalaPipelineWatchdog', () => {
  it('durable flag OFF → no query, no re-enqueue (legacy behavior)', async () => {
    mockIsDurable.mockReturnValue(false);
    await handleMandalaPipelineWatchdog();
    expect(mockQueryRaw).not.toHaveBeenCalled();
    expect(mockBossInstance.send).not.toHaveBeenCalled();
  });

  it('durable flag ON → re-enqueues each stale running run', async () => {
    mockIsDurable.mockReturnValue(true);
    mockQueryRaw.mockResolvedValue([
      { mandala_id: 'm-a', user_id: 'u-a', trigger: 'wizard' },
      { mandala_id: 'm-b', user_id: 'u-b', trigger: null },
    ]);
    await handleMandalaPipelineWatchdog();
    expect(mockBossInstance.send).toHaveBeenCalledTimes(2);
    expect(mockBossInstance.send).toHaveBeenCalledWith(
      JOB_NAMES.MANDALA_PIPELINE,
      { mandalaId: 'm-b', userId: 'u-b', trigger: 'watchdog' },
      expect.objectContaining({ singletonKey: 'mandala-pipeline-m-b' })
    );
  });

  it('durable flag ON, no stale runs → nothing re-enqueued', async () => {
    mockIsDurable.mockReturnValue(true);
    mockQueryRaw.mockResolvedValue([]);
    await handleMandalaPipelineWatchdog();
    expect(mockBossInstance.send).not.toHaveBeenCalled();
  });
});
