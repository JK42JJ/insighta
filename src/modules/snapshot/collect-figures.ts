// D (figure → /slides/build) — collect a mandala's cached figures.
//
// Reads video_figure_snapshots for the mandala's placed videos and maps them to
// the build-service figures[] payload. INERT until the build-call site exists:
// nothing calls this yet (the POST /slides/build endpoint is not deployed on the
// slidegen service). When the deck-build step lands, it calls this to gather the
// figures it forwards. Read-only — no writes, no extraction (warming = C').

import { getPrismaClient } from '@/modules/database/client';
import { logger } from '@/utils/logger';
import {
  snapshotRowToBuildFigure,
  type BuildFigure,
  type SnapshotRow,
} from './figure-build-mapping';

const log = logger.child({ module: 'snapshot/collect-figures' });

/**
 * Gather build figures for a mandala: placed videos (uvs+ulc, cell_index>=0) →
 * their non-expired video_figure_snapshots → BuildFigure[]. Empty when the
 * warming (C') has not populated snapshots yet (no fabrication).
 */
export async function collectFiguresForMandala(mandalaId: string): Promise<BuildFigure[]> {
  const prisma = getPrismaClient();

  // Placed videos across both user-scoped tables (mirror fill-book enumeration).
  const [videoStates, localCards] = await Promise.all([
    prisma.userVideoState.findMany({
      where: { mandala_id: mandalaId, cell_index: { gte: 0 } },
      select: { video: { select: { youtube_video_id: true } } },
    }),
    prisma.user_local_cards.findMany({
      where: { mandala_id: mandalaId, cell_index: { gte: 0 } },
      select: { video_id: true },
    }),
  ]);

  const videoIds = Array.from(
    new Set([
      ...videoStates.map((r) => r.video?.youtube_video_id).filter((v): v is string => !!v),
      ...localCards.map((r) => r.video_id).filter((v): v is string => !!v),
    ])
  );
  if (videoIds.length === 0) return [];

  // Non-expired cached figures for those videos. Raw SQL (composite-key table).
  const rows = await prisma.$queryRawUnsafe<SnapshotRow[]>(
    `SELECT video_id, ts_sec, kind, struct, latex, asset_path
     FROM video_figure_snapshots
     WHERE video_id = ANY($1::text[]) AND expires_at > NOW()
     ORDER BY video_id, ts_sec, kind`,
    videoIds
  );

  const figures = rows.map(snapshotRowToBuildFigure);
  log.info('collect-figures', {
    mandalaId,
    placedVideos: videoIds.length,
    figures: figures.length,
  });
  return figures;
}
