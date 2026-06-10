/**
 * mandala-actions-fill worker tests — W1' (CP499+).
 *
 * Locks the guarantee invariants that the old in-memory fire-and-forget
 * lacked:
 *   - 'failed' fill result ⇒ THROW (pg-boss retry path engages);
 *   - 'filled' / 'skipped-full' / 'skipped-not-found' ⇒ complete, no throw
 *     (idempotent re-runs are free; not-found is non-retryable);
 *   - malformed payload (no mandalaId) ⇒ drop without throw (retry can't fix);
 *   - enqueue carries MANDALA_ACTIONS_FILL_OPTIONS (retryLimit 3 + backoff).
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

const mockFill = jest.fn();
jest.mock('@/modules/mandala/fill-missing-actions', () => ({
  fillMissingActionsIfNeeded: (...args: unknown[]) => mockFill(...args),
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
  handleMandalaActionsFill,
  enqueueMandalaActionsFill,
} from '@/modules/queue/handlers/mandala-actions-fill';
import { JOB_NAMES, MANDALA_ACTIONS_FILL_OPTIONS } from '@/modules/queue/types';
import type { MandalaActionsFillPayload } from '@/modules/queue/types';

beforeAll(async () => {
  await getJobQueue().start();
});
afterAll(async () => {
  await getJobQueue().stop();
});

const job = (data: Partial<MandalaActionsFillPayload>): PgBoss.Job<MandalaActionsFillPayload> =>
  ({ id: 'job-1', data }) as PgBoss.Job<MandalaActionsFillPayload>;

afterEach(() => jest.clearAllMocks());

describe('handleMandalaActionsFill (W1′ guarantee invariants)', () => {
  it("fill 'failed' → throws so pg-boss retries (the old IIFE just logged)", async () => {
    mockFill.mockResolvedValue({ ok: false, action: 'failed', reason: 'LLM 503' });
    await expect(handleMandalaActionsFill(job({ mandalaId: 'm-1' }))).rejects.toThrow(/LLM 503/);
    expect(mockFill).toHaveBeenCalledWith('m-1');
  });

  it("'filled' and idempotent 'skipped-full' complete without throw", async () => {
    mockFill.mockResolvedValue({ ok: true, action: 'filled', cellsFilled: 8 });
    await expect(handleMandalaActionsFill(job({ mandalaId: 'm-2' }))).resolves.toBeUndefined();

    mockFill.mockResolvedValue({ ok: true, action: 'skipped-full' });
    await expect(handleMandalaActionsFill(job({ mandalaId: 'm-2' }))).resolves.toBeUndefined();
  });

  it("'skipped-not-found' does NOT retry (deleted mandala is permanent)", async () => {
    mockFill.mockResolvedValue({ ok: false, action: 'skipped-not-found' });
    await expect(handleMandalaActionsFill(job({ mandalaId: 'm-gone' }))).resolves.toBeUndefined();
  });

  it('malformed payload (no mandalaId) is dropped without throw or fill call', async () => {
    await expect(handleMandalaActionsFill(job({}))).resolves.toBeUndefined();
    expect(mockFill).not.toHaveBeenCalled();
  });
});

describe('enqueueMandalaActionsFill', () => {
  it('sends with the retry options (retryLimit 3 + backoff) on the right queue', async () => {
    const id = await enqueueMandalaActionsFill({ mandalaId: 'm-3', trigger: 'wizard' });
    expect(id).toBe('job-123');
    expect(mockBossInstance.send).toHaveBeenCalledWith(
      JOB_NAMES.MANDALA_ACTIONS_FILL,
      { mandalaId: 'm-3', trigger: 'wizard' },
      expect.objectContaining(MANDALA_ACTIONS_FILL_OPTIONS)
    );
  });
});
