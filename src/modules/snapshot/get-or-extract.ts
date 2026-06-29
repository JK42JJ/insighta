/**
 * get-or-extract (⑤) — serve cached figure snapshots, extracting on miss.
 *
 * Two independent halves:
 *   GET (serve-from-cache): reads video_figure_snapshots for the requested
 *     (video_id, ts). This works on its own — manual-warm rows are served with
 *     NO call to the extractor (demo safety net: warm the cache, serve from it).
 *   EXTRACT (on miss): only the timestamps with no cache row are sent to the
 *     numerize-client; whatever it returns is cached and appended.
 *
 * Interpolation = 0: a timestamp that is neither cached NOR produced by the
 * extractor contributes NOTHING to the result (no fabricated figure). The
 * extractor itself returns [] on any failure, so a cache-miss + extract-fail
 * simply yields no FigureRef for that ts.
 */

import { getPrismaClient } from '@/modules/database/client';
import { logger } from '@/utils/logger';
import { extractFigures } from './numerize-client';
import type { FigureKind, FigureRef } from './types';

const log = logger.child({ module: 'snapshot/get-or-extract' });

// A figure's stored ts (actual slide/figure location) rarely equals the requested
// ts (subtitle/atom time); numerize returns it within ±NUMERIZE_WINDOW_SEC (slidegen
// =10s). Cache lookup must match by window, not exact ts — exact match never hit a
// real figure (figure@184 vs request 150/190 → perpetual re-extract + 148s timeouts).
const FIGURE_TS_WINDOW_SEC = 10;

interface CacheRow {
  video_id: string;
  ts_sec: number;
  kind: string;
  struct: unknown;
  latex: string | null;
  asset_path: string | null;
  verification_status: string;
  source: string;
}

function rowToFigure(r: CacheRow): FigureRef {
  return {
    videoId: r.video_id,
    tsSec: r.ts_sec,
    kind: r.kind as FigureKind,
    ...(r.struct != null ? { struct: r.struct } : {}),
    ...(r.latex != null ? { latex: r.latex } : {}),
    ...(r.asset_path != null ? { assetPath: r.asset_path } : {}),
    verificationStatus: r.verification_status,
    source: r.source,
  };
}

type PrismaLike = {
  $queryRawUnsafe: <T>(sql: string, ...args: unknown[]) => Promise<T>;
  $executeRawUnsafe: (sql: string, ...args: unknown[]) => Promise<number>;
};

async function upsertFigure(prisma: PrismaLike, f: FigureRef): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO video_figure_snapshots
       (video_id, ts_sec, kind, struct, latex, asset_path, verification_status, source, computed_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, NOW())
     ON CONFLICT (video_id, ts_sec, kind) DO UPDATE SET
       struct              = EXCLUDED.struct,
       latex               = EXCLUDED.latex,
       asset_path          = EXCLUDED.asset_path,
       verification_status = EXCLUDED.verification_status,
       source              = EXCLUDED.source,
       computed_at         = NOW()`,
    f.videoId,
    f.tsSec,
    f.kind,
    f.struct !== undefined ? JSON.stringify(f.struct) : null,
    f.latex ?? null,
    f.assetPath ?? null,
    f.verificationStatus,
    f.source
  );
}

/**
 * Return cached figures for the given timestamps, extracting (and caching) only
 * the timestamps that have no live cache row.
 */
export async function getOrExtractSnapshots(
  videoId: string,
  tsList: number[]
): Promise<FigureRef[]> {
  const prisma = getPrismaClient() as unknown as PrismaLike;
  const uniqueTs = Array.from(new Set(tsList.filter((t) => Number.isFinite(t))));
  if (uniqueTs.length === 0) return [];

  // GET — serve cached figures within ±FIGURE_TS_WINDOW_SEC of any requested ts
  // (not exact ts — see const note). Non-expired only. Independent of the extractor.
  const cached = await prisma.$queryRawUnsafe<CacheRow[]>(
    `SELECT video_id, ts_sec, kind, struct, latex, asset_path, verification_status, source
     FROM video_figure_snapshots
     WHERE video_id = $1 AND expires_at > NOW()
       AND EXISTS (SELECT 1 FROM unnest($2::int[]) t WHERE ts_sec BETWEEN t - $3 AND t + $3)`,
    videoId,
    uniqueTs,
    FIGURE_TS_WINDOW_SEC
  );
  const result: FigureRef[] = cached.map(rowToFigure);

  // EXTRACT — only requested ts with NO cached figure within the window. A covered ts
  // (figure already within ±window) is NOT re-extracted (was: exact-ts miss → re-extract).
  const missingTs = uniqueTs.filter(
    (t) => !cached.some((r) => Math.abs(r.ts_sec - t) <= FIGURE_TS_WINDOW_SEC)
  );
  if (missingTs.length > 0) {
    const extracted = await extractFigures(videoId, missingTs);
    for (const fig of extracted) {
      await upsertFigure(prisma, fig);
      result.push(fig);
    }
    log.info('get-or-extract', {
      videoId,
      requested: uniqueTs.length,
      cacheHit: cached.length,
      extracted: extracted.length,
    });
  }

  return result;
}
