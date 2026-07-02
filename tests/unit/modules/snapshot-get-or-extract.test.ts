/**
 * get-or-extract (⑤) tests — invariants James reviews before merge:
 *   (a) windowed cache hit — figure within ±30s of requested ts is served without extraction;
 *   (b) interpolation = 0 — a cache-miss whose extraction yields nothing contributes NO
 *       figure (no fabrication); sentinels ARE written for the empty ts;
 *   (c) serve-from-cache is independent of extract — when every requested ts is cached,
 *       the extractor is NEVER called;
 *   (d) negative-cache sentinel prevents re-extract — a sentinel row within window marks
 *       the ts "covered" so it is skipped on a subsequent call;
 *   (e) sentinel excluded from FigureRef results;
 *   plus: cache miss → extract → upsert → return; partial hit only extracts missing ts.
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

  it('uses a windowed query (±30s) and the SQL is scoped to (video_id, ts) — no user/mandala key', async () => {
    mockQuery.mockResolvedValue([]);
    mockExtract.mockResolvedValue([]);
    await getOrExtractSnapshots(VID, [42]);
    const [sql, vid, tsArr, windowSec] = mockQuery.mock.calls[0]!;
    expect(sql).toContain('FROM video_figure_snapshots');
    // Windowed window query — not the old exact ts_sec = ANY pattern.
    expect(sql).toContain('unnest($2::int[])');
    expect(sql).toContain('BETWEEN t - $3 AND t + $3');
    expect(sql).not.toMatch(/user_id|mandala_id/);
    expect(vid).toBe(VID);
    expect(tsArr).toEqual([42]);
    expect(windowSec).toBe(30);
  });

  it('(a) windowed cache hit — figure at ts=50 covers requested ts=60 within ±30s', async () => {
    // Figure stored at ts=50; request is for ts=60 (delta=10 ≤ 30).
    mockQuery.mockResolvedValue([cacheRow(50, 'chart', { struct: { bars: 2 } })]);

    const figs = await getOrExtractSnapshots(VID, [60]);

    expect(mockExtract).not.toHaveBeenCalled(); // covered by window — no extraction
    expect(mockExec).not.toHaveBeenCalled();
    expect(figs).toHaveLength(1);
    expect(figs[0]!.tsSec).toBe(50);
  });

  it('(b) writes sentinels but returns no figure when a miss yields no extraction (interpolation = 0)', async () => {
    mockQuery.mockResolvedValue([]); // nothing cached
    mockExtract.mockResolvedValue([]); // extractor honest-fails

    const figs = await getOrExtractSnapshots(VID, [5, 6]);

    expect(mockExtract).toHaveBeenCalledWith(VID, [5, 6]);
    expect(figs).toEqual([]); // no fabricated figures

    // Sentinels upserted for ts=5 and ts=6 to prevent future re-extraction.
    // CP505 (#1011 f32d0161): upsertSentinel params follow the SQL column order
    // (get-or-extract.ts:90) — $1 videoId, $2 tsSec, $3 kind, $4 status, $5 source.
    expect(mockExec).toHaveBeenCalledTimes(2);
    const firstCall = mockExec.mock.calls[0]!;
    expect(firstCall[2]).toBe(5); // ts_sec param
    expect(firstCall[3]).toBe('__none__'); // kind param is the sentinel marker
    expect(firstCall[5]).toBe('negative-cache'); // source param
  });

  it('(d) negative-cache sentinel within window prevents re-extraction', async () => {
    // A sentinel at ts=100 covers a future request for ts=110 (delta=10 ≤ 30).
    mockQuery.mockResolvedValue([cacheRow(100, '__none__')]);

    const figs = await getOrExtractSnapshots(VID, [110]);

    expect(mockExtract).not.toHaveBeenCalled(); // sentinel acts as "covered"
    expect(mockExec).not.toHaveBeenCalled();
    expect(figs).toHaveLength(0); // sentinel is not a real figure
  });

  it('(e) sentinel rows are excluded from returned FigureRefs', async () => {
    // Cache has one sentinel and one real figure for different ts ranges.
    mockQuery.mockResolvedValue([
      cacheRow(100, '__none__'), // sentinel
      cacheRow(200, 'table', { struct: { rows: 3 } }), // real figure
    ]);

    const figs = await getOrExtractSnapshots(VID, [100, 200]);

    expect(mockExtract).not.toHaveBeenCalled();
    expect(figs).toHaveLength(1); // only the real figure
    expect(figs[0]!.tsSec).toBe(200);
    expect(figs[0]!.kind).toBe('table');
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

    // One upsert for the real figure (ts=7 is covered by extracted → no sentinel).
    expect(mockExec).toHaveBeenCalledTimes(1);
    const upsertSql = mockExec.mock.calls[0]![0] as string;
    expect(upsertSql).toContain('INSERT INTO video_figure_snapshots');
    expect(upsertSql).toContain('ON CONFLICT (video_id, ts_sec, kind)');
    expect(figs).toHaveLength(1);
    expect(figs[0]!.struct).toEqual({ bars: 4 });
  });

  it('only extracts the MISSING timestamps on a partial cache hit', async () => {
    // ts=10 cached; ts=500 is outside the 30s window of ts=10 → truly missing.
    mockQuery.mockResolvedValue([cacheRow(10, 'table', { struct: { rows: 2 } })]);
    mockExtract.mockResolvedValue([]); // ts=500 not found → sentinel upserted

    const figs = await getOrExtractSnapshots(VID, [10, 500]);

    expect(mockExtract).toHaveBeenCalledWith(VID, [500]); // only the miss
    // One sentinel for ts=500 (no extracted figure covered it).
    // CP505 (#1011 f32d0161): sentinel kind is param $3 (get-or-extract.ts:90).
    expect(mockExec).toHaveBeenCalledTimes(1);
    expect(mockExec.mock.calls[0]![2]).toBe(500); // ts_sec param
    expect(mockExec.mock.calls[0]![3]).toBe('__none__');
    expect(figs).toHaveLength(1); // only the cached ts=10 row
    expect(figs[0]!.tsSec).toBe(10);
  });
});
