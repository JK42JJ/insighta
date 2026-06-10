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

// step3-success fire-and-forget dynamic imports — inert stubs so the suite
// never pulls the real queue modules (open-handle source) into the test run.
jest.mock('../../../src/modules/skills/rich-summary-trigger', () => ({
  enqueueRichSummaryForMandalaCards: jest.fn(async () => ({ enqueued: 0 })),
}));
jest.mock('../../../src/modules/relevance/relevance-backfill-trigger', () => ({
  enqueueRelevanceBackfillForMandala: jest.fn(async () => ({ enqueued: 0 })),
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

// ============================================================================
// Stale-13 re-pin (CP499+, 2026-06-10) — these contracts were originally
// pinned against the PRE-Phase-1 triggerMandalaPostCreationAsync (inline
// embeddings → opt-in gate → skillRegistry). Phase 1 moved the logic into
// executePipelineRun; the old mandala-post-creation suite kept asserting the
// trigger and silently became 13 always-failing tests — a dead regression
// guard over exactly this area. Fact-read classification: all 13 behaviours
// are ALIVE in pipeline-runner.ts → re-pin here, delete there.
// ============================================================================

describe('executePipelineRun — re-pinned post-creation contracts (stale-13)', () => {
  const freshRun = {
    id: RUN_ID,
    mandala_id: MANDALA_ID,
    user_id: USER_ID,
    trigger: 'wizard',
    status: 'pending',
    step1_status: null,
    step2_status: null,
    step3_status: null,
  };

  const stepCall = (field: string, value: unknown) =>
    mockUpdateRun.mock.calls.find(
      ([arg]: [{ data: Record<string, unknown> }]) => arg?.data?.[field] === value
    );

  beforeEach(() => {
    jest.clearAllMocks();
    mockFindUniqueRun.mockResolvedValueOnce(freshRun);
    // benign final re-fetch default; failure tests override with a 2nd Once
    mockFindUniqueRun.mockResolvedValue({
      step1_status: 'completed',
      step2_status: 'completed',
      step3_status: 'completed',
    });
    mockUpdateRun.mockResolvedValue({});
    mockEnsureEmbeddings.mockResolvedValue({ ok: true, finalCount: 8, embedMs: 10 });
    mockFindFirstRecCache.mockResolvedValue(null);
    mockFindFirstSkillConfig.mockResolvedValue({ enabled: true });
    mockFindUniqueSubscription.mockResolvedValue(null);
    mockCreateGen.mockResolvedValue({});
    mockSkillExecute.mockResolvedValue({ success: true, data: {} });
    mockMaybeAutoAdd.mockResolvedValue({ ok: true, rowsInserted: 0, rowsPreserved: 0 });
    delete process.env['VIDEO_DISCOVER_V2'];
    delete process.env['VIDEO_DISCOVER_V3'];
  });

  test('runs ensureMandalaEmbeddings BEFORE the opt-in gate is consulted', async () => {
    await executePipelineRun(RUN_ID);
    expect(mockEnsureEmbeddings).toHaveBeenCalled();
    expect(mockEnsureEmbeddings.mock.invocationCallOrder[0]!).toBeLessThan(
      mockFindFirstSkillConfig.mock.invocationCallOrder[0]!
    );
  });

  test('runs the embedding step with mandalaId only (no userId needed)', async () => {
    await executePipelineRun(RUN_ID);
    expect(mockEnsureEmbeddings).toHaveBeenCalledWith(MANDALA_ID);
  });

  test('SKIPS video-discover when embeddings report ok=false (short-circuit, partial)', async () => {
    mockEnsureEmbeddings.mockResolvedValue({ ok: false, reason: 'no level rows' });
    await executePipelineRun(RUN_ID);
    expect(mockSkillExecute).not.toHaveBeenCalled();
    expect(mockMaybeAutoAdd).not.toHaveBeenCalled();
    expect(stepCall('step2_status', 'skipped')).toBeDefined();
    expect(stepCall('step3_status', 'skipped')).toBeDefined();
    expect(stepCall('status', 'partial')).toBeDefined();
  });

  test('SKIPS video-discover when embeddings throw (short-circuit, swallowed)', async () => {
    mockEnsureEmbeddings.mockRejectedValue(new Error('ollama down'));
    await expect(executePipelineRun(RUN_ID)).resolves.toBeUndefined();
    expect(mockSkillExecute).not.toHaveBeenCalled();
    expect(stepCall('step1_status', 'failed')).toBeDefined();
  });

  test.each([
    ['alreadyPresent', { ok: true, finalCount: 8, alreadyPresent: true }],
    ['just generated', { ok: true, finalCount: 8, embedMs: 1200 }],
  ])('proceeds to video-discover when embeddings report ok=true (%s)', async (_label, result) => {
    mockEnsureEmbeddings.mockResolvedValue(result);
    await executePipelineRun(RUN_ID);
    expect(mockSkillExecute).toHaveBeenCalledTimes(1);
  });

  test('SKIPS discover on a recommendation_cache row within the 5min window', async () => {
    mockFindFirstRecCache.mockResolvedValue({ id: 'recent' });
    await executePipelineRun(RUN_ID);
    expect(mockSkillExecute).not.toHaveBeenCalled();
    expect(stepCall('step2_status', 'skipped')).toBeDefined();
  });

  test('PROCEEDS to discover when no recommendation_cache rows are newer than the window', async () => {
    mockFindFirstRecCache.mockResolvedValue(null);
    await executePipelineRun(RUN_ID);
    expect(mockSkillExecute).toHaveBeenCalledTimes(1);
  });

  test('skips silently when user_skill_config has no row', async () => {
    mockFindFirstSkillConfig.mockResolvedValue(null);
    await executePipelineRun(RUN_ID);
    expect(mockFindFirstSkillConfig).toHaveBeenCalledWith({
      where: { user_id: USER_ID, mandala_id: MANDALA_ID, skill_type: 'video_discover' },
      select: { enabled: true },
    });
    expect(mockSkillExecute).not.toHaveBeenCalled();
  });

  test('skips silently when video_discover is disabled (enabled=false)', async () => {
    mockFindFirstSkillConfig.mockResolvedValue({ enabled: false });
    await executePipelineRun(RUN_ID);
    expect(mockSkillExecute).not.toHaveBeenCalled();
    expect(stepCall('step2_status', 'skipped')).toBeDefined();
  });

  test('invokes skillRegistry with the hyphenated plugin id when enabled', async () => {
    await executePipelineRun(RUN_ID);
    const [skillId, ctx] = mockSkillExecute.mock.calls[0] as [string, Record<string, unknown>];
    expect(skillId).toBe('video-discover'); // env flags unset → v1 id
    expect(ctx['userId']).toBe(USER_ID);
    expect(ctx['mandalaId']).toBe(MANDALA_ID);
  });

  test('defaults tier to "free" when the user_subscriptions row is missing', async () => {
    mockFindUniqueSubscription.mockResolvedValue(null);
    await executePipelineRun(RUN_ID);
    const ctx = mockSkillExecute.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(ctx['tier']).toBe('free');
  });

  test('swallows plugin skip results (success=false): step2 failed, step3 skipped, no throw', async () => {
    mockSkillExecute.mockResolvedValue({ success: false, error: 'quota', data: {} });
    await expect(executePipelineRun(RUN_ID)).resolves.toBeUndefined();
    expect(stepCall('step2_status', 'failed')).toBeDefined();
    expect(stepCall('step3_status', 'skipped')).toBeDefined();
    expect(mockMaybeAutoAdd).not.toHaveBeenCalled();
  });

  test('swallows skillRegistry.execute() throws (plugin bug) — no throw, step2 failed', async () => {
    mockSkillExecute.mockRejectedValue(new Error('plugin crash'));
    await expect(executePipelineRun(RUN_ID)).resolves.toBeUndefined();
    expect(stepCall('step2_status', 'failed')).toBeDefined();
  });
});
