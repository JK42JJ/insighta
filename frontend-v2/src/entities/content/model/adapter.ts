import type { ContentEntity, ContentEntityRow, SourceType } from './types';

export interface ContentMetadata {
  title: string;
  thumbnail: string | null;
  description: string | null;
  author: string | null;
  siteName: string | null;
}

export interface SourceAdapter<TRaw = unknown> {
  readonly sourceType: SourceType;
  canHandle(url: string): boolean;
  fetchMetadata(url: string): Promise<ContentMetadata>;
  toEntity(raw: TRaw, userId: string): ContentEntity;
  toRow(entity: ContentEntity): ContentEntityRow;
}
