/**
 * enrich-relevance-quick worker tests — CP498 PR3b.
 *
 * Locks the worker invariants:
 *   - persists keyed by ROW PK (where:{id:rowId}) to the table named in the
 *     payload — NEVER by video_id (relation-not-attribute);
 *   - no_title ⇒ skip (no DB write, no throw);
 *   - other compute failures ⇒ throw (pg-boss retries once);
 *   - registration uses richSummaryWorkOptions(N) (real concurrency, PR2);
 *   - enqueue carries RELEVANCE_QUICK_RETRY_OPTIONS.
 */

// ============================================================================
// Mocks (before imports)
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

jest.mock('pg-boss', () => jest.fn().mockImplementation(() => mockBossInstance));

const mockUvsUpdate = jest.fn().mockResolvedValue({});
const mockUlcUpdate = jest.fn().mockResolvedValue({});
jest.mock('@/modules/database/client', () => ({
  getPrismaClient: () => ({
    userVideoState: { update: mockUvsUpdate },
    user_local_cards: { update: mockUlcUpdate },
  }),
}));

const mockCompute = jest.fn();
jest.mock('@/modules/relevance/compute-card-relevance', () => ({
  computeCardRelevance: (...args: unknown[]) => mockCompute(...args),
}));

jest.mock('@/config/index', () => ({
  config: {
    database: { url: 'postgresql://postgres:pass@127.0.0.1:5432/postgres', directUrl: undefined },
    app: { isDevelopment: true, isProduction: false, isTest: true },
    queue: { relevanceBackfillConcurrency: 4 },
  },
}));

jest.mock('@/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { getJobQueue } from '../../../src/modules/queue/manager';
import {
  registerEnrichRelevanceQuickWorker,
  enqueueRelevanceQuick,
} from '../../../src/modules/queue/handlers/enrich-relevance-quick';
import {
  JOB_NAMES,
  RELEVANCE_QUICK_RETRY_OPTIONS,
  type RelevanceQuickPayload,
} from '../../../src/modules/queue/types';

type Handler = (job: { id: string; data: RelevanceQuickPayload }) => Promise<void>;

beforeAll(async () => {
  await getJobQueue().start();
});
afterAll(async () => {
  await getJobQueue().stop();
});
beforeEach(() => {
  jest.clearAllMocks();
});

/** Register once and return the captured pg-boss work handler. */
async function getHandler(): Promise<Handler> {
  await registerEnrichRelevanceQuickWorker();
  const call = mockBossInstance.work.mock.calls.find(
    (c) => c[0] === JOB_NAMES.ENRICH_RELEVANCE_QUICK
  );
  if (!call) throw new Error('worker not registered');
  return call[2] as Handler;
}

describe('registerEnrichRelevanceQuickWorker', () => {
  test('registers with richSummaryWorkOptions(N) — real concurrency, not inert', async () => {
    await registerEnrichRelevanceQuickWorker();
    expect(mockBossInstance.work).toHaveBeenCalledWith(
      JOB_NAMES.ENRICH_RELEVANCE_QUICK,
      { teamConcurrency: 4, teamSize: 4, teamRefill: true },
      expect.any(Function)
    );
  });
});

describe('handleEnrichRelevanceQuick', () => {
  test('uvs: writes relevance_pct to userVideoState by row id (never video_id)', async () => {
    mockCompute.mockResolvedValueOnce({ ok: true, relevancePct: 73 });
    const handler = await getHandler();

    await handler({
      id: 'j1',
      data: { table: 'uvs', rowId: 'row-uvs-1', title: 'T', centerGoal: 'G' },
    });

    expect(mockUvsUpdate).toHaveBeenCalledWith({
      where: { id: 'row-uvs-1' },
      data: expect.objectContaining({ relevance_pct: 73, relevance_at: expect.any(Date) }),
    });
    expect(mockUlcUpdate).not.toHaveBeenCalled();
    // guard: the update key is the row PK, not a video_id field
    expect(mockUvsUpdate.mock.calls[0][0].where).toEqual({ id: 'row-uvs-1' });
  });

  test('ulc: writes relevance_pct to user_local_cards by row id', async () => {
    mockCompute.mockResolvedValueOnce({ ok: true, relevancePct: 41 });
    const handler = await getHandler();

    await handler({
      id: 'j2',
      data: { table: 'ulc', rowId: 'row-ulc-1', title: 'T', description: 'D', centerGoal: 'G' },
    });

    expect(mockUlcUpdate).toHaveBeenCalledWith({
      where: { id: 'row-ulc-1' },
      data: expect.objectContaining({ relevance_pct: 41, relevance_at: expect.any(Date) }),
    });
    expect(mockUvsUpdate).not.toHaveBeenCalled();
  });

  test('no_title ⇒ skip: no DB write, no throw', async () => {
    mockCompute.mockResolvedValueOnce({ ok: false, reason: 'no_title' });
    const handler = await getHandler();

    await expect(
      handler({ id: 'j3', data: { table: 'uvs', rowId: 'row-x', title: '', centerGoal: 'G' } })
    ).resolves.toBeUndefined();

    expect(mockUvsUpdate).not.toHaveBeenCalled();
    expect(mockUlcUpdate).not.toHaveBeenCalled();
  });

  test('provider/validation failure ⇒ throws (pg-boss retries once)', async () => {
    mockCompute.mockResolvedValueOnce({ ok: false, reason: 'provider_error: boom' });
    const handler = await getHandler();

    await expect(
      handler({ id: 'j4', data: { table: 'uvs', rowId: 'row-y', title: 'T', centerGoal: 'G' } })
    ).rejects.toThrow(/relevance_compute_failed/);
    expect(mockUvsUpdate).not.toHaveBeenCalled();
  });
});

describe('enqueueRelevanceQuick', () => {
  test('sends with RELEVANCE_QUICK_RETRY_OPTIONS', async () => {
    const payload: RelevanceQuickPayload = {
      table: 'uvs',
      rowId: 'r',
      title: 'T',
      centerGoal: 'G',
    };
    const id = await enqueueRelevanceQuick(payload);

    expect(id).toBe('job-123');
    expect(mockBossInstance.send).toHaveBeenCalledWith(
      JOB_NAMES.ENRICH_RELEVANCE_QUICK,
      payload,
      expect.objectContaining({
        retryLimit: RELEVANCE_QUICK_RETRY_OPTIONS.retryLimit,
        expireInMinutes: RELEVANCE_QUICK_RETRY_OPTIONS.expireInMinutes,
      })
    );
  });

  test('returns null when send fails', async () => {
    mockBossInstance.send.mockResolvedValueOnce(null);
    const result = await enqueueRelevanceQuick({
      table: 'ulc',
      rowId: 'r',
      title: 'T',
      centerGoal: 'G',
    });
    expect(result).toBeNull();
  });
});
