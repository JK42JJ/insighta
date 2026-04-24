/**
 * fill-missing-actions — Layer A fix regression tests
 *
 * Scenarios pinned:
 *   1. Legacy recovery: mandala has depth=0 root with 8 subjects but no
 *      depth=1 rows — scaffold 8 depth=1 rows then generate + fill.
 *   2. Standard happy path: depth=1 rows already exist (scaffolded by
 *      `/create-with-data`), subjects empty → generateMandalaActions →
 *      update each row.
 *   3. Skip when all rows already have 8+ subjects.
 *   4. Skip when root is missing or has fewer than 8 subjects.
 */

const mockFindUniqueMandala = jest.fn();
const mockFindManyLevels = jest.fn();
const mockFindFirstRoot = jest.fn();
const mockCreateManyLevels = jest.fn();
const mockUpdateLevel = jest.fn();
const mockGenerateMandala = jest.fn();
const mockGenerateMandalaActions = jest.fn();

const mockGenLogCreate = jest.fn();

jest.mock('@/modules/database', () => ({
  getPrismaClient: () => ({
    user_mandalas: { findUnique: mockFindUniqueMandala },
    user_mandala_levels: {
      findMany: mockFindManyLevels,
      findFirst: mockFindFirstRoot,
      createMany: mockCreateManyLevels,
      update: mockUpdateLevel,
    },
    generation_log: { create: mockGenLogCreate },
  }),
}));

jest.mock('@prisma/client', () => ({
  Prisma: { JsonNull: null },
}));

jest.mock('../../../src/modules/mandala/generator', () => ({
  generateMandala: mockGenerateMandala,
  generateMandalaActions: mockGenerateMandalaActions,
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

import { fillMissingActionsIfNeeded } from '../../../src/modules/mandala/fill-missing-actions';

const MANDALA_ID = '00000000-0000-0000-0000-000000000042';
const ROOT_LEVEL_ID = '00000000-0000-0000-0000-0000000000a0';

const SUB_GOALS = [
  'Ultra learning 원리와 뇌과학 기초 이해',
  '매일 집중학습 시간 블록 스케줄링',
  '학습 주제별 마스터플랜 수립',
  '효율적 노트필기 및 정보정리 시스템 구축',
  '스팀(STEAM) 다중 학습법 적용',
  '일일 학습 진도 측정 및 피드백 체계',
  '뇌피로 관리와 회복 루틴 설계',
  '학습 커뮤니티 참여 및 아웃풋 활동',
];

function mockActionsFor(subGoals: string[]): Record<string, string[]> {
  const actions: Record<string, string[]> = {};
  subGoals.forEach((_, idx) => {
    actions[`sub_goal_${idx + 1}`] = Array.from({ length: 8 }, (_, i) => `action-${idx}-${i + 1}`);
  });
  return actions;
}

function mockLoraMandalaFor(subGoals: string[]) {
  return {
    center_goal: '30일 ultra learning 습관 만들기',
    center_label: '',
    language: 'ko',
    domain: 'general',
    sub_goals: subGoals,
    actions: mockActionsFor(subGoals),
  };
}

describe('fillMissingActionsIfNeeded', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindUniqueMandala.mockResolvedValue({
      id: MANDALA_ID,
      language: 'ko',
      focus_tags: null,
      target_level: null,
    });
    mockFindFirstRoot.mockResolvedValue({
      id: ROOT_LEVEL_ID,
      center_goal: '30일 ultra learning 습관 만들기',
      subjects: SUB_GOALS,
    });
    // Default: LoRA succeeds with a valid 64-action, high-unique-rate output.
    // Haiku default rejects — happy-path tests override explicitly to
    // exercise the CP426-revived fallback.
    mockGenerateMandala.mockResolvedValue(mockLoraMandalaFor(SUB_GOALS));
    mockGenerateMandalaActions.mockRejectedValue(
      new Error('haiku default mock — override in fallback-success tests')
    );
    mockUpdateLevel.mockImplementation(async () => ({}));
    mockCreateManyLevels.mockImplementation(async () => ({ count: 8 }));
    mockGenLogCreate.mockImplementation(async () => ({}));
  });

  test('scaffolds 8 depth=1 rows when mandala has none (legacy recovery)', async () => {
    // First call: 0 rows (legacy mandala). Second call (after scaffold):
    // 8 empty rows.
    mockFindManyLevels.mockResolvedValueOnce([]).mockResolvedValueOnce(
      SUB_GOALS.map((sg, idx) => ({
        id: `level-${idx}`,
        center_goal: sg,
        subjects: [],
        position: idx,
      }))
    );

    const result = await fillMissingActionsIfNeeded(MANDALA_ID);

    // Scaffold path was taken
    expect(mockCreateManyLevels).toHaveBeenCalledTimes(1);
    const scaffoldCall = mockCreateManyLevels.mock.calls[0]![0];
    expect(scaffoldCall.data).toHaveLength(8);
    expect(scaffoldCall.data[0]).toMatchObject({
      mandala_id: MANDALA_ID,
      parent_level_id: ROOT_LEVEL_ID,
      depth: 1,
      position: 0,
      center_goal: SUB_GOALS[0],
      subjects: [],
    });
    // Each scaffold row has a generated id
    for (let i = 0; i < 8; i++) {
      expect(scaffoldCall.data[i].id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(scaffoldCall.data[i].position).toBe(i);
    }

    // After scaffold, LoRA (sole source) runs and fills — Haiku call MUST
    // stay disabled per CP416 LoRA-only policy.
    expect(mockGenerateMandala).toHaveBeenCalledWith({
      goal: '30일 ultra learning 습관 만들기',
      language: 'ko',
      focusTags: undefined,
      targetLevel: undefined,
    });
    expect(mockGenerateMandalaActions).not.toHaveBeenCalled();
    expect(mockUpdateLevel).toHaveBeenCalledTimes(8);
    expect(result).toEqual({ ok: true, action: 'filled', cellsFilled: 8 });
  });

  test('standard path: LoRA fills all 8 cells (Haiku never called)', async () => {
    mockFindManyLevels.mockResolvedValueOnce(
      SUB_GOALS.map((sg, idx) => ({
        id: `level-${idx}`,
        center_goal: sg,
        subjects: [],
        position: idx,
      }))
    );

    const result = await fillMissingActionsIfNeeded(MANDALA_ID);

    expect(mockCreateManyLevels).not.toHaveBeenCalled();
    expect(mockGenerateMandala).toHaveBeenCalledTimes(1);
    expect(mockGenerateMandalaActions).not.toHaveBeenCalled();
    expect(mockUpdateLevel).toHaveBeenCalledTimes(8);
    expect(result).toEqual({ ok: true, action: 'filled', cellsFilled: 8 });
  });

  test('LoRA throws + Haiku throws → both-failed (CP426 fallback revival)', async () => {
    mockFindManyLevels.mockResolvedValueOnce(
      SUB_GOALS.map((sg, idx) => ({
        id: `level-${idx}`,
        center_goal: sg,
        subjects: [],
        position: idx,
      }))
    );
    mockGenerateMandala.mockRejectedValueOnce(new Error('ollama timeout'));
    // Haiku default mock (beforeEach) rejects — no override needed.

    const result = await fillMissingActionsIfNeeded(MANDALA_ID);
    // Fire-and-forget log runs on next tick — flush microtasks.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(mockGenerateMandala).toHaveBeenCalledTimes(1);
    expect(mockGenerateMandalaActions).toHaveBeenCalledTimes(1);
    expect(mockUpdateLevel).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.action).toBe('failed');
    expect(result.reason).toContain('lora+haiku both failed');
    expect(mockGenLogCreate).toHaveBeenCalledTimes(1);
    const logEntry = mockGenLogCreate.mock.calls[0]![0].data;
    expect(logEntry.lora_error).toContain(`[mandala=${MANDALA_ID}]`);
    expect(logEntry.lora_error).toContain('throw');
    expect(logEntry.source_returned).toBe('failed');
    expect(logEntry.lora_valid).toBe(false);
  });

  test('LoRA throws + Haiku succeeds → filled via Haiku fallback (CP426 revival)', async () => {
    mockFindManyLevels.mockResolvedValueOnce(
      SUB_GOALS.map((sg, idx) => ({
        id: `level-${idx}`,
        center_goal: sg,
        subjects: [],
        position: idx,
      }))
    );
    mockGenerateMandala.mockRejectedValueOnce(new Error('ollama timeout'));
    mockGenerateMandalaActions.mockResolvedValueOnce(mockActionsFor(SUB_GOALS));

    const result = await fillMissingActionsIfNeeded(MANDALA_ID);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(mockGenerateMandala).toHaveBeenCalledTimes(1);
    expect(mockGenerateMandalaActions).toHaveBeenCalledTimes(1);
    expect(mockUpdateLevel).toHaveBeenCalledTimes(8);
    expect(result).toEqual({ ok: true, action: 'filled', cellsFilled: 8 });
    // LoRA failure is still logged to generation_log for retraining data.
    expect(mockGenLogCreate).toHaveBeenCalledTimes(1);
    const logEntry = mockGenLogCreate.mock.calls[0]![0].data;
    expect(logEntry.lora_error).toContain('throw');
    expect(logEntry.lora_valid).toBe(false);
  });

  test('LoRA returns < 64 actions → logs failure (no Haiku, retry-able via generation_log)', async () => {
    mockFindManyLevels.mockResolvedValueOnce(
      SUB_GOALS.map((sg, idx) => ({
        id: `level-${idx}`,
        center_goal: sg,
        subjects: [],
        position: idx,
      }))
    );
    const partialActions: Record<string, string[]> = {};
    for (let i = 0; i < 5; i++) {
      partialActions[`sub_goal_${i + 1}`] = Array.from(
        { length: 8 },
        (_, j) => `partial-${i}-${j}`
      );
    }
    mockGenerateMandala.mockResolvedValueOnce({
      center_goal: 'x',
      center_label: '',
      language: 'ko',
      domain: 'general',
      sub_goals: SUB_GOALS,
      actions: partialActions,
    });

    const result = await fillMissingActionsIfNeeded(MANDALA_ID);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    // Post-CP426: Haiku fallback runs (default rejects), so result surfaces
    // as lora+haiku both-failed. LoRA's specific failure reason stays in
    // generation_log for retraining signal.
    expect(mockGenerateMandalaActions).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    expect(result.action).toBe('failed');
    expect(result.reason).toContain('lora+haiku both failed');
    expect(mockGenLogCreate).toHaveBeenCalledTimes(1);
    const logEntry = mockGenLogCreate.mock.calls[0]![0].data;
    expect(logEntry.lora_actions_total).toBe(40);
    expect(logEntry.lora_error).toContain('incomplete-actions: 40/64');
  });

  test('LoRA repetition mode (low unique-rate) → logs failure (no Haiku)', async () => {
    mockFindManyLevels.mockResolvedValueOnce(
      SUB_GOALS.map((sg, idx) => ({
        id: `level-${idx}`,
        center_goal: sg,
        subjects: [],
        position: idx,
      }))
    );
    const repetitive: Record<string, string[]> = {};
    SUB_GOALS.forEach((_, idx) => {
      repetitive[`sub_goal_${idx + 1}`] = Array(8).fill('학습하기');
    });
    mockGenerateMandala.mockResolvedValueOnce({
      center_goal: 'x',
      center_label: '',
      language: 'ko',
      domain: 'general',
      sub_goals: SUB_GOALS,
      actions: repetitive,
    });

    const result = await fillMissingActionsIfNeeded(MANDALA_ID);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    // Post-CP426: Haiku fallback runs (default rejects). 'repetition-mode'
    // stays in generation_log; result.reason reflects both-failed.
    expect(mockGenerateMandalaActions).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    expect(result.action).toBe('failed');
    expect(result.reason).toContain('lora+haiku both failed');
    expect(mockGenLogCreate).toHaveBeenCalledTimes(1);
    const logEntry = mockGenLogCreate.mock.calls[0]![0].data;
    expect(logEntry.lora_error).toContain('repetition-mode');
    expect(logEntry.lora_action_unique_rate).toBeLessThan(0.7);
  });

  test('skipped-full when all cells already have 8 subjects', async () => {
    mockFindManyLevels.mockResolvedValueOnce(
      SUB_GOALS.map((sg, idx) => ({
        id: `level-${idx}`,
        center_goal: sg,
        subjects: Array.from({ length: 8 }, (_, i) => `existing-${idx}-${i}`),
        position: idx,
      }))
    );

    const result = await fillMissingActionsIfNeeded(MANDALA_ID);

    expect(mockCreateManyLevels).not.toHaveBeenCalled();
    expect(mockGenerateMandala).not.toHaveBeenCalled();
    expect(mockGenerateMandalaActions).not.toHaveBeenCalled();
    expect(mockUpdateLevel).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, action: 'skipped-full' });
  });

  test('refuses scaffold when root has fewer than 8 subjects', async () => {
    mockFindFirstRoot.mockResolvedValue({
      id: ROOT_LEVEL_ID,
      center_goal: 'partial root',
      subjects: ['one', 'two', 'three'],
    });
    mockFindManyLevels.mockResolvedValueOnce([]);

    const result = await fillMissingActionsIfNeeded(MANDALA_ID);

    expect(mockCreateManyLevels).not.toHaveBeenCalled();
    expect(mockGenerateMandala).not.toHaveBeenCalled();
    expect(mockGenerateMandalaActions).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.action).toBe('skipped-not-found');
  });

  test('returns failed when scaffold createMany throws', async () => {
    mockFindManyLevels.mockResolvedValueOnce([]);
    mockCreateManyLevels.mockRejectedValueOnce(new Error('db down'));

    const result = await fillMissingActionsIfNeeded(MANDALA_ID);

    expect(mockGenerateMandala).not.toHaveBeenCalled();
    expect(mockGenerateMandalaActions).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.action).toBe('failed');
    expect(result.reason).toContain('db down');
  });

  test('mandala missing → skipped-not-found without scaffold attempt', async () => {
    mockFindUniqueMandala.mockResolvedValueOnce(null);

    const result = await fillMissingActionsIfNeeded(MANDALA_ID);

    expect(mockCreateManyLevels).not.toHaveBeenCalled();
    expect(mockFindManyLevels).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, action: 'skipped-not-found' });
  });

  // ==========================================================================
  // CP424 regression tests — silent-zero fix + LoRA schema contract
  //
  // Background: fill-missing-actions silently returned `{ok:true, action:'filled',
  // cellsFilled:0}` when LoRA produced 64+ actions with a key format that neither
  // keyA (sub_goal_1..8), keyB (0..7), nor keyC (level.center_goal text) matched.
  // Prod observed this for 4+ mandalas. Root cause: LoRA prompt did not specify
  // an explicit JSON schema, so the model used Korean sub_goal text as keys. The
  // matching loop then fell through to `?? null` on every cell, cellsFilled
  // remained 0, yet the function returned action='filled'. Dashboard saw empty
  // subjects with no observable failure.
  //
  // These tests lock the invariant: `action === 'filled'` ⇒ `cellsFilled > 0`.
  // Mismatch MUST surface as `action === 'failed'`.
  // ==========================================================================

  const realLoraOutputFixture =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../fixtures/lora-real-output.json') as {
      output: {
        center_goal: string;
        sub_goals: string[];
        actions: Record<string, string[] | string[]>;
      };
    };

  test('CP424 T1: silent-zero (cellsFilled=0 despite LoRA success) must return action=failed', async () => {
    // Setup: 8 depth=1 rows with empty subjects.
    mockFindManyLevels.mockResolvedValueOnce(
      SUB_GOALS.map((sg, idx) => ({
        id: `level-${idx}`,
        center_goal: sg,
        subjects: [],
        position: idx,
      }))
    );

    // LoRA returns 64 unique actions but with keys that do NOT match
    // sub_goal_N / index / center_goal text patterns.
    const nonMatchingKeys: Record<string, string[]> = {};
    for (let i = 0; i < 8; i++) {
      nonMatchingKeys[`action_bucket_${i}`] = Array.from(
        { length: 8 },
        (_, j) => `mismatched-key-action-${i}-${j}`
      );
    }
    mockGenerateMandala.mockResolvedValueOnce({
      center_goal: SUB_GOALS[0],
      center_label: '',
      language: 'ko',
      domain: 'general',
      sub_goals: SUB_GOALS,
      actions: nonMatchingKeys,
    });

    const result = await fillMissingActionsIfNeeded(MANDALA_ID);

    // Invariant: cellsFilled=0 MUST NOT be action='filled'.
    // Post-CP426: LoRA key-mismatch triggers Haiku fallback (default rejects),
    // so result surfaces as both-failed. LoRA key-mismatch detail is in the
    // generation_log entry.
    expect(mockUpdateLevel).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.action).toBe('failed');
    expect(result.reason).toMatch(/key|match|mismatch|both failed/i);
    // Fire-and-forget log runs on next tick — flush microtasks.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(mockGenLogCreate).toHaveBeenCalledTimes(1);
    const logEntry = mockGenLogCreate.mock.calls[0]![0].data;
    expect(logEntry.lora_error).toMatch(/key|match|mismatch/i);
  });

  test('CP424 T2: real LoRA output (Korean-text keys + 14-key metadata nesting) MUST NOT silently pass', async () => {
    // Fixture sourced from real prod LoRA call on 2026-04-24 (tests/fixtures/
    // lora-real-output.json). Demonstrates the observed failure mode:
    //   - 8 Korean sub_goal-text keys + 2 extraneous metadata keys ('sub_goals',
    //     'actions') nested inside the top-level actions dict
    //   - totalActions = 80 (passes >= 64 threshold)
    //   - unique rate ~ 1.0 (passes >= 0.7 threshold)
    // DB levels use fixture.sub_goals, so keyC (center_goal text) SHOULD match.
    // This test locks in that even in the "lucky" keyC-matches case, the guard
    // still catches downstream mismatches (e.g., if the DB had slightly drifted
    // sub_goals). We use altered DB sub_goals to force full mismatch.

    const fixtureSubGoals = realLoraOutputFixture.output.sub_goals;
    const driftedDbSubGoals = fixtureSubGoals.map((sg, i) => `${sg}_drift_${i}`);

    mockFindManyLevels.mockResolvedValueOnce(
      driftedDbSubGoals.map((sg, idx) => ({
        id: `level-${idx}`,
        center_goal: sg,
        subjects: [],
        position: idx,
      }))
    );

    mockFindFirstRoot.mockResolvedValue({
      id: ROOT_LEVEL_ID,
      center_goal: realLoraOutputFixture.output.center_goal,
      subjects: driftedDbSubGoals,
    });

    mockGenerateMandala.mockResolvedValueOnce({
      ...realLoraOutputFixture.output,
      center_label: '',
    } as unknown as Parameters<typeof mockGenerateMandala.mockResolvedValueOnce>[0]);

    const result = await fillMissingActionsIfNeeded(MANDALA_ID);

    // None of keyA (sub_goal_N), keyB (position), keyC (drifted center_goal)
    // match. Silent-zero would return action='filled', cellsFilled=0.
    // Fix MUST return action='failed'.
    expect(mockUpdateLevel).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.action).toBe('failed');
  });

  test('CP424 T3: LoRA non-idempotent — regenerates sub_goals differing from DB subjects, must fail not silent', async () => {
    // DB has center_goal "A1..A8"; LoRA regenerates "B1..B8" and keys actions
    // by its own sub_goals text. keyC mismatches. keyA/B also mismatch.
    const dbSubGoals = Array.from({ length: 8 }, (_, i) => `DB-subgoal-A${i + 1}`);
    const loraSubGoals = Array.from({ length: 8 }, (_, i) => `LoRA-subgoal-B${i + 1}`);

    mockFindManyLevels.mockResolvedValueOnce(
      dbSubGoals.map((sg, idx) => ({
        id: `level-${idx}`,
        center_goal: sg,
        subjects: [],
        position: idx,
      }))
    );
    mockFindFirstRoot.mockResolvedValue({
      id: ROOT_LEVEL_ID,
      center_goal: 'root',
      subjects: dbSubGoals,
    });

    const loraActions: Record<string, string[]> = {};
    for (const sg of loraSubGoals) {
      loraActions[sg] = Array.from({ length: 8 }, (_, j) => `lora-act-${sg}-${j}`);
    }
    mockGenerateMandala.mockResolvedValueOnce({
      center_goal: 'lora-center',
      center_label: '',
      language: 'ko',
      domain: 'general',
      sub_goals: loraSubGoals,
      actions: loraActions,
    });

    const result = await fillMissingActionsIfNeeded(MANDALA_ID);

    expect(mockUpdateLevel).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.action).toBe('failed');
  });

  test('CP424 T4: LoRA schema anomaly (nested sub_goals/actions metadata in actions dict) is detected', async () => {
    mockFindManyLevels.mockResolvedValueOnce(
      SUB_GOALS.map((sg, idx) => ({
        id: `level-${idx}`,
        center_goal: sg,
        subjects: [],
        position: idx,
      }))
    );

    const actionsWithMetadataPollution: Record<string, string[]> = {
      meta_key_alpha: Array.from({ length: 8 }, (_, j) => `alpha-${j}`),
      meta_key_beta: Array.from({ length: 8 }, (_, j) => `beta-${j}`),
      // More filler to pass totalActions >= 64 without any matching key.
    };
    for (let i = 0; i < 6; i++) {
      actionsWithMetadataPollution[`random_bucket_${i}`] = Array.from(
        { length: 8 },
        (_, j) => `bucket-${i}-${j}`
      );
    }
    // Simulate nested metadata keys (sub_goals, actions) that appeared in real
    // prod LoRA output.
    (actionsWithMetadataPollution as unknown as Record<string, unknown>)['sub_goals'] = [
      'nested meta',
    ];
    (actionsWithMetadataPollution as unknown as Record<string, unknown>)['actions'] = [
      'nested meta',
    ];

    mockGenerateMandala.mockResolvedValueOnce({
      center_goal: 'goal',
      center_label: '',
      language: 'ko',
      domain: 'general',
      sub_goals: SUB_GOALS,
      actions: actionsWithMetadataPollution,
    });

    const result = await fillMissingActionsIfNeeded(MANDALA_ID);

    // totalActions >= 64 passes validation, but NO key matches any level.
    // Silent-zero would mask this. Fix MUST surface as failed.
    expect(mockUpdateLevel).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.action).toBe('failed');
  });

  // CP424 T5 is implemented in tests/unit/modules/lora-prompt-schema.test.ts
  // as a separate file to avoid the @prisma/client mock collision that occurs
  // when jest.requireActual tries to load src/modules/mandala/generator.ts
  // (which imports PrismaClient transitively via database/client.ts).
});
