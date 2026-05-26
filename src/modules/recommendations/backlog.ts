/**
 * Recommendation Backlog — CP488 Phase 1a (D8 model)
 *
 * Splits "BE recommended" vs "FE surfaced":
 *   recommendation_cache.surfaced_at = NULL  → BE 추천했으나 아직 사용자
 *                                              화면 도달 X. backlog.
 *   recommendation_cache.surfaced_at = NOW() → 사용자 화면에 노출됨.
 *
 * Goal: 매 search call 이 60장 일관 노출하되, 이전 검색에서 사용자에게
 * 못 준 카드를 우선 소비하고 backlog 부족분만 새 fetch 로 채워 일관성을
 * 유지한다. dashboard reload 는 새 검색이 아니므로, backlog 비었을 때는
 * 이미 surfaced 된 카드를 score-desc 로 fallback 제공해서 화면이 비지 X.
 *
 * Used by:
 *   - GET /api/v1/mandalas/:id/recommendations
 *   - GET /api/v1/mandalas/:id/videos/stream  (SSE backlog emit)
 *   - POST /api/v1/mandalas/:id/add-cards     (Phase 1c — to wire up next)
 */

import { getPrismaClient } from '@/modules/database';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'recommendations/backlog' });

export interface PickOpts {
  userId: string;
  mandalaId: string;
  limit?: number;
}

export interface PickedRow {
  id: string;
  user_id: string;
  mandala_id: string;
  cell_index: number | null;
  keyword: string;
  video_id: string;
  title: string;
  thumbnail: string | null;
  channel: string | null;
  view_count: number | null;
  duration_sec: number | null;
  rec_score: number;
  rec_reason: string | null;
  weight_version: number;
  expires_at: Date;
  published_at: Date | null;
  surfaced_at: Date | null;
  __from_backlog: boolean;
}

/**
 * Pick up to `limit` rows preferring unsurfaced backlog, then fall back to
 * already-surfaced rows (no re-mark). NEVER throws — read failures yield [].
 */
export async function pickRecommendations(opts: PickOpts): Promise<PickedRow[]> {
  const limit = opts.limit ?? 60;
  const prisma = getPrismaClient();
  const now = new Date();

  try {
    const unsurfaced = await prisma.recommendation_cache.findMany({
      where: {
        user_id: opts.userId,
        mandala_id: opts.mandalaId,
        surfaced_at: null,
        expires_at: { gt: now },
      },
      orderBy: [{ rec_score: 'desc' }, { cell_index: 'asc' }, { id: 'asc' }],
      take: limit,
    });

    const unsurfacedRows: PickedRow[] = unsurfaced.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      mandala_id: r.mandala_id,
      cell_index: r.cell_index,
      keyword: r.keyword,
      video_id: r.video_id,
      title: r.title,
      thumbnail: r.thumbnail,
      channel: r.channel,
      view_count: r.view_count,
      duration_sec: r.duration_sec,
      rec_score: r.rec_score,
      rec_reason: r.rec_reason,
      weight_version: r.weight_version,
      expires_at: r.expires_at,
      published_at: r.published_at,
      surfaced_at: r.surfaced_at,
      __from_backlog: true,
    }));

    if (unsurfacedRows.length >= limit) {
      return unsurfacedRows;
    }

    const deficit = limit - unsurfacedRows.length;
    const filled = await prisma.recommendation_cache.findMany({
      where: {
        user_id: opts.userId,
        mandala_id: opts.mandalaId,
        surfaced_at: { not: null },
        expires_at: { gt: now },
      },
      orderBy: [{ rec_score: 'desc' }, { cell_index: 'asc' }, { id: 'asc' }],
      take: deficit,
    });

    const filledRows: PickedRow[] = filled.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      mandala_id: r.mandala_id,
      cell_index: r.cell_index,
      keyword: r.keyword,
      video_id: r.video_id,
      title: r.title,
      thumbnail: r.thumbnail,
      channel: r.channel,
      view_count: r.view_count,
      duration_sec: r.duration_sec,
      rec_score: r.rec_score,
      rec_reason: r.rec_reason,
      weight_version: r.weight_version,
      expires_at: r.expires_at,
      published_at: r.published_at,
      surfaced_at: r.surfaced_at,
      __from_backlog: false,
    }));

    return [...unsurfacedRows, ...filledRows];
  } catch (err) {
    log.warn(
      `pickRecommendations failed user=${opts.userId} mandala=${opts.mandalaId}: ${err instanceof Error ? err.message : String(err)}`
    );
    return [];
  }
}

/**
 * Stamp surfaced_at on the given ids (only rows still NULL — no re-mark of
 * already-surfaced). Fire-and-forget callable: caller may `void markSurfaced(...)`
 * after sending the HTTP response. Returns the count of rows actually updated.
 */
export async function markSurfaced(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const prisma = getPrismaClient();
  try {
    const result = await prisma.recommendation_cache.updateMany({
      where: { id: { in: ids }, surfaced_at: null },
      data: { surfaced_at: new Date() },
    });
    return result.count;
  } catch (err) {
    log.warn(
      `markSurfaced failed ids=${ids.length}: ${err instanceof Error ? err.message : String(err)}`
    );
    return 0;
  }
}
