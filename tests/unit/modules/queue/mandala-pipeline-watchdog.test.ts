/**
 * CP512-incident regression (2026-07-10): the orphaned-run watchdog must
 * TERMINATE the stale runs it re-enqueues. Before this fix it left them at
 * status='running', so every 10-minute tick re-found and re-enqueued the same
 * stuck run forever (12 runs/hr observed on prod), each re-run firing the
 * auto-add delete-then-insert. The stale run that started the incident had NO
 * pg-boss job (a pre-flag-on fire-and-forget orphan stuck at step1), so the
 * watchdog must supersede by status+age alone — never by job existence.
 */
import { handleMandalaPipelineWatchdog } from '@/modules/queue/handlers/mandala-pipeline';

const mockQueryRaw = jest.fn();
const mockUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
const mockSend = jest.fn().mockResolvedValue('job-123');

jest.mock('@/modules/database/client', () => ({
  getPrismaClient: () => ({
    $queryRawUnsafe: (...args: unknown[]) => mockQueryRaw(...args),
    mandala_pipeline_runs: { updateMany: (...args: unknown[]) => mockUpdateMany(...args) },
  }),
}));
jest.mock('@/config/pipeline-durable', () => ({
  isPipelineDurableEnabled: () => true,
}));
jest.mock('@/modules/queue/manager', () => ({
  getJobQueue: () => ({ getInstance: () => ({ send: (...args: unknown[]) => mockSend(...args) }) }),
}));

describe('handleMandalaPipelineWatchdog — supersedes re-enqueued stale runs (CP512 loop fix)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('re-enqueues then marks the stale no-job orphan run superseded (breaks the loop)', async () => {
    // A run stuck at status=running with no pg-boss job — the exact incident case.
    mockQueryRaw.mockResolvedValue([
      { id: 'run-1', mandala_id: 'm-1', user_id: 'u-1', trigger: 'wizard' },
    ]);

    await handleMandalaPipelineWatchdog();

    // fresh replacement job enqueued...
    expect(mockSend).toHaveBeenCalledTimes(1);
    // ...and the stale run TERMINATED so the next tick can't re-enqueue it again.
    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['run-1'] }, status: 'running' },
      data: expect.objectContaining({ status: 'superseded' }),
    });
  });

  test('no stale runs → no enqueue, no supersede', async () => {
    mockQueryRaw.mockResolvedValue([]);
    await handleMandalaPipelineWatchdog();
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  test('enqueue failure → that run is NOT superseded (retried next tick)', async () => {
    mockQueryRaw.mockResolvedValue([
      { id: 'run-2', mandala_id: 'm-2', user_id: 'u-2', trigger: 'watchdog' },
    ]);
    mockSend.mockRejectedValueOnce(new Error('queue down'));
    await handleMandalaPipelineWatchdog();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });
});
