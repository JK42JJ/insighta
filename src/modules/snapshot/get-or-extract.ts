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

  // GET — serve from cache (non-expired). Independent of the extractor.
  const cached = await prisma.$queryRawUnsafe<CacheRow[]>(
    `SELECT video_id, ts_sec, kind, struct, latex, asset_path, verification_status, source
     FROM video_figure_snapshots
     WHERE video_id = $1 AND ts_sec = ANY($2::int[]) AND expires_at > NOW()`,
    videoId,
    uniqueTs
  );
  const cachedTs = new Set(cached.map((r) => r.ts_sec));
  const result: FigureRef[] = cached.map(rowToFigure);

  // EXTRACT — only the missing timestamps. Empty result ⇒ those ts stay absent.
  const missingTs = uniqueTs.filter((t) => !cachedTs.has(t));
  if (missingTs.length > 0) {
    const extracted = await extractFigures(videoId, missingTs);
    for (const fig of extracted) {
      await upsertFigure(prisma, fig);
      result.push(fig);
    }
    log.info('get-or-extract', {
      videoId,
      requested: uniqueTs.length,
      cacheHit: cachedTs.size,
      extracted: extracted.length,
    });
  }

  return result;
}
