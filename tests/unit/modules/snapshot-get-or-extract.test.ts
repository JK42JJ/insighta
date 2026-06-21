/**
 * get-or-extract (⑤) tests — the invariants James reviews before merge:
 *   (b) interpolation = 0 — a cache-miss whose extraction yields nothing
 *       contributes NO figure (no fabrication), and nothing is upserted;
 *   (c) serve-from-cache is independent of extract — when every requested ts is
 *       cached, the extractor is NEVER called (manual-warm rows serve alone).
 *   plus: cache miss → extract → upsert → return; partial hit only extracts the
 *   missing timestamps; query is content-scoped (video_id + ts, no user/mandala).
 */

const mockQuery = jest.fn();
const mockExec = jest.fn().mockResolvedValue(1);
jest.mock('@/modules/database/client', () => ({
  getPrismaClient: () => ({
    $queryRawUnsafe: (...args: unknown[]) => mockQuery(...args),
    $executeRawUnsafe: (...args: unknown[]) => mockExec(...args),
  }),
}));

const mockExtract = jest.fn();
jest.mock('@/modules/snapshot/numerize-client', () => ({
  extractFigures: (...args: unknown[]) => mockExtract(...args),
}));

jest.mock('@/config/index', () => ({
  config: {
    database: { url: 'postgresql://postgres:pass@127.0.0.1:5432/postgres', directUrl: undefined },
    app: { isDevelopment: true, isProduction: false, isTest: true },
    paths: { logs: '/tmp' },
  },
}));

import { getOrExtractSnapshots } from '../../../src/modules/snapshot/get-or-extract';

const VID = 'dQw4w9WgXcQ';

const cacheRow = (ts: number, kind: string, extra: Record<string, unknown> = {}) => ({
  video_id: VID,
  ts_sec: ts,
  kind,
  struct: null,
  latex: null,
  asset_path: null,
  verification_status: 'unverified',
  source: 'manual-warm',
  ...extra,
});

beforeEach(() => {
  mockQuery.mockReset();
  mockExec.mockClear();
  mockExtract.mockReset();
});

describe('get-or-extract', () => {
  it('serves from cache WITHOUT calling the extractor when all ts are cached', async () => {
    mockQuery.mockResolvedValue([
      cacheRow(10, 'diagram', { struct: { nodes: 3 } }),
      cacheRow(20, 'equation', { latex: 'x^2' }),
    ]);

    const figs = await getOrExtractSnapshots(VID, [10, 20]);

    expect(mockExtract).not.toHaveBeenCalled(); // independence
    expect(mockExec).not.toHaveBeenCalled(); // no upsert on pure hit
    expect(figs).toHaveLength(2);
    expect(figs.find((f) => f.tsSec === 10)?.struct).toEqual({ nodes: 3 });
    expect(figs.find((f) => f.tsSec === 20)?.latex).toBe('x^2');
  });

  it('queries the cache content-scoped by (video_id, ts) — no user/mandala key', async () => {
    mockQuery.mockResolvedValue([]);
    mockExtract.mockResolvedValue([]);
    await getOrExtractSnapshots(VID, [42]);
    const [sql, vid, tsArr] = mockQuery.mock.calls[0]!;
    expect(sql).toContain('FROM video_figure_snapshots');
    expect(sql).toContain('WHERE video_id = $1 AND ts_sec = ANY($2::int[])');
    expect(sql).not.toMatch(/user_id|mandala_id/);
    expect(vid).toBe(VID);
    expect(tsArr).toEqual([42]);
  });

  it('writes NOTHING and returns no figure when a miss yields no extraction (interpolation = 0)', async () => {
    mockQuery.mockResolvedValue([]); // nothing cached
    mockExtract.mockResolvedValue([]); // extractor honest-fails

    const figs = await getOrExtractSnapshots(VID, [5, 6]);

    expect(mockExtract).toHaveBeenCalledWith(VID, [5, 6]);
    expect(figs).toEqual([]); // no fabricated figures
    expect(mockExec).not.toHaveBeenCalled(); // nothing cached
  });

  it('extracts misses, upserts, and returns them', async () => {
    mockQuery.mockResolvedValue([]);
    mockExtract.mockResolvedValue([
      {
        videoId: VID,
        tsSec: 7,
        kind: 'chart',
        struct: { bars: 4 },
        verificationStatus: 'unverified',
        source: 'numerize',
      },
    ]);

    const figs = await getOrExtractSnapshots(VID, [7]);

    expect(mockExec).toHaveBeenCalledTimes(1);
    const upsertSql = mockExec.mock.calls[0]![0] as string;
    expect(upsertSql).toContain('INSERT INTO video_figure_snapshots');
    expect(upsertSql).toContain('ON CONFLICT (video_id, ts_sec, kind)');
    expect(figs).toHaveLength(1);
    expect(figs[0]!.struct).toEqual({ bars: 4 });
  });

  it('only extracts the MISSING timestamps on a partial cache hit', async () => {
    mockQuery.mockResolvedValue([cacheRow(10, 'table', { struct: { rows: 2 } })]);
    mockExtract.mockResolvedValue([]); // 20 missing → extractor returns nothing

    const figs = await getOrExtractSnapshots(VID, [10, 20]);

    expect(mockExtract).toHaveBeenCalledWith(VID, [20]); // only the miss
    expect(figs).toHaveLength(1); // the cached one only (20 honest-absent)
    expect(figs[0]!.tsSec).toBe(10);
  });
});
