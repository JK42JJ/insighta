import type { InsightCard } from '@/entities/card/model/types';
import { linkTypeToSourceType } from '../model/converters';
import {
  cardRendererRegistry,
  type CardView,
  type CardRendererProps,
} from './CardRendererRegistry';

interface SourceMetaInfoProps {
  card: InsightCard;
  view?: CardView;
}

/**
 * Renders source-type-specific metadata (channel/duration for YouTube,
 * domain/reading-time for Article, etc.) using the CardRendererRegistry.
 * Drop-in component for existing card widgets that want source-specific info
 * without fully migrating to ContentCard.
 */
export function SourceMetaInfo({ card, view = 'grid' }: SourceMetaInfoProps) {
  const sourceType = linkTypeToSourceType(card.linkType ?? 'other');
  const Renderer = cardRendererRegistry.get(sourceType);
  if (!Renderer) return null;

  const rendererCard: CardRendererProps['card'] = {
    id: card.id,
    title: card.title,
    thumbnail: card.thumbnail,
    sourceUrl: card.videoUrl,
    userNote: card.userNote,
    createdAt: card.createdAt,
    sourceType,
    metadata: card.metadata as unknown as Record<string, unknown> | null,
  };

  return <Renderer card={rendererCard} view={view} />;
}
