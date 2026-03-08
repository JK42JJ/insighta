import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/utils';
import type { InsightCard } from '@/entities/card/model/types';
import { SourceTypeBadge, SourceMetaInfo } from '@/entities/content';
import { generateProxySrc } from '@/shared/lib/image-utils';

interface ListViewItemProps {
  card: InsightCard;
  isActive: boolean;
  isSelected: boolean;
  onClick: (e: React.MouseEvent) => void;
  style?: React.CSSProperties;
}

function formatRelativeDate(date: Date): string {
  const now = Date.now();
  const diff = now - new Date(date).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w`;
}

export const ListViewItem = memo(function ListViewItem({
  card,
  isActive,
  isSelected,
  onClick,
  style,
}: ListViewItemProps) {
  const { t } = useTranslation();
  const notePreview = card.userNote
    ? card.userNote.replace(/\n/g, ' ').slice(0, 80)
    : t('insightCard.noMemo');

  return (
    <div
      style={style}
      onClick={onClick}
      role="option"
      aria-selected={isActive}
      className={cn(
        'flex items-center gap-3 px-3 py-2 cursor-pointer border-l-2 border-transparent transition-colors hover:bg-muted/50',
        isActive && 'bg-primary/10 border-l-primary',
        isSelected && 'bg-primary/5'
      )}
    >
      {/* Thumbnail */}
      <div className="flex-shrink-0 w-12 h-9 rounded overflow-hidden bg-muted">
        {card.thumbnail ? (
          <img
            src={generateProxySrc(card.thumbnail, 120) ?? card.thumbnail}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
            --
          </div>
        )}
      </div>

      {/* Title + Note preview */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{card.title || 'Untitled'}</p>
        <p className="text-xs text-muted-foreground truncate">{notePreview}</p>
        <SourceMetaInfo card={card} view="list" />
      </div>

      {/* Meta: date + badge */}
      <div className="flex-shrink-0 flex items-center gap-2">
        {card.linkType && <SourceTypeBadge linkType={card.linkType} />}
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {formatRelativeDate(card.createdAt)}
        </span>
      </div>
    </div>
  );
});
