import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { InsightCard } from '@/entities/card/model/types';
import { Card } from '@/shared/ui/card';
import { cn } from '@/shared/lib/utils';
import { GripVertical, StickyNote, Tag, Play } from 'lucide-react';

interface InsightCardItemProps {
  card: InsightCard;
  onClick?: () => void;
  onCtrlClick?: (e: React.MouseEvent) => void;
  onDragStart?: () => void;
  onInternalDragStart?: (e: React.DragEvent) => void;
  onSave?: (id: string, note: string) => void;
  isDraggable?: boolean;
  className?: string;
}

export function InsightCardItem({
  card,
  onClick,
  onCtrlClick,
  onDragStart,
  onInternalDragStart,
  onSave,
  isDraggable = false,
  className,
}: InsightCardItemProps) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [noteValue, setNoteValue] = useState(card.userNote ?? '');

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      if (onInternalDragStart) {
        onInternalDragStart(e);
      } else if (onDragStart) {
        e.dataTransfer.setData('application/card-id', card.id);
        e.dataTransfer.setData('text/plain', card.videoUrl);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }
    },
    [card.id, card.videoUrl, onDragStart, onInternalDragStart],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (isEditing) return;
      if ((e.ctrlKey || e.metaKey) && onCtrlClick) {
        onCtrlClick(e);
        return;
      }
      onClick?.();
    },
    [isEditing, onClick, onCtrlClick],
  );

  const handleNoteSave = useCallback(() => {
    onSave?.(card.id, noteValue);
    setIsEditing(false);
  }, [card.id, noteValue, onSave]);

  const handleNoteDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
  }, []);

  const handleNoteKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleNoteSave();
      }
      if (e.key === 'Escape') {
        setNoteValue(card.userNote ?? '');
        setIsEditing(false);
      }
    },
    [card.userNote, handleNoteSave],
  );

  const formatWatchPosition = (seconds?: number): string | null => {
    if (seconds == null || seconds <= 0) return null;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const watchPos = formatWatchPosition(card.lastWatchPosition);

  return (
    <Card
      draggable={isDraggable}
      onDragStart={handleDragStart}
      onClick={handleClick}
      className={cn(
        'group relative overflow-hidden cursor-pointer transition-all duration-200',
        'hover:shadow-md hover:border-primary/30 hover:scale-[1.02]',
        isDraggable && 'cursor-grab active:cursor-grabbing',
        className,
      )}
    >
      {/* Drag handle */}
      {isDraggable && (
        <div className="absolute top-1 left-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="bg-background/80 backdrop-blur-sm rounded p-0.5">
            <GripVertical className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
          </div>
        </div>
      )}

      {/* Thumbnail */}
      <div className="relative aspect-video overflow-hidden">
        <img
          src={card.thumbnail}
          alt={card.title}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={(e) => {
            (e.target as HTMLImageElement).src =
              'https://via.placeholder.com/320x180?text=Thumbnail';
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-foreground/70 to-transparent" />

        {/* Title overlay */}
        <h4 className="absolute bottom-1 left-1.5 right-1.5 text-xs font-medium text-primary-foreground line-clamp-2 leading-tight">
          {card.title}
        </h4>

        {/* Watch position badge */}
        {watchPos && (
          <div className="absolute top-1 right-1 flex items-center gap-0.5 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded">
            <Play className="w-2.5 h-2.5" aria-hidden="true" />
            {watchPos}
          </div>
        )}
      </div>

      {/* Note preview */}
      <div className="p-2 space-y-1">
        {isEditing ? (
          <textarea
            autoFocus
            value={noteValue}
            onChange={(e) => setNoteValue(e.target.value)}
            onBlur={handleNoteSave}
            onKeyDown={handleNoteKeyDown}
            onClick={(e) => e.stopPropagation()}
            className="w-full text-xs bg-muted/50 border border-input rounded px-1.5 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            rows={2}
            placeholder={t('cards.addNote')}
          />
        ) : (
          <div onDoubleClick={handleNoteDoubleClick}>
            {card.userNote ? (
              <p className="text-xs text-muted-foreground line-clamp-2 flex items-start gap-1">
                <StickyNote className="w-3 h-3 mt-0.5 shrink-0 text-primary/60" aria-hidden="true" />
                <span>{card.userNote}</span>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground/50 italic">
                {t('cards.doubleClickToNote')}
              </p>
            )}
          </div>
        )}

        {/* Link type badge */}
        {card.linkType && card.linkType !== 'youtube' && (
          <div className="flex items-center gap-1">
            <Tag className="w-2.5 h-2.5 text-muted-foreground" aria-hidden="true" />
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
              {card.linkType}
            </span>
          </div>
        )}
      </div>
    </Card>
  );
}
