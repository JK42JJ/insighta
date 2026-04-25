import type { InsightCard } from '@/entities/card/model/types';
import type { RecommendationItem } from '../model/useRecommendations';

const YOUTUBE_WATCH_URL = 'https://www.youtube.com/watch?v=';

export function recommendationToInsightCard(
  rec: RecommendationItem,
  mandalaId: string
): InsightCard {
  return {
    id: `stream-${rec.id}`,
    videoUrl: `${YOUTUBE_WATCH_URL}${rec.videoId}`,
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
  };
}
