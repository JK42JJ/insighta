/**
 * binByCells (CP492 V5_PICKER_MODE=cell_binning) — no-LLM picker that round-robins
 * fanout survivors across cells. Validates: 9-cell balance, round-robin order,
 * per-cell top-N relevance, under-filled cells, null cellIndex = center bucket.
 */

import { binByCells } from '@/skills/plugins/video-discover/v5/executor';
import type { FanoutCandidate } from '@/skills/plugins/video-discover/v5/youtube-fanout';

function cand(videoId: string, cellIndex: number | null): FanoutCandidate {
  return {
    videoId,
    title: videoId,
    description: '',
    channelTitle: '',
    channelId: '',
    publishedAt: '2026-01-01T00:00:00Z',
    thumbnailUrl: '',
    cellIndex,
  };
}

/** Build `perCell` candidates for each of `cells` cells, in relevance order. */
function survivorsFor(cells: number[], perCell: number): FanoutCandidate[] {
  const out: FanoutCandidate[] = [];
  for (const c of cells) {
    for (let i = 0; i < perCell; i += 1) out.push(cand(`c${c}_v${i}`, c));
  }
  return out;
}

function cellOf(videoId: string): number {
  return Number(videoId.slice(1, videoId.indexOf('_')));
}

describe('binByCells', () => {
  test('balances across all cells — every cell represented, none dominates', () => {
    const survivors = survivorsFor([0, 1, 2, 3, 4, 5, 6, 7, 8], 10); // 9 cells × 10
    const picks = binByCells(survivors, 30, 1.5);
    const counts = new Map<number, number>();
    for (const p of picks) counts.set(cellOf(p.videoId), (counts.get(cellOf(p.videoId)) ?? 0) + 1);
    // all 9 cells present
    expect(counts.size).toBe(9);
    // max-min spread <= 1 (round-robin is even when cells are equally rich)
    const vals = [...counts.values()];
    expect(Math.max(...vals) - Math.min(...vals)).toBeLessThanOrEqual(1);
  });

  test('round-robin order — first N picks are one per cell (rank 0)', () => {
    const survivors = survivorsFor([0, 1, 2], 5);
    const picks = binByCells(survivors, 9, 1); // perCell = ceil(9/3) = 3
    // first 3 = rank-0 from each cell, distinct cells
    const firstThreeCells = picks.slice(0, 3).map((p) => cellOf(p.videoId));
    expect(new Set(firstThreeCells)).toEqual(new Set([0, 1, 2]));
    // and they are the v0 (top relevance) of each cell
    expect(picks.slice(0, 3).every((p) => p.videoId.endsWith('_v0'))).toBe(true);
  });

  test('per-cell takes top-relevance first (v0 before v1)', () => {
    const survivors = survivorsFor([0], 5);
    const picks = binByCells(survivors, 9, 1); // 1 cell → perCell = 9, only 5 exist
    // single cell → relevance order preserved, all available taken
    expect(picks.map((p) => p.videoId)).toEqual(['c0_v0', 'c0_v1', 'c0_v2', 'c0_v3', 'c0_v4']);
  });

  test('CP500+ PR3 — under-filled cell contributes what it has; rich-cell SURPLUS backfills the budget (상한→최소확보)', () => {
    // cell 0 has 1 candidate, cell 1 has 5. Budget = 6×1 = 6. Pre-PR3 the
    // perCell cut (3) DISCARDED cell 1's rank-4/5 while the total ran short
    // (4 picks for a 6 budget) — the "12 limit" loss. Now the round-robin
    // continues past perCell while the budget has room.
    const survivors = [cand('c0_v0', 0), ...survivorsFor([1], 5)];
    const picks = binByCells(survivors, 6, 1); // perCell = ceil(6/2) = 3, budget = 6
    const byCell = new Map<number, number>();
    for (const p of picks) byCell.set(cellOf(p.videoId), (byCell.get(cellOf(p.videoId)) ?? 0) + 1);
    expect(byCell.get(0)).toBe(1); // only had 1
    expect(byCell.get(1)).toBe(5); // 3 (perCell) + 2 surplus — budget filled
    expect(picks).toHaveLength(6);
    // surplus picks clamp to a small positive score (FE sort stays sane)
    expect(picks.every((x) => x.score > 0)).toBe(true);
  });

  test('null cellIndex grouped as a single center bucket', () => {
    const survivors = [
      { ...cand('core_v0', null) },
      { ...cand('core_v1', null) },
      ...survivorsFor([0], 2),
    ];
    const picks = binByCells(survivors, 9, 1);
    const coreCount = picks.filter((p) => p.videoId.startsWith('core')).length;
    expect(coreCount).toBe(2); // both null-cell candidates kept, one bucket
  });

  test('score decreases with rank so FE score-desc sort stays sensible', () => {
    const survivors = survivorsFor([0], 3);
    const picks = binByCells(survivors, 9, 1);
    expect(picks[0]!.score).toBeGreaterThan(picks[1]!.score);
    expect(picks[1]!.score).toBeGreaterThan(picks[2]!.score);
    expect(picks.every((p) => p.reason === '')).toBe(true); // no LLM rationale
  });
});
