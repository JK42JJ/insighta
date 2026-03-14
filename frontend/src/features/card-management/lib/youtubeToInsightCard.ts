/**
 * YouTube Video to InsightCard Conversion Utility
 *
 * Converts YouTube video data from Supabase to InsightCard format
 * for use in the FloatingScratchPad component.
 */

import type { InsightCard, UrlMetadata } from '@/entities/card/model/types';
import type { UserVideoStateWithVideo, YouTubeVideo } from '@/entities/youtube/model/types';

/**
 * Converts a UserVideoStateWithVideo to InsightCard format
 */
export function convertToInsightCard(data: UserVideoStateWithVideo): InsightCard | null {
  const { video } = data;

  if (!video) {
    console.warn('convertToInsightCard: video data is missing', data.id);
    return null;
  }

  return {
    id: data.id,
    videoUrl: `https://www.youtube.com/watch?v=${video.youtube_video_id}`,
    title: video.title,
    thumbnail: video.thumbnail_url || '',
    userNote: data.user_note || '',
    createdAt: new Date(data.added_to_ideation_at),
    cellIndex: data.cell_index,
    levelId: data.level_id,
    mandalaId: data.mandala_id,
    sortOrder: data.sort_order ?? undefined,
    linkType: 'youtube',
    metadata: createVideoMetadata(video),
    lastWatchPosition: data.watch_position_seconds ?? undefined,
    isInIdeation: data.is_in_ideation,
  };
}

/**
 * Creates UrlMetadata from YouTubeVideo
 */
function createVideoMetadata(video: YouTubeVideo): UrlMetadata {
  return {
    title: video.title,
    description: video.description || '',
    image: video.thumbnail_url || '',
    siteName: 'YouTube',
    author: video.channel_title || '',
    url: `https://www.youtube.com/watch?v=${video.youtube_video_id}`,
  };
}

/**
 * Batch converts multiple UserVideoStateWithVideo to InsightCard[]
 * Filters out any null results from missing video data
 */
export function convertToInsightCards(data: UserVideoStateWithVideo[]): InsightCard[] {
  return data.map(convertToInsightCard).filter((card): card is InsightCard => card !== null);
}

/**
 * Converts an InsightCard back to UserVideoState update format
 * Used when saving changes made in the UI back to Supabase
 */
export function convertToVideoStateUpdate(card: InsightCard): {
  videoStateId: string;
  updates: {
    user_note?: string;
    cell_index?: number;
    level_id?: string;
    sort_order?: number;
  };
} {
  return {
    videoStateId: card.id,
    updates: {
      user_note: card.userNote || undefined,
      cell_index: card.cellIndex,
      level_id: card.levelId,
      sort_order: card.sortOrder,
    },
  };
}

/**
 * Extracts YouTube video ID from various YouTube URL formats
 */
export function extractYouTubeVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&?/]+)/,
    /youtube\.com\/shorts\/([^&?/]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

/**
 * Formats video duration from seconds to human-readable string
 */
export function formatDuration(seconds: number | null): string {
  if (!seconds) return '';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}
