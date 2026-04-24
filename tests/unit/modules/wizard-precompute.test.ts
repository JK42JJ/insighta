/**
 * Wizard Precompute Pipeline — unit tests (CP424.2).
 *
 * Cross-checks the lifecycle + miss semantics that matter end-to-end:
 *   - Feature flag OFF → startPrecompute + consumePrecompute both no-op.
 *   - startPrecompute happy path: pending → running → done (discover_result persisted).
 *   - startPrecompute failure path: pending → running → failed (error_message persisted).
 *   - consumePrecompute miss semantics: each enum value triggers fallback.
 *   - consumePrecompute happy path: done row → recommendation_cache rows + notify + consumed.
 *   - Goal mismatch → miss (not consumed, fallback triggers).
 *   - User mismatch → miss + warning log.
 *
 * Shallow mocks: Prisma client + runDiscoverEphemeral + notifyCardAdded. No
 * real DB, no real YouTube calls. Tests focus on orchestration correctness —
 * invariants that a prod outage would violate.
 */

const mockFindUnique = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockExecuteRaw = jest.fn();
const mockRunDiscoverEphemeral = jest.fn();
const mockNotifyCardAdded = jest.fn();
const mockLoadConfig = jest.fn();

jest.mock('@/modules/database/client', () => ({
  getPrismaClient: () => ({
    mandala_wizard_precompute: {
      findUnique: mockFindUnique,
      create: mockCreate,
      update: mockUpdate,
    },
    $executeRaw: mockExecuteRaw,
  }),
}));

jest.mock('@prisma/client', () => ({
  Prisma: {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
  },
}));

jest.mock('@/skills/plugins/video-discover/v3/executor', () => ({
  runDiscoverEphemeral: mockRunDiscoverEphemeral,
}));

jest.mock('@/modules/recommendations/publisher', () => ({
  notifyCardAdded: mockNotifyCardAdded,
}));

jest.mock('@/config/wizard-precompute', () => ({
  loadWizardPrecomputeConfig: mockLoadConfig,
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

import { startPrecompute, consumePrecompute } from '../../../src/modules/mandala/wizard-precompute';

const SESSION = 'aaaaaaaa-1111-2222-3333-cccccccccccc';
const USER = 'bbbbbbbb-1111-2222-3333-dddddddddddd';
const MANDALA = 'ccccccc1-1111-2222-3333-eeeeeeeeeeee';

const SUB_GOALS = Array.from({ length: 8 }, (_, i) => `sub_${i}`);

function makeSlot(
  cellIndex: number,
  videoId: string
): {
  videoId: string;
  title: string;
  description: string | null;
  channelName: string | null;
  channelId: string | null;
  thumbnail: string | null;
  viewCount: number | null;
  likeCount: number | null;
  durationSec: number | null;
  publishedAt: Date | null;
  cellIndex: number;
  score: number;
  tier: 'cache' | 'realtime';
} {
  return {
    videoId,
    title: `Title ${videoId}`,
    description: null,
    channelName: 'ch',
    channelId: null,
    thumbnail: 'https://thumb',
    viewCount: 1000,
    likeCount: null,
    durationSec: 600,
    publishedAt: new Date('2026-01-01T00:00:00Z'),
    cellIndex,
    score: 0.5 + cellIndex * 0.01,
    tier: 'realtime',
  };
}

describe('wizard-precompute — startPrecompute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadConfig.mockReturnValue({ enabled: true });
  });

  test('flag OFF → no DB writes, no discover call', async () => {
    mockLoadConfig.mockReturnValue({ enabled: false });
    await startPrecompute({
      sessionId: SESSION,
      userId: USER,
      goal: 'g',
      language: 'ko',
      focusTags: [],
      subGoals: SUB_GOALS,
    });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockRunDiscoverEphemeral).not.toHaveBeenCalled();
  });

  test('happy path: pending → running → done (result persisted)', async () => {
    const discoverResult = {
      slots: [makeSlot(0, 'v1'), makeSlot(1, 'v2')],
      queriesUsed: 3,
      tier1_matches: 0 as const,
      tier2_matches: 2,
      duration_ms: 1234,
      debug: { timing: { totalMs: 1234 } },
    };
    mockCreate.mockResolvedValueOnce({});
    mockUpdate.mockResolvedValue({});
    mockRunDiscoverEphemeral.mockResolvedValueOnce(discoverResult);

    await startPrecompute({
      sessionId: SESSION,
      userId: USER,
      goal: 'g',
      language: 'ko',
      focusTags: ['t1'],
      targetLevel: 'standard',
      subGoals: SUB_GOALS,
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0]![0].data).toMatchObject({
      session_id: SESSION,
      user_id: USER,
      status: 'pending',
    });
    // Two updates: running → done
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(mockUpdate.mock.calls[0]![0].data).toMatchObject({ status: 'running' });
    expect(mockUpdate.mock.calls[1]![0].data).toMatchObject({ status: 'done' });
    expect(mockUpdate.mock.calls[1]![0].data.discover_result).toBe(discoverResult);
  });

  test('discover failure → status=failed + error_message', async () => {
    mockCreate.mockResolvedValueOnce({});
    mockUpdate.mockResolvedValue({});
    mockRunDiscoverEphemeral.mockRejectedValueOnce(new Error('youtube quota'));

    await startPrecompute({
      sessionId: SESSION,
      userId: USER,
      goal: 'g',
      language: 'ko',
      focusTags: [],
      subGoals: SUB_GOALS,
    });

    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(mockUpdate.mock.calls[1]![0].data).toMatchObject({ status: 'failed' });
    expect(mockUpdate.mock.calls[1]![0].data.error_message).toContain('youtube quota');
  });

  test('duplicate PK on create → swallow (log + return)', async () => {
    mockCreate.mockRejectedValueOnce(new Error('duplicate key'));
    await startPrecompute({
      sessionId: SESSION,
      userId: USER,
      goal: 'g',
      language: 'ko',
      focusTags: [],
      subGoals: SUB_GOALS,
    });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockRunDiscoverEphemeral).not.toHaveBeenCalled();
  });
});

describe('wizard-precompute — consumePrecompute', () => {
  const FUTURE = new Date(Date.now() + 5 * 60_000);
  const PAST = new Date(Date.now() - 60_000);

  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadConfig.mockReturnValue({ enabled: true });
    mockUpdate.mockResolvedValue({});
    mockExecuteRaw.mockResolvedValue(1);
  });

  test('flag OFF → reason=disabled, consumed=false', async () => {
    mockLoadConfig.mockReturnValue({ enabled: false });
    const r = await consumePrecompute({
      sessionId: SESSION,
      userId: USER,
      mandalaId: MANDALA,
      centerGoal: 'g',
    });
    expect(r).toEqual({ consumed: false, reason: 'disabled' });
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  test('no session_id → reason=no-session-id', async () => {
    const r = await consumePrecompute({
      sessionId: '',
      userId: USER,
      mandalaId: MANDALA,
      centerGoal: 'g',
    });
    expect(r.consumed).toBe(false);
    expect(r.reason).toBe('no-session-id');
  });

  test('row not found → reason=not-found', async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    const r = await consumePrecompute({
      sessionId: SESSION,
      userId: USER,
      mandalaId: MANDALA,
      centerGoal: 'g',
    });
    expect(r.consumed).toBe(false);
    expect(r.reason).toBe('not-found');
  });

  test('wrong user → reason=wrong-user (no rec_cache writes)', async () => {
    mockFindUnique.mockResolvedValueOnce({
      session_id: SESSION,
      user_id: 'other-user',
      goal: 'g',
      status: 'done',
      expires_at: FUTURE,
      discover_result: { slots: [makeSlot(0, 'v1')] },
    });
    const r = await consumePrecompute({
      sessionId: SESSION,
      userId: USER,
      mandalaId: MANDALA,
      centerGoal: 'g',
    });
    expect(r.consumed).toBe(false);
    expect(r.reason).toBe('wrong-user');
    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });

  test('status=running throughout budget → miss (not-done) after poll timeout', async () => {
    // Always returns running — simulate precompute that doesn't finish in 5s.
    mockFindUnique.mockResolvedValue({
      session_id: SESSION,
      user_id: USER,
      goal: 'g',
      status: 'running',
      expires_at: FUTURE,
      discover_result: null,
    });
    const t0 = Date.now();
    const r = await consumePrecompute({
      sessionId: SESSION,
      userId: USER,
      mandalaId: MANDALA,
      centerGoal: 'g',
    });
    const elapsed = Date.now() - t0;
    expect(r.consumed).toBe(false);
    expect(r.reason).toBe('not-done');
    // Should have polled for close to 5s before giving up.
    expect(elapsed).toBeGreaterThanOrEqual(4500);
    expect(elapsed).toBeLessThan(7000);
  }, 15_000);

  test('status=running → done within budget → consume succeeds', async () => {
    // First read: running. Subsequent reads: done.
    mockFindUnique
      .mockResolvedValueOnce({
        session_id: SESSION,
        user_id: USER,
        goal: 'g',
        status: 'running',
        expires_at: FUTURE,
        discover_result: null,
      })
      .mockResolvedValue({
        session_id: SESSION,
        user_id: USER,
        goal: 'g',
        status: 'done',
        expires_at: FUTURE,
        discover_result: { slots: [makeSlot(0, 'v1')] },
      });
    const r = await consumePrecompute({
      sessionId: SESSION,
      userId: USER,
      mandalaId: MANDALA,
      centerGoal: 'g',
    });
    expect(r.consumed).toBe(true);
    expect(r.cardsInserted).toBe(1);
    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
  }, 15_000);

  test('status=failed → reason=not-done (no poll, immediate miss)', async () => {
    mockFindUnique.mockResolvedValueOnce({
      session_id: SESSION,
      user_id: USER,
      goal: 'g',
      status: 'failed',
      expires_at: FUTURE,
      discover_result: null,
    });
    const t0 = Date.now();
    const r = await consumePrecompute({
      sessionId: SESSION,
      userId: USER,
      mandalaId: MANDALA,
      centerGoal: 'g',
    });
    const elapsed = Date.now() - t0;
    expect(r.consumed).toBe(false);
    expect(r.reason).toBe('not-done');
    // Failed should NOT trigger poll — returns fast.
    expect(elapsed).toBeLessThan(500);
  });

  test('expired → reason=expired', async () => {
    mockFindUnique.mockResolvedValueOnce({
      session_id: SESSION,
      user_id: USER,
      goal: 'g',
      status: 'done',
      expires_at: PAST,
      discover_result: { slots: [makeSlot(0, 'v1')] },
    });
    const r = await consumePrecompute({
      sessionId: SESSION,
      userId: USER,
      mandalaId: MANDALA,
      centerGoal: 'g',
    });
    expect(r.consumed).toBe(false);
    expect(r.reason).toBe('expired');
    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });

  test('goal mismatch → reason=goal-mismatch (no writes)', async () => {
    mockFindUnique.mockResolvedValueOnce({
      session_id: SESSION,
      user_id: USER,
      goal: '원래 목표',
      status: 'done',
      expires_at: FUTURE,
      discover_result: { slots: [makeSlot(0, 'v1')] },
    });
    const r = await consumePrecompute({
      sessionId: SESSION,
      userId: USER,
      mandalaId: MANDALA,
      centerGoal: '다른 목표',
    });
    expect(r.consumed).toBe(false);
    expect(r.reason).toBe('goal-mismatch');
    expect(mockExecuteRaw).not.toHaveBeenCalled();
    expect(mockNotifyCardAdded).not.toHaveBeenCalled();
  });

  test('empty slots → reason=empty-slots + still marks consumed (no retry)', async () => {
    mockFindUnique.mockResolvedValueOnce({
      session_id: SESSION,
      user_id: USER,
      goal: 'g',
      status: 'done',
      expires_at: FUTURE,
      discover_result: { slots: [] },
    });
    const r = await consumePrecompute({
      sessionId: SESSION,
      userId: USER,
      mandalaId: MANDALA,
      centerGoal: 'g',
    });
    expect(r.consumed).toBe(false);
    expect(r.reason).toBe('empty-slots');
    // Marked consumed so we don't retry on the next save.
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0]![0].data).toMatchObject({ status: 'consumed' });
  });

  test('happy path: done + match → INSERT rec_cache + notifyCardAdded per slot + consumed', async () => {
    const slots = [makeSlot(0, 'v1'), makeSlot(1, 'v2'), makeSlot(3, 'v3')];
    mockFindUnique.mockResolvedValueOnce({
      session_id: SESSION,
      user_id: USER,
      goal: 'g',
      status: 'done',
      expires_at: FUTURE,
      discover_result: { slots },
    });

    const r = await consumePrecompute({
      sessionId: SESSION,
      userId: USER,
      mandalaId: MANDALA,
      centerGoal: 'g',
    });

    expect(r.consumed).toBe(true);
    expect(r.cardsInserted).toBe(3);
    expect(r.slotsCount).toBe(3);
    expect(mockExecuteRaw).toHaveBeenCalledTimes(3);
    expect(mockNotifyCardAdded).toHaveBeenCalledTimes(3);
    // Final update → status=consumed with consumed_mandala_id + consumed_at
    const lastUpdate = mockUpdate.mock.calls[mockUpdate.mock.calls.length - 1]![0];
    expect(lastUpdate.data.status).toBe('consumed');
    expect(lastUpdate.data.consumed_mandala_id).toBe(MANDALA);
    expect(lastUpdate.data.consumed_at).toBeInstanceOf(Date);
  });

  test('case-insensitive + trimmed goal match (resilient to minor client edits)', async () => {
    mockFindUnique.mockResolvedValueOnce({
      session_id: SESSION,
      user_id: USER,
      goal: '  영어 회화 실력 향상  ',
      status: 'done',
      expires_at: FUTURE,
      discover_result: { slots: [makeSlot(0, 'v1')] },
    });
    const r = await consumePrecompute({
      sessionId: SESSION,
      userId: USER,
      mandalaId: MANDALA,
      centerGoal: '영어 회화 실력 향상',
    });
    expect(r.consumed).toBe(true);
  });
});
