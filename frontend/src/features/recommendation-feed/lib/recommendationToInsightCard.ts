import type { InsightCard } from '@/entities/card/model/types';
import type { RecommendationItem } from '../model/useRecommendations';

const YOUTUBE_WATCH_URL = 'https://www.youtube.com/watch?v=';

/**
 * Build the YouTube watch URL for a recommendation card.
 *
 * When `startSec` is a positive number, append `&t=<sec>s` so the user
 * lands at the relevant moment of the video (sourced from
 * `video_chunk_embeddings.start_time` via BE chunk anchor lookup,
 * hybrid-retrieval spec 2026-05-12 PR3).
 *
 * Exported for unit testing.
 */
export function buildVideoUrl(videoId: string, startSec: number | null | undefined): string {
  const base = `${YOUTUBE_WATCH_URL}${videoId}`;
  if (typeof startSec === 'number' && Number.isFinite(startSec) && startSec > 0) {
    return `${base}&t=${Math.floor(startSec)}s`;
  }
  return base;
}

export function recommendationToInsightCard(
  rec: RecommendationItem,
  mandalaId: string
): InsightCard {
  return {
    id: `stream-${rec.id}`,
    videoUrl: buildVideoUrl(rec.videoId, rec.startSec ?? null),
    title: rec.title,
    thumbnail: rec.thumbnail ?? '',
    userNote: '',
    createdAt: new Date(),
    publishedAt: (rec as Record<string, unknown>).publishedAt
      ? new Date((rec as Record<string, unknown>).publishedAt as string)
      : null,
    cellIndex: rec.cellIndex ?? -1,
    levelId: 'root',
    mandalaId,
    linkType: 'youtube',
    sourceTable: 'user_video_states',
    pinnedAt: rec.pinnedAt ?? null,
  };
}
