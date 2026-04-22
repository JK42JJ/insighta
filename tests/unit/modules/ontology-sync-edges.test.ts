/**
 * sync-edges — Lever A (CP416) regression tests
 *
 * Pins the contract that replaced `trg_goal_edge` + `trg_topic_edges`:
 *   - sector → goal edge per non-empty center_goal
 *   - sector → topic edge per non-empty subjects[] entry
 *   - idempotent via ON CONFLICT DO NOTHING
 *   - fails closed (ok=false) but never throws
 */

const mockFindUniqueMandala = jest.fn();
const mockQueryRaw = jest.fn();
const mockExecuteRaw = jest.fn();

jest.mock('@/modules/database', () => ({
  getPrismaClient: () => ({
    user_mandalas: { findUnique: mockFindUniqueMandala },
    $queryRaw: mockQueryRaw,
    $executeRaw: mockExecuteRaw,
  }),
}));

jest.mock('@prisma/client', () => ({
  Prisma: {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings,
      values,
      __tag: 'sql' as const,
    }),
  },
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

import { syncOntologyEdges } from '../../../src/modules/ontology/sync-edges';

const MANDALA_ID = '00000000-0000-0000-0000-000000000777';
const USER_ID = '00000000-0000-0000-0000-000000000001';

function makeLevels(n = 3) {
  return Array.from({ length: n }, (_, i) => ({
    id: `level-${i}`,
    center_goal: `goal-${i}`,
    subjects: [`s-${i}-0`, `s-${i}-1`, ''], // include one empty to exercise skip
  }));
}

describe('syncOntologyEdges', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExecuteRaw.mockResolvedValue(0);
  });

  test('happy path — sector/goal/topic nodes all present, multi-row INSERTs fire twice', async () => {
    const levels = makeLevels(3);
    mockFindUniqueMandala.mockResolvedValue({
      user_id: USER_ID,
      levels,
    });
    // 3 sectors + 3 goals + 6 topics (2 per level × 3, since subjects[2] empty)
    mockQueryRaw
      .mockResolvedValueOnce(levels.map((l) => ({ id: `sector-${l.id}`, level_id: l.id })))
      .mockResolvedValueOnce(levels.map((l) => ({ id: `goal-${l.id}`, level_id: l.id })))
      .mockResolvedValueOnce(
        levels.flatMap((l) => [
          { id: `topic-${l.id}-0`, topic_key: `${l.id}:s-${l.id.slice(-1)}-0` },
          { id: `topic-${l.id}-1`, topic_key: `${l.id}:s-${l.id.slice(-1)}-1` },
        ])
      );
    mockExecuteRaw
      .mockResolvedValueOnce(3) // goal edges inserted
      .mockResolvedValueOnce(6); // topic edges inserted

    const result = await syncOntologyEdges(MANDALA_ID);

    expect(result.ok).toBe(true);
    expect(result.goalEdgesCreated).toBe(3);
    expect(result.topicEdgesCreated).toBe(6);
    expect(mockQueryRaw).toHaveBeenCalledTimes(3);
    expect(mockExecuteRaw).toHaveBeenCalledTimes(2);
  });

  test('mandala not found → ok=false, no inserts', async () => {
    mockFindUniqueMandala.mockResolvedValue(null);

    const result = await syncOntologyEdges(MANDALA_ID);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('mandala not found');
    expect(mockQueryRaw).not.toHaveBeenCalled();
    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });

  test('no depth>=1 levels → ok=true, zero edges, no lookups', async () => {
    mockFindUniqueMandala.mockResolvedValue({ user_id: USER_ID, levels: [] });

    const result = await syncOntologyEdges(MANDALA_ID);

    expect(result).toMatchObject({
      ok: true,
      goalEdgesCreated: 0,
      topicEdgesCreated: 0,
    });
    expect(mockQueryRaw).not.toHaveBeenCalled();
    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });

  test('missing sector node for a level → that level skipped; others still sync', async () => {
    const levels = makeLevels(2);
    mockFindUniqueMandala.mockResolvedValue({ user_id: USER_ID, levels });
    // sector exists only for level-0, not level-1
    mockQueryRaw
      .mockResolvedValueOnce([{ id: 'sector-0', level_id: 'level-0' }])
      .mockResolvedValueOnce([
        { id: 'goal-0', level_id: 'level-0' },
        { id: 'goal-1', level_id: 'level-1' },
      ])
      .mockResolvedValueOnce([
        { id: 'topic-0-0', topic_key: 'level-0:s-0-0' },
        { id: 'topic-0-1', topic_key: 'level-0:s-0-1' },
      ]);
    mockExecuteRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    const result = await syncOntologyEdges(MANDALA_ID);

    expect(result.ok).toBe(true);
    // Only 1 goal edge possible (level-0 has sector+goal both)
    expect(result.goalEdgesCreated).toBe(1);
    // Only 2 topic edges possible (level-0's two non-empty subjects)
    expect(result.topicEdgesCreated).toBe(2);
  });

  test('empty center_goal on a level → no goal edge for that level', async () => {
    const levels = [
      { id: 'level-0', center_goal: '', subjects: ['s-0-0'] },
      { id: 'level-1', center_goal: 'g-1', subjects: ['s-1-0'] },
    ];
    mockFindUniqueMandala.mockResolvedValue({ user_id: USER_ID, levels });
    mockQueryRaw
      .mockResolvedValueOnce([
        { id: 'sector-0', level_id: 'level-0' },
        { id: 'sector-1', level_id: 'level-1' },
      ])
      .mockResolvedValueOnce([
        { id: 'goal-0', level_id: 'level-0' },
        { id: 'goal-1', level_id: 'level-1' },
      ])
      .mockResolvedValueOnce([
        { id: 'topic-0', topic_key: 'level-0:s-0-0' },
        { id: 'topic-1', topic_key: 'level-1:s-1-0' },
      ]);
    mockExecuteRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    const result = await syncOntologyEdges(MANDALA_ID);

    expect(result.ok).toBe(true);
    // level-0 center_goal is empty → only level-1 contributes a goal edge
    // Our multi-row INSERT call sends 1 tuple; executeRaw mock returns 1
    expect(result.goalEdgesCreated).toBe(1);
    // Both levels contribute topic edges (subjects non-empty)
    expect(result.topicEdgesCreated).toBe(2);
  });

  test('db error in any step → ok=false with reason, never throws', async () => {
    mockFindUniqueMandala.mockRejectedValue(new Error('db down'));

    await expect(syncOntologyEdges(MANDALA_ID)).resolves.toMatchObject({
      ok: false,
      reason: 'db down',
      goalEdgesCreated: 0,
      topicEdgesCreated: 0,
    });
  });

  test('all subjects empty on every level → zero topic edges, goal edges still fire', async () => {
    const levels = [
      { id: 'level-0', center_goal: 'g-0', subjects: ['', '', ''] },
      { id: 'level-1', center_goal: 'g-1', subjects: [] as string[] },
    ];
    mockFindUniqueMandala.mockResolvedValue({ user_id: USER_ID, levels });
    mockQueryRaw
      .mockResolvedValueOnce([
        { id: 'sector-0', level_id: 'level-0' },
        { id: 'sector-1', level_id: 'level-1' },
      ])
      .mockResolvedValueOnce([
        { id: 'goal-0', level_id: 'level-0' },
        { id: 'goal-1', level_id: 'level-1' },
      ]);
    mockExecuteRaw.mockResolvedValueOnce(2);

    const result = await syncOntologyEdges(MANDALA_ID);

    expect(result.ok).toBe(true);
    expect(result.goalEdgesCreated).toBe(2);
    expect(result.topicEdgesCreated).toBe(0);
    // Topic query is skipped entirely when the tuple set is empty
    expect(mockQueryRaw).toHaveBeenCalledTimes(2);
    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
  });

  test('durationMs always included', async () => {
    mockFindUniqueMandala.mockResolvedValue({ user_id: USER_ID, levels: [] });

    const result = await syncOntologyEdges(MANDALA_ID);
    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
