/**
 * warm-select (C' core) — high-rel segments → warm targets spread across cells.
 * Locks: minRel filter, per-cell video cap (theme spread), per-video ts cap,
 * drop segments whose video has no known cell.
 */

import { selectWarmTargets, type RelSegment } from '../../../src/modules/snapshot/warm-select';

describe('selectWarmTargets', () => {
  it('spreads across cells with per-cell video cap (no single-cell domination)', () => {
    // cell 0 has 3 high-rel videos; cell 1 has 1. cap 2/cell → cell0 keeps top 2.
    const segs: RelSegment[] = [
      { videoId: 'a', fromSec: 0, relevancePct: 92 },
      { videoId: 'b', fromSec: 0, relevancePct: 88 },
      { videoId: 'c', fromSec: 0, relevancePct: 85 },
      { videoId: 'd', fromSec: 0, relevancePct: 90 },
    ];
    const cellByVideo = new Map([
      ['a', 0],
      ['b', 0],
      ['c', 0],
      ['d', 1],
    ]);
    const out = selectWarmTargets(segs, cellByVideo, {
      minRel: 80,
      perCellVideoCap: 2,
      perVideoTsCap: 3,
    });
    const cell0 = out
      .filter((t) => t.cellIndex === 0)
      .map((t) => t.videoId)
      .sort();
    const cell1 = out.filter((t) => t.cellIndex === 1).map((t) => t.videoId);
    expect(cell0).toEqual(['a', 'b']); // top 2 by relevance (92, 88) — c (85) dropped
    expect(cell1).toEqual(['d']);
  });

  it('caps timestamps per video and sorts ascending', () => {
    const segs: RelSegment[] = [
      { videoId: 'a', fromSec: 300, relevancePct: 90 },
      { videoId: 'a', fromSec: 100, relevancePct: 90 },
      { videoId: 'a', fromSec: 500, relevancePct: 90 },
      { videoId: 'a', fromSec: 200, relevancePct: 90 },
    ];
    const out = selectWarmTargets(segs, new Map([['a', 0]]), { perVideoTsCap: 3 });
    expect(out[0]!.ts).toEqual([100, 200, 300]); // sorted asc, capped to 3
  });

  it('drops segments below minRel and videos with no known cell', () => {
    const segs: RelSegment[] = [
      { videoId: 'a', fromSec: 0, relevancePct: 70 }, // below minRel 80
      { videoId: 'b', fromSec: 0, relevancePct: 95 }, // no cell mapping
      { videoId: 'c', fromSec: 0, relevancePct: 95 }, // kept
    ];
    const out = selectWarmTargets(
      segs,
      new Map([
        ['a', 0],
        ['c', 2],
      ]),
      { minRel: 80 }
    );
    expect(out.map((t) => t.videoId)).toEqual(['c']);
  });
});
