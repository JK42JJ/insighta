import type { InsightCard, LinkType, UrlMetadata } from '@/entities/card';
import type {
  ArticleMetadata,
  BookMetadata,
  ContentEntity,
  ContentEntityRow,
  PodcastMetadata,
  SourceType,
  YouTubeMetadata,
} from './types';

export function linkTypeToSourceType(linkType: LinkType): SourceType {
  switch (linkType) {
    case 'youtube':
    case 'youtube-shorts':
      return 'youtube';
    case 'pdf':
      return 'book';
    case 'linkedin':
    case 'facebook':
    case 'notion':
    case 'txt':
    case 'md':
    case 'other':
    default:
      return 'article';
  }
}

export function sourceTypeToLinkType(
  sourceType: SourceType,
  metadata?: Record<string, unknown> | null,
): LinkType {
  switch (sourceType) {
    case 'youtube':
      return 'youtube';
    case 'book':
      return 'pdf';
    case 'podcast':
      return 'other';
    case 'article': {
      const platform = metadata?.platform as string | undefined;
      if (platform === 'linkedin') return 'linkedin';
      if (platform === 'notion') return 'notion';
      return 'other';
    }
    default:
      return 'other';
  }
}

export function contentEntityToInsightCard(entity: ContentEntity): InsightCard {
  const linkType = sourceTypeToLinkType(
    entity.sourceType,
    entity.metadata as unknown as Record<string, unknown> | null,
  );

  let metadata: UrlMetadata | undefined;
  if (entity.sourceType === 'article' && entity.metadata) {
    metadata = {
      title: entity.title,
      description: entity.metadata.description || '',
      image: entity.metadata.og_image || '',
      siteName: entity.metadata.site_name || '',
      author: entity.metadata.author || '',
      url: entity.sourceUrl,
    };
  } else if (entity.sourceType === 'youtube' && entity.metadata) {
    metadata = {
      title: entity.title,
      description: '',
      image: entity.thumbnail || '',
      siteName: 'YouTube',
      author: entity.metadata.channel_title || '',
      url: entity.sourceUrl,
    };
  }

  return {
    id: entity.id,
    videoUrl: entity.sourceUrl,
    title: entity.title,
    thumbnail: entity.thumbnail || '',
    userNote: entity.notes || '',
    createdAt: entity.createdAt,
    cellIndex: entity.cellIndex,
    levelId: entity.levelId,
    sortOrder: entity.sortOrder ?? undefined,
    linkType,
    metadata,
    lastWatchPosition:
      entity.sourceType === 'youtube' && entity.metadata
        ? entity.metadata.duration_seconds
        : undefined,
    isInIdeation: entity.cellIndex === -1,
  };
}

export function insightCardToContentEntityRow(
  card: InsightCard,
  userId: string,
): ContentEntityRow {
  const sourceType = linkTypeToSourceType(card.linkType || 'other');

  let metadata: Record<string, unknown> | null = null;
  if (sourceType === 'youtube' && card.metadata) {
    metadata = {
      platform: 'youtube',
      channel_title: card.metadata.author || undefined,
    } satisfies Partial<YouTubeMetadata>;
  } else if (card.metadata) {
    metadata = {
      platform: 'web',
      description: card.metadata.description || undefined,
      site_name: card.metadata.siteName || undefined,
      og_image: card.metadata.image || undefined,
      author: card.metadata.author || undefined,
    };
  }

  return {
    id: card.id,
    user_id: userId,
    source_type: sourceType,
    title: card.title,
    source_url: card.videoUrl,
    source_id: null,
    thumbnail: card.thumbnail || null,
    notes: card.userNote || null,
    tags: [],
    metadata,
    cell_index: card.cellIndex,
    level_id: card.levelId,
    mandala_id: null,
    sort_order: card.sortOrder ?? null,
    created_at: card.createdAt.toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export function contentEntityRowToEntity(row: ContentEntityRow): ContentEntity {
  const base = {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    sourceUrl: row.source_url,
    sourceId: row.source_id,
    thumbnail: row.thumbnail,
    notes: row.notes,
    tags: row.tags,
    cellIndex: row.cell_index,
    levelId: row.level_id,
    mandalaId: row.mandala_id,
    sortOrder: row.sort_order,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  } as const;

  const md = row.metadata;

  switch (row.source_type) {
    case 'youtube':
      return { ...base, sourceType: 'youtube', metadata: md as unknown as YouTubeMetadata | null };
    case 'article':
      return { ...base, sourceType: 'article', metadata: md as unknown as ArticleMetadata | null };
    case 'podcast':
      return { ...base, sourceType: 'podcast', metadata: md as unknown as PodcastMetadata | null };
    case 'book':
      return { ...base, sourceType: 'book', metadata: md as unknown as BookMetadata | null };
    default:
      return { ...base, sourceType: 'article', metadata: md as unknown as ArticleMetadata | null };
  }
}
