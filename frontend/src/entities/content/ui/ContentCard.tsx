import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/utils';
import type { InsightCard } from '@/entities/card/model/types';
import { upgradeYouTubeThumbnail, handleThumbnailError } from '@/shared/lib/image-utils';
import { linkTypeToSourceType } from '../model/converters';
import { SourceTypeBadge } from './SourceTypeBadge';
import {
  cardRendererRegistry,
  type CardView,
  type CardRendererProps,
} from './CardRendererRegistry';

interface ContentCardProps {
  card: InsightCard;
  view: CardView;
  onClick?: (e: React.MouseEvent) => void;
  className?: string;
}

function toRendererCard(card: InsightCard): CardRendererProps['card'] {
  return {
    id: card.id,
    title: card.title,
    thumbnail: card.thumbnail,
    sourceUrl: card.videoUrl,
    userNote: card.userNote,
    createdAt: card.createdAt,
    sourceType: linkTypeToSourceType(card.linkType ?? 'other'),
    metadata: card.metadata as unknown as Record<string, unknown> | null,
  };
}

export const ContentCard = memo(function ContentCard({
  card,
  view,
  onClick,
  className,
}: ContentCardProps) {
  const { t } = useTranslation();
  const rendererCard = toRendererCard(card);
  const sourceType = rendererCard.sourceType;
  const Renderer = cardRendererRegistry.get(sourceType);

  if (view === 'list') {
    return (
      <div
        onClick={onClick}
        className={cn(
          'flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors hover:bg-muted/50',
          className
        )}
      >
        {/* Thumbnail */}
        <div className="flex-shrink-0 w-12 h-9 rounded overflow-hidden bg-muted">
          {card.thumbnail ? (
            <img
              src={upgradeYouTubeThumbnail(card.thumbnail) ?? card.thumbnail}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
              onError={handleThumbnailError}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
              --
            </div>
          )}
        </div>

        {/* Title + source meta */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{card.title || t('cards.untitled')}</p>
          {Renderer && <Renderer card={rendererCard} view={view} />}
        </div>

        {/* Badge */}
        <div className="flex-shrink-0">
          {card.linkType && <SourceTypeBadge linkType={card.linkType} />}
        </div>
      </div>
    );
  }

  if (view === 'compact') {
    return (
      <div
        onClick={onClick}
        className={cn(
          'group relative overflow-hidden rounded-lg bg-card border border-border shadow-sm',
          className
        )}
      >
        <div className="relative aspect-video overflow-hidden">
          <img
            src={upgradeYouTubeThumbnail(card.thumbnail) ?? card.thumbnail}
            alt={card.title}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={handleThumbnailError}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-foreground/70 to-transparent" />
          <h3 className="absolute bottom-1 left-1 right-1 text-xs font-medium text-primary-foreground line-clamp-2 leading-tight">
            {card.title}
          </h3>
        </div>
        <div className="p-1.5">{Renderer && <Renderer card={rendererCard} view={view} />}</div>
      </div>
    );
  }

  if (view === 'detail') {
    return (
      <div className={cn('space-y-3', className)}>
        {/* Thumbnail */}
        {card.thumbnail && (
          <div
            className="w-full aspect-video rounded-lg overflow-hidden bg-muted cursor-pointer"
            onClick={onClick}
          >
            <img
              src={upgradeYouTubeThumbnail(card.thumbnail) ?? card.thumbnail}
              alt={card.title}
              className="w-full h-full object-cover hover:scale-105 transition-transform"
              onError={handleThumbnailError}
            />
          </div>
        )}

        {/* Title */}
        <h3 className="text-base font-semibold leading-tight">
          {card.title || t('cards.untitled')}
        </h3>

        {/* Source meta + badge */}
        <div className="flex items-center gap-2">
          {card.linkType && <SourceTypeBadge linkType={card.linkType} />}
          {Renderer && <Renderer card={rendererCard} view={view} />}
        </div>
      </div>
    );
  }

  // grid (default)
  return (
    <div
      onClick={onClick}
      className={cn(
        'group relative overflow-hidden rounded-xl bg-card border shadow-sm',
        className
      )}
    >
      {/* Thumbnail */}
      <div className="relative aspect-video overflow-hidden rounded-t-xl">
        <img
          src={upgradeYouTubeThumbnail(card.thumbnail) ?? card.thumbnail}
          alt={card.title}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={handleThumbnailError}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-foreground/70 to-transparent" />
        <h4 className="absolute bottom-1 left-1.5 right-1.5 text-xs font-medium text-primary-foreground line-clamp-2 leading-tight">
          {card.title}
        </h4>
      </div>

      {/* Meta area */}
      <div className="p-2 space-y-1">
        {Renderer && <Renderer card={rendererCard} view={view} />}
        <div className="flex items-center gap-1.5">
          {card.linkType && <SourceTypeBadge linkType={card.linkType} />}
          {card.userNote && (
            <p className="text-xs text-muted-foreground line-clamp-1 flex-1">{card.userNote}</p>
          )}
        </div>
      </div>
    </div>
  );
});
