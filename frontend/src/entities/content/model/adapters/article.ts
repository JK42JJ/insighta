import type { SourceAdapter, ContentMetadata } from '../adapter';
import type { ContentEntity, ContentEntityRow, ArticleMetadata } from '../types';

const ARTICLE_EXCLUDE_PATTERNS = [/youtube\.com/, /youtu\.be/];

function detectPlatform(url: string): ArticleMetadata['platform'] {
  if (/linkedin\.com/.test(url)) return 'linkedin';
  if (/notion\.so/.test(url)) return 'notion';
  if (/medium\.com/.test(url)) return 'medium';
  return 'web';
}

export const ArticleAdapter: SourceAdapter<{
  url: string;
  title?: string;
  metadata?: ContentMetadata;
}> = {
  sourceType: 'article',

  canHandle(url: string): boolean {
    try {
      new URL(url);
      return !ARTICLE_EXCLUDE_PATTERNS.some((p) => p.test(url));
    } catch {
      return false;
    }
  },

  async fetchMetadata(url: string): Promise<ContentMetadata> {
    // Skeleton: actual OG metadata fetching will be implemented via Edge Function
    const platform = detectPlatform(url);
    return {
      title: '',
      thumbnail: null,
      description: null,
      author: null,
      siteName: platform,
    };
  },

  toEntity(
    raw: { url: string; title?: string; metadata?: ContentMetadata },
    userId: string
  ): ContentEntity {
    const platform = detectPlatform(raw.url);
    const metadata: ArticleMetadata = {
      platform,
      author: raw.metadata?.author ?? undefined,
      description: raw.metadata?.description ?? undefined,
      site_name: raw.metadata?.siteName ?? undefined,
      og_image: raw.metadata?.thumbnail ?? undefined,
    };

    return {
      id: crypto.randomUUID(),
      userId,
      sourceType: 'article',
      title: raw.title || raw.metadata?.title || '',
      sourceUrl: raw.url,
      sourceId: null,
      thumbnail: raw.metadata?.thumbnail ?? null,
      notes: null,
      tags: [],
      cellIndex: -1,
      levelId: 'scratchpad',
      mandalaId: null,
      sortOrder: null,
      createdAt: new Date(),
      updatedAt: new Date(),
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
