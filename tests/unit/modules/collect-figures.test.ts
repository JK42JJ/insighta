/**
 * collect-figures (D) — mandala placed videos → cached snapshots → build figures[].
 * Dry verification with MOCK snapshots (no real extract; figures are mock data).
 * Locks: enumerate placed (uvs+ulc) → query snapshots → map; empty when none.
 */

const mockUvsFindMany = jest.fn();
const mockUlcFindMany = jest.fn();
const mockQueryRawUnsafe = jest.fn();
jest.mock('@/modules/database/client', () => ({
  getPrismaClient: () => ({
    userVideoState: { findMany: mockUvsFindMany },
    user_local_cards: { findMany: mockUlcFindMany },
    $queryRawUnsafe: (...a: unknown[]) => mockQueryRawUnsafe(...a),
  }),
}));
jest.mock('@/config/index', () => ({
  config: {
    database: { url: 'postgresql://x:x@127.0.0.1:5432/x', directUrl: undefined },
    app: { isDevelopment: true, isProduction: false, isTest: true },
    paths: { logs: '/tmp' },
  },
}));

import { collectFiguresForMandala } from '../../../src/modules/snapshot/collect-figures';

const M = '942e2757-64fa-4759-afc5-56e2f33869f2';

beforeEach(() => {
  mockUvsFindMany.mockReset();
  mockUlcFindMany.mockReset();
  mockQueryRawUnsafe.mockReset();
});

describe('collectFiguresForMandala', () => {
  it('collects placed videos (uvs+ulc) → snapshots → mapped build figures (MOCK snapshots)', async () => {
    mockUvsFindMany.mockResolvedValue([{ video: { youtube_video_id: 'vidA' } }]);
    mockUlcFindMany.mockResolvedValue([{ video_id: 'vidB' }]);
    // MOCK snapshots (no real extract — explicit mock data)
    mockQueryRawUnsafe.mockResolvedValue([
      {
        video_id: 'vidA',
        ts_sec: 760,
        kind: 'table',
        struct: { rows: 2 },
        latex: null,
        asset_path: null,
      },
      {
        video_id: 'vidB',
        ts_sec: 12,
        kind: 'equation',
        struct: null,
        latex: 'x^2',
        asset_path: null,
      },
    ]);

    const figs = await collectFiguresForMandala(M);

    // queried the union of placed video ids
    const [, idsArg] = mockQueryRawUnsafe.mock.calls[0]!;
    expect((idsArg as string[]).sort()).toEqual(['vidA', 'vidB']);
    expect(figs).toHaveLength(2);
    expect(figs[0]).toMatchObject({
      figure_id: 'vidA:760:table',
      kind: 'table',
      struct: { rows: 2 },
      ts: 760,
    });
    expect(figs[1]).toMatchObject({ figure_id: 'vidB:12:equation', latex: 'x^2' });
  });

  it('returns [] when no placed videos (no fabrication)', async () => {
    mockUvsFindMany.mockResolvedValue([]);
    mockUlcFindMany.mockResolvedValue([]);
    const figs = await collectFiguresForMandala(M);
    expect(figs).toEqual([]);
    expect(mockQueryRawUnsafe).not.toHaveBeenCalled();
  });
});
