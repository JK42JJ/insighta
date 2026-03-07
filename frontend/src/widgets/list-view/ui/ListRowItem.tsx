import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { InsightCard } from '@/types/mandala';
import { cn } from '@/lib/utils';

interface ListRowItemProps {
  card: InsightCard;
  isSelected: boolean;
  onClick: () => void;
}

function formatRelativeDate(date: Date): string {
  const now = Date.now();
  const diff = now - new Date(date).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}

export function ListRowItem({ card, isSelected, onClick }: ListRowItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors',
        'hover:bg-muted/50',
        isSelected && 'bg-primary/10 border-l-2 border-primary',
        !isSelected && 'border-l-2 border-transparent'
      )}
    >
      {card.thumbnail ? (
        <img src={card.thumbnail} alt="" className="h-9 w-12 shrink-0 rounded object-cover" />
      ) : (
        <div className="h-9 w-12 shrink-0 rounded bg-muted" />
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{card.title}</p>
      </div>

      {card.linkType && (
        <Badge variant="secondary" className="shrink-0 text-[10px] px-1.5 py-0">
          {card.linkType}
        </Badge>
      )}

      <span className="shrink-0 text-xs text-muted-foreground">
        {formatRelativeDate(card.createdAt)}
      </span>
    </button>
  );
}
