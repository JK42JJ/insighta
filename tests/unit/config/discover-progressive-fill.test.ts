/**
 * Progressive fill config + chunk planner (2026-07-11, supervisor conditions).
 */
import {
  isProgressiveFillEnabled,
  getProgressiveFillConfig,
  planProgressiveChunks,
} from '@/config/discover-progressive-fill';

describe('progressive fill config', () => {
  test('unset → disabled (flag alone rolls back)', () => {
    expect(isProgressiveFillEnabled({})).toBe(false);
  });
  test.each(['true', '1', 'yes'])('enabled by %s', (v) => {
    expect(isProgressiveFillEnabled({ DISCOVER_PROGRESSIVE_FILL: v })).toBe(true);
  });
  test('defaults 12/25/2, env override, invalid → default', () => {
    expect(getProgressiveFillConfig({})).toEqual({
      firstChunkSize: 12,
      chunkSize: 25,
      perChunkCellCap: 2,
    });
    expect(
      getProgressiveFillConfig({ DISCOVER_PF_FIRST_CHUNK: '8', DISCOVER_PF_CHUNK: 'x' })
    ).toEqual({ firstChunkSize: 8, chunkSize: 25, perChunkCellCap: 2 });
  });
});

describe('planProgressiveChunks — first chunk round-robin (supervisor cond. 1)', () => {
  const cfg = { firstChunkSize: 4, chunkSize: 3, perChunkCellCap: 2 };
  const c = (id: string, hint: number | null) => ({ id, hint });

  test('first chunk covers cells evenly, not one lane', () => {
    const cands = [c('a0', 0), c('a1', 0), c('a2', 0), c('b0', 1), c('b1', 1), c('c0', 2)];
    const chunks = planProgressiveChunks(cands, cfg, (x) => x.hint);
    // round 1 picks one per lane (0,1,2) then round 2 starts lane 0 → a0,b0,c0,a1
    expect(chunks[0]!.map((x) => x.id)).toEqual(['a0', 'b0', 'c0', 'a1']);
  });

  test('rest is sliced by chunkSize in original order; no candidate lost or duplicated', () => {
    const cands = Array.from({ length: 11 }, (_, i) => c(`v${i}`, i % 3));
    const chunks = planProgressiveChunks(cands, cfg, (x) => x.hint);
    const flat = chunks.flat().map((x) => x.id);
    expect(flat.sort()).toEqual(cands.map((x) => x.id).sort());
    expect(new Set(flat).size).toBe(11);
    expect(chunks[0]!.length).toBe(4);
    for (const ch of chunks.slice(1)) expect(ch.length).toBeLessThanOrEqual(3);
  });

  test('null hints form their own lane; empty input → no chunks', () => {
    expect(planProgressiveChunks([], cfg, () => null)).toEqual([]);
    const chunks = planProgressiveChunks([c('x', null), c('y', 2)], cfg, (v) => v.hint);
    expect(chunks[0]!.length).toBe(2);
  });

  test('fewer candidates than firstChunkSize → single chunk, loop terminates', () => {
    const chunks = planProgressiveChunks([c('a', 0), c('b', 1)], cfg, (x) => x.hint);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.length).toBe(2);
  });
});
