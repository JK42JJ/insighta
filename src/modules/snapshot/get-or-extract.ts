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
// ts (subtitle/atom time); numerize returns it within ±this window. Cache lookup +
// attach match by window, not exact ts. ★ KEEP IN SYNC with slidegen NUMERIZE_WINDOW_SEC
// (app.py / numerize_job.py) — widened 10→30s (CP505) so a slide shown near the topic
// discussion (not exactly at the subtitle ts) is still matched. no-fallback safety
// holds: a figure >30s from any requested ts is still excluded (no 619-style leak).
const FIGURE_TS_WINDOW_SEC = 30;

// Negative-cache sentinel: a requested ts that yielded NO figure gets a marker row
// (CP505) so future calls skip the expensive (~148s) re-extract instead of probing
// the same empty ts every run. Excluded from returned figures; expires via expires_at.
const NEGATIVE_KIND = '__none__';

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

/** Upsert a negative-cache sentinel for a ts that yielded no figure. */
async function upsertSentinel(prisma: PrismaLike, videoId: string, tsSec: number): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO video_figure_snapshots
       (video_id, ts_sec, kind, struct, latex, asset_path, verification_status, source, computed_at)
     VALUES ($1, $2, $3, NULL, NULL, NULL, $4, $5, NOW())
     ON CONFLICT (video_id, ts_sec, kind) DO UPDATE SET
       computed_at = NOW()`,
    videoId,
    tsSec,
    NEGATIVE_KIND,
    'none',
    'negative-cache'
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
  // Sentinel rows (NEGATIVE_KIND) are intentionally included here so they count as
  // "covered" in the missingTs filter below — preventing re-extraction of known-empty ts.
  const cached = await prisma.$queryRawUnsafe<CacheRow[]>(
    `SELECT video_id, ts_sec, kind, struct, latex, asset_path, verification_status, source
     FROM video_figure_snapshots
     WHERE video_id = $1 AND expires_at > NOW()
       AND EXISTS (SELECT 1 FROM unnest($2::int[]) t WHERE ts_sec BETWEEN t - $3 AND t + $3)`,
    videoId,
    uniqueTs,
    FIGURE_TS_WINDOW_SEC
  );

  // Exclude sentinel rows from results — they mark "no figure here" but are not figures.
  const result: FigureRef[] = cached.filter((r) => r.kind !== NEGATIVE_KIND).map(rowToFigure);

  // EXTRACT — only requested ts with NO cached figure (or sentinel) within the window.
  const missingTs = uniqueTs.filter(
    (t) => !cached.some((r) => Math.abs(r.ts_sec - t) <= FIGURE_TS_WINDOW_SEC)
  );
  if (missingTs.length > 0) {
    const extracted = await extractFigures(videoId, missingTs);
    for (const fig of extracted) {
      await upsertFigure(prisma, fig);
      result.push(fig);
    }

    // Write negative-cache sentinels for each requested ts that got no figure.
    // Future calls skip re-extraction for these ts values (expensive ~148s pipeline).
    let sentinelWritten = 0;
    for (const ts of missingTs) {
      const covered = extracted.some((f) => Math.abs(f.tsSec - ts) <= FIGURE_TS_WINDOW_SEC);
      if (!covered) {
        await upsertSentinel(prisma, videoId, ts);
        sentinelWritten++;
      }
    }

    log.info('get-or-extract', {
      videoId,
      requested: uniqueTs.length,
      cacheHit: cached.length,
      extracted: extracted.length,
      sentinelWritten,
    });
  }

  return result;
}
