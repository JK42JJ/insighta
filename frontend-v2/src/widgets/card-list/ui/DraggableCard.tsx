import { useDraggable } from '@dnd-kit/core';
import { InsightCard } from '@/entities/card/model/types';
import { GripVertical, ExternalLink } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { type DragData, cardDragId } from '@/shared/lib/dnd';
import { linkTypeToSourceType } from '@/entities/content';
import { LazyImage } from '@/shared/ui/lazy-image';
import { generateThumbnailSrcSet, DEFAULT_SIZES } from '@/shared/lib/image-utils';

interface DraggableCardProps {
  card: InsightCard;
  onClick: () => void;
  onDragStart: () => void;
  compact?: boolean;
}

export function DraggableCard({ card, onClick, compact = false }: DraggableCardProps) {
  const { t } = useTranslation();

  const dragData: DragData = { type: 'card', card };
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: cardDragId(card.id),
    data: dragData,
  });

  const handleShareToX = (e: React.MouseEvent) => {
    e.stopPropagation();
    const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/;
    const linkMatch = card.userNote?.match(linkPattern);

    let shareUrl: string;
    let shareText: string;

    if (linkMatch) {
      const linkLabel = linkMatch[1];
      const linkUrl = linkMatch[2];
      const memoWithoutLink = card.userNote!.replace(linkMatch[0], '').trim();
      shareText = memoWithoutLink ? `${linkLabel} ${memoWithoutLink}` : linkLabel;
      shareUrl = linkUrl;
    } else {
      shareText = card.title || 'Check out this video!';
      shareUrl = card.videoUrl;
    }

    const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`;
    window.open(twitterUrl, '_blank', 'noopener,noreferrer,width=550,height=420');
    toast.success(t('videoPlayer.xShareOpened'));
  };

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      onClick={onClick}
      className={cn(
        'group relative overflow-hidden rounded-lg bg-card border border-border shadow-sm transition-all duration-200',
        'hover:shadow-md hover:border-primary/30 hover:scale-[1.02]',
        isDragging && 'opacity-30',
        compact ? 'p-2' : ''
      )}
    >
      {/* Drag Handle — only this triggers dnd-kit drag */}
      <div
        {...listeners}
        data-dnd-handle
        className="absolute top-1 left-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing"
      >
        <div className="bg-background/80 backdrop-blur-sm rounded p-0.5">
          <GripVertical className="w-3 h-3 text-muted-foreground" />
        </div>
      </div>

      {/* Thumbnail */}
      <div
        className={cn(
          'relative overflow-hidden',
          compact ? 'aspect-video rounded' : 'aspect-video'
        )}
      >
        <LazyImage
          src={card.thumbnail}
          alt={card.title}
          srcSet={generateThumbnailSrcSet(card.thumbnail)}
          sizes={DEFAULT_SIZES}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-foreground/70 to-transparent" />
        <h3
          className={cn(
            'absolute bottom-1 left-1 right-1 font-medium text-primary-foreground line-clamp-2',
            compact ? 'text-xs leading-tight' : 'text-xs'
          )}
        >
          {card.title}
        </h3>
      </div>

      {!compact && card.userNote && (
        <div className="p-2">
          <p className="text-xs text-muted-foreground line-clamp-1">{card.userNote}</p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="absolute top-1 right-1 z-10 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {/* Share to X */}
        <button
          onClick={handleShareToX}
          className="bg-background/80 backdrop-blur-sm rounded p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          title={t('draggableCard.shareOnX')}
        >
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        </button>
        {/* External Link */}
        <a
          href={card.videoUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="bg-background/80 backdrop-blur-sm rounded p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-primary hover:text-primary/80"
          title={t(`draggableCard.viewSource.${linkTypeToSourceType(card.linkType ?? 'youtube')}`)}
        >
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </div>
  );
}
