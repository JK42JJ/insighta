/**
 * mandala-post-creation — TRIGGER-level contracts only (CP499+ re-pin).
 *
 * History: this suite originally pinned the PRE-Phase-1 inline pipeline
 * (embeddings → opt-in gate → skillRegistry) against
 * triggerMandalaPostCreationAsync. Phase 1 moved that logic into
 * createPipelineRun/executePipelineRun and 13 tests became always-failing
 * stale assertions — a dead regression guard. Those 13 contracts are
 * re-pinned in `pipeline-runner.test.ts` ("stale-13 re-pin" block); this
 * file now pins ONLY what the trigger itself owns:
 *
 *   - fire-and-forget: returns void synchronously, every track's crash is
 *     swallowed (logged, never thrown)
 *   - dispatches the tracked pipeline (createPipelineRun → executePipelineRun)
 *   - W1a (CP499+): actions fill goes through the pg-boss enqueue —
 *     enqueue failure falls back to the inline fill so the absolute rule
 *     "missing actions ⇒ generate and store" always has an execution path
 *   - ontology edge sync fires (Lever A, CP416)
 */

const mockCreatePipelineRun = jest.fn();
const mockExecutePipelineRun = jest.fn();
const mockEnqueueActionsFill = jest.fn();
const mockInlineFill = jest.fn();
const mockSyncOntologyEdges = jest.fn();

jest.mock('../../../src/modules/mandala/pipeline-runner', () => ({
  createPipelineRun: mockCreatePipelineRun,
  executePipelineRun: mockExecutePipelineRun,
}));

jest.mock('@/modules/queue/handlers/mandala-actions-fill', () => ({
  enqueueMandalaActionsFill: mockEnqueueActionsFill,
}));

jest.mock('../../../src/modules/mandala/fill-missing-actions', () => ({
  fillMissingActionsIfNeeded: mockInlineFill,
}));

jest.mock('@/modules/ontology/sync-edges', () => ({
  syncOntologyEdges: mockSyncOntologyEdges,
}));

jest.mock('@/utils/logger', () => ({
  logger: {
    child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { triggerMandalaPostCreationAsync } from '../../../src/modules/mandala/mandala-post-creation';

const USER_ID = '00000000-0000-0000-0000-000000000001';
const MANDALA_ID = '00000000-0000-0000-0000-000000000002';

/** Flush setImmediate + microtask chains so fire-and-forget effects settle. */
async function flushAsync(): Promise<void> {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCreatePipelineRun.mockResolvedValue('run-id-1');
  mockExecutePipelineRun.mockResolvedValue(undefined);
  mockEnqueueActionsFill.mockResolvedValue('job-1');
  mockInlineFill.mockResolvedValue({ ok: true, action: 'filled', cellsFilled: 8 });
  mockSyncOntologyEdges.mockResolvedValue({
    ok: true,
    goalNodesUpserted: 0,
    topicNodesUpserted: 0,
    goalEdgesCreated: 0,
    topicEdgesCreated: 0,
    durationMs: 1,
  });
});

describe('triggerMandalaPostCreationAsync — trigger-level contracts', () => {
  it('returns synchronously (fire-and-forget, void not Promise)', () => {
    const ret = triggerMandalaPostCreationAsync(USER_ID, MANDALA_ID);
    expect(ret).toBeUndefined();
  });

  it('dispatches the tracked pipeline: createPipelineRun(mandala, user, trigger) → executePipelineRun(runId)', async () => {
    triggerMandalaPostCreationAsync(USER_ID, MANDALA_ID, 'wizard');
    await flushAsync();
    expect(mockCreatePipelineRun).toHaveBeenCalledWith(MANDALA_ID, USER_ID, 'wizard');
    expect(mockExecutePipelineRun).toHaveBeenCalledWith('run-id-1');
  });

  it('swallows a pipeline crash (createPipelineRun rejects) — no throw, other tracks still run', async () => {
    mockCreatePipelineRun.mockRejectedValue(new Error('DB down'));
    expect(() => triggerMandalaPostCreationAsync(USER_ID, MANDALA_ID)).not.toThrow();
    await flushAsync();
    expect(mockExecutePipelineRun).not.toHaveBeenCalled();
    // independent tracks unaffected by the pipeline crash
    expect(mockEnqueueActionsFill).toHaveBeenCalled();
    expect(mockSyncOntologyEdges).toHaveBeenCalledWith(MANDALA_ID);
  });

  it('W1a: enqueues the guaranteed actions fill with mandala/user/trigger (NO inline call on success)', async () => {
    triggerMandalaPostCreationAsync(USER_ID, MANDALA_ID, 'wizard');
    await flushAsync();
    expect(mockEnqueueActionsFill).toHaveBeenCalledWith({
      mandalaId: MANDALA_ID,
      userId: USER_ID,
      trigger: 'wizard',
    });
    expect(mockInlineFill).not.toHaveBeenCalled();
  });

  it('W1a: enqueue failure (queue down) falls back to the inline fill — the rule always has a path', async () => {
    mockEnqueueActionsFill.mockRejectedValue(new Error('pg-boss unavailable'));
    expect(() => triggerMandalaPostCreationAsync(USER_ID, MANDALA_ID)).not.toThrow();
    await flushAsync();
    expect(mockInlineFill).toHaveBeenCalledWith(MANDALA_ID);
  });

  it('swallows an actions-track crash (inline fallback also rejects) — no throw', async () => {
    mockEnqueueActionsFill.mockRejectedValue(new Error('pg-boss unavailable'));
    mockInlineFill.mockRejectedValue(new Error('LLM down'));
    expect(() => triggerMandalaPostCreationAsync(USER_ID, MANDALA_ID)).not.toThrow();
    await flushAsync();
  });

  it('fires ontology edge sync and swallows its crash', async () => {
    mockSyncOntologyEdges.mockRejectedValue(new Error('ontology down'));
    expect(() => triggerMandalaPostCreationAsync(USER_ID, MANDALA_ID)).not.toThrow();
    await flushAsync();
    expect(mockSyncOntologyEdges).toHaveBeenCalledWith(MANDALA_ID);
  });
});
