/**
 * v2 cell-assigner — unit tests
 *
 * Pure-function tests. No DB, no network, no embedding API — all vectors
 * are constructed inline so the math is fully deterministic.
 */

import {
  scoreVideos,
  assignToCells,
  assignEvenly,
  totalAssigned,
  NUM_CELLS,
  TARGET_PER_CELL,
  TARGET_TOTAL,
} from '../v2/cell-assigner';

/** Build an L2-normalized one-hot vector pointing at axis `axis` of dim `dim`. */
function oneHot(axis: number, dim: number): number[] {
  const v = new Array(dim).fill(0);
  v[axis] = 1;
  return v;
}

const DIM = 8; // small dim for test math; cosineSimilarity is dimension-agnostic

describe('scoreVideos', () => {
  test('throws if sub_goal embeddings count !== NUM_CELLS', () => {
    const subGoals = [oneHot(0, DIM), oneHot(1, DIM)]; // only 2
    const videoEmb = new Map<string, number[]>([['v1', oneHot(0, DIM)]]);
    expect(() => scoreVideos(videoEmb, subGoals)).toThrow(/expected 8/);
  });

  test('best_cell is the cell with max cosine', () => {
    const subGoals = Array.from({ length: NUM_CELLS }, (_, i) => oneHot(i, DIM));
    const videoEmb = new Map<string, number[]>([
      ['v0', oneHot(0, DIM)],
      ['v3', oneHot(3, DIM)],
      ['v7', oneHot(7, DIM)],
    ]);
    const scored = scoreVideos(videoEmb, subGoals);
    const byId = Object.fromEntries(scored.map((s) => [s.videoId, s]));
    expect(byId['v0']?.bestCell).toBe(0);
    expect(byId['v3']?.bestCell).toBe(3);
    expect(byId['v7']?.bestCell).toBe(7);
    expect(byId['v0']?.bestScore).toBeCloseTo(1, 5);
  });

  test('skips videos missing from embedding map', () => {
    const subGoals = Array.from({ length: NUM_CELLS }, (_, i) => oneHot(i, DIM));
    const videoEmb = new Map<string, number[]>(); // empty
    const scored = scoreVideos(videoEmb, subGoals);
    expect(scored).toEqual([]);
  });
});

describe('assignToCells — Phase 1 (per-cell top N)', () => {
  test('takes top TARGET_PER_CELL per cell sorted by bestScore desc', () => {
    const subGoals = Array.from({ length: NUM_CELLS }, (_, i) => oneHot(i, DIM));
    // 10 videos all best-matching cell 0, with descending scores
    const videoEmb = new Map<string, number[]>();
    for (let i = 0; i < 10; i++) {
      const v = oneHot(0, DIM).map((x, idx) => x * (1 - i * 0.05) + (idx === 1 ? i * 0.01 : 0));
      videoEmb.set(`v${i}`, v);
    }
    const scored = scoreVideos(videoEmb, subGoals);
    const assigned = assignToCells(scored);
    expect(assigned[0]?.videoIds.length).toBe(TARGET_PER_CELL);
    // Phase 2 will rebalance the remaining 5 into other cells
  });
});

describe('assignToCells — Phase 2 (rebalance)', () => {
  test('underfilled cell pulls from videos with that cell as 2nd-best', () => {
    const subGoals = Array.from({ length: NUM_CELLS }, (_, i) => oneHot(i, DIM));
    // 10 videos all heavily weighted to cell 0 but with non-trivial cell-1 component
    const videoEmb = new Map<string, number[]>();
    for (let i = 0; i < 10; i++) {
      const v = new Array(DIM).fill(0);
      v[0] = 1 - i * 0.01; // strong cell 0
      v[1] = 0.5; // moderate cell 1
      videoEmb.set(`v${i}`, v);
    }
    const scored = scoreVideos(videoEmb, subGoals);
    const assigned = assignToCells(scored);
    // Cell 1 starts empty (no video has cell 1 as best) → rebalance fills it
    expect(assigned[1]?.videoIds.length).toBeGreaterThan(0);
  });

  test('total assigned ≤ scored.length (no duplication)', () => {
    const subGoals = Array.from({ length: NUM_CELLS }, (_, i) => oneHot(i, DIM));
    const videoEmb = new Map<string, number[]>();
    for (let i = 0; i < 60; i++) {
      videoEmb.set(`v${i}`, oneHot(i % NUM_CELLS, DIM));
    }
    const scored = scoreVideos(videoEmb, subGoals);
    const assigned = assignToCells(scored);
    const all = assigned.flatMap((a) => a.videoIds);
    expect(new Set(all).size).toBe(all.length); // no dup
    expect(all.length).toBeLessThanOrEqual(scored.length);
  });

  test('healthy pool reaches TARGET_TOTAL', () => {
    const subGoals = Array.from({ length: NUM_CELLS }, (_, i) => oneHot(i, DIM));
    const videoEmb = new Map<string, number[]>();
    // 10 videos per cell × 8 cells = 80 candidates
    for (let cell = 0; cell < NUM_CELLS; cell++) {
      for (let i = 0; i < 10; i++) {
        const v = oneHot(cell, DIM).map((x) => x * (1 - i * 0.01));
        videoEmb.set(`v${cell}-${i}`, v);
      }
    }
    const scored = scoreVideos(videoEmb, subGoals);
    const assigned = assignToCells(scored);
    expect(totalAssigned(assigned)).toBe(TARGET_TOTAL);
    for (const a of assigned) {
      expect(a.videoIds.length).toBe(TARGET_PER_CELL);
    }
  });
});

describe('assignEvenly — fallback distribution', () => {
  test('round-robins videos across cells', () => {
    const ids = Array.from({ length: 16 }, (_, i) => `v${i}`);
    const assigned = assignEvenly(ids);
    expect(assigned.length).toBe(NUM_CELLS);
    for (let i = 0; i < NUM_CELLS; i++) {
      expect(assigned[i]?.videoIds.length).toBe(2);
    }
    // First video lands in cell 0
    expect(assigned[0]?.videoIds[0]).toBe('v0');
  });

  test('caps at targetTotal', () => {
    const ids = Array.from({ length: 100 }, (_, i) => `v${i}`);
    const assigned = assignEvenly(ids, TARGET_TOTAL);
    expect(totalAssigned(assigned)).toBe(TARGET_TOTAL);
  });

  test('handles empty input', () => {
    const assigned = assignEvenly([]);
    expect(totalAssigned(assigned)).toBe(0);
    expect(assigned.length).toBe(NUM_CELLS);
  });
});
