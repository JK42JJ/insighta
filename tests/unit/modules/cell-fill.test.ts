/**
 * CP494 ④-1 — per-cell fill counting. filterFullCells (pure threshold) +
 * getFullCellIndices (mocked client → JS-side threshold).
 */

import { filterFullCells, getFullCellIndices } from '@/modules/mandala/cell-fill';

describe('cell-fill (CP494 ④-1)', () => {
  test('filterFullCells: returns only cells at/above threshold', () => {
    const rows = [
      { cell_index: 0, c: 15 },
      { cell_index: 1, c: 5 },
      { cell_index: 2, c: 12 }, // exactly threshold
      { cell_index: 3, c: 11 }, // just below
    ];
    expect(filterFullCells(rows, 12)).toEqual([0, 2]);
  });

  test('filterFullCells: empty when none reach threshold', () => {
    expect(filterFullCells([{ cell_index: 0, c: 3 }], 12)).toEqual([]);
  });

  test('getFullCellIndices: queries once, applies threshold to returned counts', async () => {
    const $queryRaw = jest.fn().mockResolvedValue([
      { cell_index: 4, c: 20 },
      { cell_index: 5, c: 8 },
    ]);
    const out = await getFullCellIndices({ $queryRaw } as never, 'u', 'm', 12);
    expect($queryRaw).toHaveBeenCalledTimes(1);
    expect(out).toEqual([4]); // 20 >= 12, 8 < 12
  });
});
