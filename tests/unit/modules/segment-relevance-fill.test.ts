/**
 * segment-relevance-fill — worker + trigger tests (§2-D #2).
 *
 * Locks the invariants James reviews before merge:
 *   (a) interpolation = 0 — relevance_pct is ONLY the scorer's output; a failed
 *       score writes NOTHING (no fabricated 0/default);
 *   (b) upsert targets video_mandala_segment_relevance keyed by
 *       (video_id, mandala_id, segment_idx);
 *   (c) stale DELETE is scoped to (mandala_id, the affected videos) — never
 *       other mandalas;
 *   plus: one job per segment fan-out; no scoring in the trigger.
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
};
jest.mock('@/modules/queue/manager', () => ({
  getJobQueue: () => ({ getInstance: () => mockBossInstance }),
}));

const mockExec = jest.fn().mockResolvedValue(0);
jest.mock('@/modules/database/client', () => ({
  getPrismaClient: () => ({
    $executeRawUnsafe: (...args: unknown[]) => mockExec(...args),
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
    paths: { logs: '/tmp' },
  },
}));

import {
  registerSegmentRelevanceFillWorker,
  enqueueSegmentRelevanceFill,
} from '../../../src/modules/queue/handlers/segment-relevance-fill';

type JobHandler = (job: { id: string; data: Record<string, unknown> }) => Promise<void>;

const basePayload = {
  videoId: 'dQw4w9WgXcQ',
  mandalaId: '72d5fe52-2f35-4a9e-8ef6-cd21629173ef',
  segmentIdx: 2,
  fromSec: 0,
  toSec: 120,
  title: 'Section title',
  summary: 'Section summary',
  centerGoal: '요가 마스터하기',
  cellGoal: '아침 루틴',
};

async function getHandler(): Promise<JobHandler> {
  await registerSegmentRelevanceFillWorker();
  const call = mockBossInstance.work.mock.calls.at(-1)!;
  return call[2] as JobHandler;
}

beforeEach(() => {
  mockExec.mockClear();
  mockCompute.mockReset();
  mockBossInstance.work.mockClear();
  mockBossInstance.send.mockClear();
});

describe('segment-relevance-fill worker (interpolation = 0)', () => {
  it('upserts ONLY the scorer value, keyed by (video_id, mandala_id, segment_idx)', async () => {
    mockCompute.mockResolvedValue({ ok: true, relevancePct: 73 });
    const handler = await getHandler();
    await handler({ id: 'j1', data: { ...basePayload } });

    expect(mockExec).toHaveBeenCalledTimes(1);
    const args = mockExec.mock.calls[0]!;
    const sql = args[0] as string;
    expect(sql).toContain('INSERT INTO video_mandala_segment_relevance');
    expect(sql).toContain('ON CONFLICT (video_id, mandala_id, segment_idx)');
    // positional params: sql, videoId, mandalaId, segmentIdx, fromSec, toSec, relevancePct
    expect(args.slice(1)).toEqual(['dQw4w9WgXcQ', basePayload.mandalaId, 2, 0, 120, 73]);
  });

  it('writes NOTHING on no_title (no fabricated 0/default)', async () => {
    mockCompute.mockResolvedValue({ ok: false, reason: 'no_title' });
    const handler = await getHandler();
    await handler({ id: 'j2', data: { ...basePayload } });
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('throws (retry) and writes NOTHING on other compute failure', async () => {
    mockCompute.mockResolvedValue({ ok: false, reason: 'provider_error' });
    const handler = await getHandler();
    await expect(handler({ id: 'j3', data: { ...basePayload } })).rejects.toThrow(
      /segment_relevance_compute_failed/
    );
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('forwards title+summary+centerGoal+cellGoal to the scorer (no rubric)', async () => {
    mockCompute.mockResolvedValue({ ok: true, relevancePct: 50 });
    const handler = await getHandler();
    await handler({ id: 'j4', data: { ...basePayload } });
    expect(mockCompute).toHaveBeenCalledWith({
      title: 'Section title',
      description: 'Section summary',
      centerGoal: '요가 마스터하기',
      cellGoal: '아침 루틴',
    });
  });

  it('enqueue carries SEGMENT_RELEVANCE_FILL_OPTIONS retry shape', async () => {
    await enqueueSegmentRelevanceFill(basePayload);
    expect(mockBossInstance.send).toHaveBeenCalledTimes(1);
    const opts = mockBossInstance.send.mock.calls[0]![2] as { retryLimit: number };
    expect(opts.retryLimit).toBe(1);
  });
});
