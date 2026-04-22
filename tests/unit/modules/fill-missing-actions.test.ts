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
    // Individual tests override to exercise fallback paths.
    mockGenerateMandala.mockResolvedValue(mockLoraMandalaFor(SUB_GOALS));
    mockGenerateMandalaActions.mockResolvedValue(mockActionsFor(SUB_GOALS));
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

  test('LoRA throws → logs failure to generation_log and returns failed (no Haiku)', async () => {
    mockFindManyLevels.mockResolvedValueOnce(
      SUB_GOALS.map((sg, idx) => ({
        id: `level-${idx}`,
        center_goal: sg,
        subjects: [],
        position: idx,
      }))
    );
    mockGenerateMandala.mockRejectedValueOnce(new Error('ollama timeout'));

    const result = await fillMissingActionsIfNeeded(MANDALA_ID);
    // Fire-and-forget log runs on next tick — flush microtasks.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(mockGenerateMandala).toHaveBeenCalledTimes(1);
    expect(mockGenerateMandalaActions).not.toHaveBeenCalled();
    expect(mockUpdateLevel).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.action).toBe('failed');
    expect(result.reason).toContain('lora-only policy');
    expect(mockGenLogCreate).toHaveBeenCalledTimes(1);
    const logEntry = mockGenLogCreate.mock.calls[0]![0].data;
    expect(logEntry.lora_error).toContain(`[mandala=${MANDALA_ID}]`);
    expect(logEntry.lora_error).toContain('throw');
    expect(logEntry.source_returned).toBe('failed');
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

    expect(mockGenerateMandalaActions).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.action).toBe('failed');
    expect(result.reason).toContain('incomplete-actions');
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

    expect(mockGenerateMandalaActions).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.action).toBe('failed');
    expect(result.reason).toContain('repetition-mode');
    expect(mockGenLogCreate).toHaveBeenCalledTimes(1);
    const logEntry = mockGenLogCreate.mock.calls[0]![0].data;
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
});
