/**
 * Tests for searchMandalasByGoal threshold / floor behaviour.
 *
 * Covers the fix for "수학 → 주짓수" bug (Issue #543, CP358 MIN_RESULTS_GUARANTEE
 * removal + HARD_SIMILARITY_FLOOR raise to 0.4):
 *   - No fallback query fires when 0 rows pass the threshold.
 *   - HARD_SIMILARITY_FLOOR always drops results below 0.4 even if the
 *     caller passed a lower threshold.
 *   - Sub-0.4 results that the pre-fix `MIN_RESULTS_GUARANTEE` fallback would
 *     have leaked through are now dropped.
 *   - Normal case: results above the floor are returned as-is.
 */

// ─── Mocks (declared before importing the module under test) ───

jest.mock('@/modules/database/client', () => ({
  getPrismaClient: jest.fn(),
}));

// Mock global fetch so the embedding HTTP call (ollama or openrouter)
// resolves synchronously with a fake 4096-dim vector. Same-module
// `jest.requireActual` self-mocks do NOT intercept internal calls in
// search.ts — fetch-level mock is the only reliable interception point.
const FAKE_EMBEDDING = new Array(4096).fill(0.1);
const fetchMock = jest.fn().mockResolvedValue({
  ok: true,
  status: 200,
  json: async () => ({
    // OpenRouter shape
    data: [{ embedding: FAKE_EMBEDDING }],
    // Ollama shape (responds whichever provider config picks)
    embedding: FAKE_EMBEDDING,
  }),
  text: async () => '',
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).fetch = fetchMock;

import { getPrismaClient } from '@/modules/database/client';
import { searchMandalasByGoal } from '@/modules/mandala/search';

const mockPrisma = {
  $queryRaw: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  fetchMock.mockClear();
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      data: [{ embedding: FAKE_EMBEDDING }],
      embeddings: [FAKE_EMBEDDING],
    }),
    text: async () => '',
  });
  (getPrismaClient as jest.Mock).mockReturnValue(mockPrisma);
});

// ─── Helpers ───

/** Build a minimal TopRow as returned by the pgvector query. */
function makeTopRow(
  similarity: number,
  overrides: Partial<{
    mandala_id: string;
    center_goal: string;
    center_label: string | null;
    domain: string | null;
    language: string | null;
  }> = {}
) {
  return {
    mandala_id: overrides.mandala_id ?? 'test-uuid-1',
    center_goal: overrides.center_goal ?? '테스트 목표',
    center_label: overrides.center_label ?? null,
    domain: overrides.domain ?? null,
    language: overrides.language ?? 'ko',
    similarity,
  };
}

// ─── Tests ───

describe('searchMandalasByGoal — threshold / floor behaviour', () => {
  it('returns empty array when no rows pass the threshold (no fallback)', async () => {
    // Simulate DB returning 0 rows (all filtered by threshold in SQL)
    mockPrisma.$queryRaw.mockResolvedValueOnce([]);

    const results = await searchMandalasByGoal('수학', { threshold: 0.4, language: 'ko' });

    expect(results).toEqual([]);
    // Exactly one $queryRaw call: no fallback retry
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('drops results below HARD_SIMILARITY_FLOOR even when caller uses a lower threshold', async () => {
    // DB respects the caller's low threshold and returns a row with similarity 0.15
    // (well below HARD_SIMILARITY_FLOOR = 0.4). The post-filter must remove it.
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      makeTopRow(0.15, { mandala_id: 'low-sim-uuid', center_goal: '주짓수' }),
    ]);

    // Even though caller passed threshold: 0.1, the hard floor should remove the result
    const results = await searchMandalasByGoal('수학', { threshold: 0.1, language: 'ko' });

    expect(results).toEqual([]);
    // Still only one query — no fallback
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('drops a 0.30-similarity row that the pre-fix MIN_RESULTS_GUARANTEE fallback would have leaked', async () => {
    // Pre-fix behaviour: a 0.30 similarity row would either (a) come back from
    // the threshold query when caller passed 0.3, or (b) be surfaced by the
    // fallback retry when fewer than 3 rows passed. Both are now blocked by
    // the 0.4 hard floor, regardless of caller threshold.
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      makeTopRow(0.3, { mandala_id: 'borderline-uuid', center_goal: '청소년 멘토링' }),
    ]);

    const results = await searchMandalasByGoal('수학', { threshold: 0.3, language: 'ko' });

    expect(results).toEqual([]);
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('returns results normally when similarity is above the floor', async () => {
    // 0.55 is comfortably above the 0.4 floor — analogous to the 0.47 top-1
    // similarity observed in the prod 1-E reproduction for "수학" queries.
    const topRow = makeTopRow(0.55, {
      mandala_id: 'good-uuid',
      center_goal: '수학 실력 향상',
      language: 'ko',
    });
    // First call: topRows query; second call: templateRows meta query;
    // third call: levelRows query (returns empty — sub_goals not needed for this assertion)
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([topRow]) // Step 1: top mandala_ids
      .mockResolvedValueOnce([]) // Step 2: template meta rows
      .mockResolvedValueOnce([]); // Step 3: level rows (empty, sub_goals not checked here)

    const results = await searchMandalasByGoal('수학', { threshold: 0.4, language: 'ko' });

    expect(results).toHaveLength(1);
    const first = results[0];
    expect(first).toBeDefined();
    expect(first?.center_goal).toBe('수학 실력 향상');
    expect(first?.similarity).toBeCloseTo(0.55, 5);
  });
});
