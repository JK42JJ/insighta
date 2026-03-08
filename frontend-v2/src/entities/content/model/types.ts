export type SourceType = 'youtube' | 'article' | 'podcast' | 'book';

export interface YouTubeMetadata {
  youtube_video_id: string;
  channel_title?: string;
  duration_seconds?: number;
  view_count?: number;
  like_count?: number;
  published_at?: string;
  platform: 'youtube';
}

export interface ArticleMetadata {
  platform: 'linkedin' | 'notion' | 'medium' | 'web';
  author?: string;
  description?: string;
  site_name?: string;
  og_image?: string;
}

export interface PodcastMetadata {
  platform: 'spotify' | 'apple' | 'rss';
  episode_number?: number;
  season_number?: number;
  duration_seconds?: number;
  show_title?: string;
}

export interface BookMetadata {
  isbn?: string;
  author?: string;
  publisher?: string;
  page_count?: number;
  format: 'pdf' | 'epub' | 'physical';
}

interface ContentEntityBase {
  id: string;
  userId: string;
  title: string;
  sourceUrl: string;
  sourceId: string | null;
  thumbnail: string | null;
  notes: string | null;
  tags: string[];
  cellIndex: number;
  levelId: string;
  mandalaId: string | null;
  sortOrder: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface YouTubeEntity extends ContentEntityBase {
  sourceType: 'youtube';
  metadata: YouTubeMetadata | null;
}

export interface ArticleEntity extends ContentEntityBase {
  sourceType: 'article';
  metadata: ArticleMetadata | null;
}

export interface PodcastEntity extends ContentEntityBase {
  sourceType: 'podcast';
  metadata: PodcastMetadata | null;
}

export interface BookEntity extends ContentEntityBase {
  sourceType: 'book';
  metadata: BookMetadata | null;
}

export type ContentEntity = YouTubeEntity | ArticleEntity | PodcastEntity | BookEntity;

export interface ContentEntityRow {
  id: string;
  user_id: string;
  source_type: SourceType;
  title: string;
  source_url: string;
  source_id: string | null;
  thumbnail: string | null;
  notes: string | null;
  tags: string[];
  metadata: Record<string, unknown> | null;
  cell_index: number;
  level_id: string;
  mandala_id: string | null;
  sort_order: number | null;
  created_at: string;
  updated_at: string;
}
