/**
 * figure-build-mapping (D core) — snapshot row → build figures[] (pure).
 * Locks the field gaps: synthesized figure_id, struct/latex passthrough,
 * png_url from asset_path (omitted when null).
 */

import {
  snapshotRowToBuildFigure,
  snapshotFigureId,
  type SnapshotRow,
} from '../../../src/modules/snapshot/figure-build-mapping';

const row = (over: Partial<SnapshotRow> = {}): SnapshotRow => ({
  video_id: 'dQw4w9WgXcQ',
  ts_sec: 760,
  kind: 'table',
  struct: null,
  latex: null,
  asset_path: null,
  ...over,
});

describe('figure-build-mapping', () => {
  it('synthesizes figure_id as videoId:ts:kind', () => {
    expect(snapshotFigureId('vid', 12, 'chart')).toBe('vid:12:chart');
    expect(snapshotRowToBuildFigure(row()).figure_id).toBe('dQw4w9WgXcQ:760:table');
  });

  it('passes struct through for table/chart/diagram', () => {
    const f = snapshotRowToBuildFigure(
      row({ kind: 'table', struct: { headers: ['a'], rows: [[1]] } })
    );
    expect(f.kind).toBe('table');
    expect(f.struct).toEqual({ headers: ['a'], rows: [[1]] });
    expect(f.ts).toBe(760);
  });

  it('passes latex for equation, no struct', () => {
    const f = snapshotRowToBuildFigure(row({ kind: 'equation', latex: 'E=mc^2' }));
    expect(f.latex).toBe('E=mc^2');
    expect(f.struct).toBeUndefined();
  });

  it('maps asset_path → png_url; omits png_url when asset_path null (deferred keyframe)', () => {
    expect(
      snapshotRowToBuildFigure(row({ kind: 'keyframe', asset_path: '/p/x.png' })).png_url
    ).toBe('/p/x.png');
    expect('png_url' in snapshotRowToBuildFigure(row())).toBe(false);
  });
});
