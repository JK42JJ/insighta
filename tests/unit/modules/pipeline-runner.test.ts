/**
 * pipeline-runner — CP426 step2-skip regression test.
 *
 * Locks the invariant: when step2 is skipped intra-run (e.g., wizard-precompute
 * pre-populated recommendation_cache → checkDiscoverPreconditions returns
 * "recent discover within 5min window"), step3 MUST call
 * maybeAutoAddRecommendations, not shortcut into the "discover failed" branch.
 *
 * Prior to the fix, step3 condition read `run.step2_status` (a stale snapshot
 * captured at pipeline entry) instead of the intra-run state. A fresh run with
 * null step2_status snapshot satisfied `run.step2_status !== 'skipped'` even
 * though step2 had just been marked 'skipped' in the DB, causing step3 to
 * skip auto-add and leaving `user_video_states` empty (prod cards = 0 장).
 */

const mockFindUniqueRun = jest.fn();
const mockUpdateRun = jest.fn();
const mockFindFirstRecCache = jest.fn();
const mockFindFirstSkillConfig = jest.fn();
const mockFindUniqueSubscription = jest.fn();
const mockSkillExecute = jest.fn();
const mockEnsureEmbeddings = jest.fn();
const mockMaybeAutoAdd = jest.fn();
const mockCreateGen = jest.fn();

jest.mock('@/modules/database', () => ({
  getPrismaClient: () => ({
    mandala_pipeline_runs: {
      findUnique: mockFindUniqueRun,
      update: mockUpdateRun,
    },
    recommendation_cache: { findFirst: mockFindFirstRecCache },
    user_skill_config: { findFirst: mockFindFirstSkillConfig },
    user_subscriptions: { findUnique: mockFindUniqueSubscription },
  }),
}));

jest.mock('../../../src/modules/mandala/ensure-mandala-embeddings', () => ({
  ensureMandalaEmbeddings: mockEnsureEmbeddings,
}));

jest.mock('../../../src/modules/mandala/auto-add-recommendations', () => ({
  maybeAutoAddRecommendations: mockMaybeAutoAdd,
}));

jest.mock('@/modules/skills', () => ({
  skillRegistry: { execute: mockSkillExecute },
}));

jest.mock('@/modules/llm', () => ({
  createGenerationProvider: mockCreateGen,
}));

jest.mock('@/utils/logger', () => ({
  logger: {
    child: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

import { executePipelineRun } from '../../../src/modules/mandala/pipeline-runner';

const RUN_ID = '00000000-0000-0000-0000-000000000001';
const MANDALA_ID = '00000000-0000-0000-0000-000000000002';
const USER_ID = '00000000-0000-0000-0000-000000000003';

describe('executePipelineRun — CP426 step2-skip → auto-add invariant', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Fresh run snapshot: null step2_status — this is the case that triggered
    // the production bug. An intra-run skip updates the DB but not this value.
    mockFindUniqueRun.mockResolvedValueOnce({
      id: RUN_ID,
      mandala_id: MANDALA_ID,
      user_id: USER_ID,
      trigger: 'wizard',
      status: 'pending',
      step1_status: null,
      step2_status: null,
      step3_status: null,
    });
    // Final re-fetch for anyFailed calc.
    mockFindUniqueRun.mockResolvedValue({
      step1_status: 'completed',
      step2_status: 'skipped',
      step3_status: 'completed',
    });
    mockUpdateRun.mockResolvedValue({});
    mockEnsureEmbeddings.mockResolvedValue({ ok: true, finalCount: 8, embedMs: 50 });
    mockFindFirstSkillConfig.mockResolvedValue({ enabled: true });
    mockMaybeAutoAdd.mockResolvedValue({
      ok: true,
      rowsInserted: 10,
      rowsPreserved: 0,
      rowsDeleted: 0,
      cellsProcessed: 8,
    });
  });

  test('step2 skipped intra-run (rec_cache pre-populated) → step3 calls auto-add', async () => {
    // checkDiscoverPreconditions hits the 5min-window dedup gate.
    mockFindFirstRecCache.mockResolvedValueOnce({ id: 'rc-precomputed' });

    await executePipelineRun(RUN_ID);

    // Auto-add MUST be called. Before the fix, it was never called.
    expect(mockMaybeAutoAdd).toHaveBeenCalledTimes(1);
    expect(mockMaybeAutoAdd).toHaveBeenCalledWith(USER_ID, MANDALA_ID);

    // Skill registry MUST NOT be called — step2 was skipped.
    expect(mockSkillExecute).not.toHaveBeenCalled();

    // step2 was marked skipped.
    const step2SkipCall = mockUpdateRun.mock.calls.find(
      ([arg]: [{ data: Record<string, unknown> }]) => arg?.data?.['step2_status'] === 'skipped'
    );
    expect(step2SkipCall).toBeDefined();

    // step3 was completed (NOT "skipped / discover failed").
    const step3CompletedCall = mockUpdateRun.mock.calls.find(
      ([arg]: [{ data: Record<string, unknown> }]) => arg?.data?.['step3_status'] === 'completed'
    );
    expect(step3CompletedCall).toBeDefined();
    const step3SkipCall = mockUpdateRun.mock.calls.find(
      ([arg]: [{ data: Record<string, unknown> }]) =>
        arg?.data?.['step3_status'] === 'skipped' &&
        arg?.data?.['step3_error'] === 'discover failed'
    );
    expect(step3SkipCall).toBeUndefined();
  });

  test('step2 completed (skill success) → step3 calls auto-add (happy path unchanged)', async () => {
    mockFindFirstRecCache.mockResolvedValueOnce(null); // no precompute
    mockFindUniqueSubscription.mockResolvedValue({ tier: 'free' });
    mockCreateGen.mockResolvedValue({});
    mockSkillExecute.mockResolvedValue({
      success: true,
      data: { queries: [], cached: 17 },
    });

    await executePipelineRun(RUN_ID);

    expect(mockSkillExecute).toHaveBeenCalledTimes(1);
    expect(mockMaybeAutoAdd).toHaveBeenCalledTimes(1);

    const step2CompletedCall = mockUpdateRun.mock.calls.find(
      ([arg]: [{ data: Record<string, unknown> }]) => arg?.data?.['step2_status'] === 'completed'
    );
    expect(step2CompletedCall).toBeDefined();
  });

  test('step2 failed (skill returns success=false) → step3 skips with "discover failed"', async () => {
    mockFindFirstRecCache.mockResolvedValueOnce(null);
    mockFindUniqueSubscription.mockResolvedValue({ tier: 'free' });
    mockCreateGen.mockResolvedValue({});
    mockSkillExecute.mockResolvedValue({
      success: false,
      error: 'quota_exhausted',
      data: null,
    });

    await executePipelineRun(RUN_ID);

    // Auto-add MUST NOT run when step2 genuinely failed.
    expect(mockMaybeAutoAdd).not.toHaveBeenCalled();

    const step3SkipCall = mockUpdateRun.mock.calls.find(
      ([arg]: [{ data: Record<string, unknown> }]) =>
        arg?.data?.['step3_status'] === 'skipped' &&
        arg?.data?.['step3_error'] === 'discover failed'
    );
    expect(step3SkipCall).toBeDefined();
  });
});
