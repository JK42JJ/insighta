import type { SourceAdapter, ContentMetadata } from '../adapter';
import type { ContentEntity, ContentEntityRow, YouTubeMetadata } from '../types';
import type { UserVideoStateWithVideo } from '@/entities/youtube/model/types';

const YOUTUBE_URL_PATTERNS = [
  /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&?/]+)/,
  /youtube\.com\/shorts\/([^&?/]+)/,
];

function extractVideoId(url: string): string | null {
  for (const pattern of YOUTUBE_URL_PATTERNS) {
    const match = url.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

export const YouTubeAdapter: SourceAdapter<UserVideoStateWithVideo> = {
  sourceType: 'youtube',

  canHandle(url: string): boolean {
    return extractVideoId(url) !== null;
  },

  async fetchMetadata(url: string): Promise<ContentMetadata> {
    const videoId = extractVideoId(url);
    return {
      title: videoId ? `YouTube Video (${videoId})` : 'YouTube Video',
      thumbnail: videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null,
      description: null,
      author: null,
      siteName: 'YouTube',
    };
  },

  toEntity(raw: UserVideoStateWithVideo, userId: string): ContentEntity {
    const video = raw.video;
    const videoId = video?.youtube_video_id ?? '';

    const metadata: YouTubeMetadata | null = video
      ? {
          youtube_video_id: videoId,
          channel_title: video.channel_title ?? undefined,
          duration_seconds: video.duration_seconds ?? undefined,
          view_count: video.view_count ?? undefined,
          like_count: video.like_count ?? undefined,
          published_at: video.published_at ?? undefined,
          platform: 'youtube',
        }
      : null;

    return {
      id: raw.id,
      userId,
      sourceType: 'youtube',
      title: video?.title ?? '',
      sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
      sourceId: videoId || null,
      thumbnail: video?.thumbnail_url ?? null,
      notes: raw.user_note,
      tags: [],
      cellIndex: raw.cell_index,
      levelId: raw.level_id,
      mandalaId: null,
      sortOrder: raw.sort_order,
      createdAt: new Date(raw.added_to_ideation_at),
      updatedAt: new Date(raw.updated_at),
      metadata,
    };
  },

  toRow(entity: ContentEntity): ContentEntityRow {
    return {
      id: entity.id,
      user_id: entity.userId,
      source_type: entity.sourceType,
      title: entity.title,
      source_url: entity.sourceUrl,
      source_id: entity.sourceId,
      thumbnail: entity.thumbnail,
      notes: entity.notes,
      tags: entity.tags,
      metadata: entity.metadata as unknown as Record<string, unknown> | null,
      cell_index: entity.cellIndex,
      level_id: entity.levelId,
      mandala_id: entity.mandalaId,
      sort_order: entity.sortOrder,
      created_at: entity.createdAt.toISOString(),
      updated_at: entity.updatedAt.toISOString(),
    };
  },
};
