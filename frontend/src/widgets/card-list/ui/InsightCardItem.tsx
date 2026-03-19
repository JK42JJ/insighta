import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useDraggable } from '@dnd-kit/core';
import { InsightCard } from '@/entities/card/model/types';
import { Card } from '@/shared/ui/card';
import { cn } from '@/shared/lib/utils';
import { GripVertical, StickyNote, Play, Loader2 } from 'lucide-react';
import { CompactNotePreview } from '@/shared/ui/CompactNotePreview';
import { SourceTypeBadge, SourceMetaInfo } from '@/entities/content';
import { type DragData, cardDragId } from '@/shared/lib/dnd';
import { upgradeYouTubeThumbnail, handleThumbnailError } from '@/shared/lib/image-utils';
import { useCardFlipSetting } from '@/shared/lib/useCardFlipSetting';
import type { SummaryRating } from '@/features/card-management/model/useSummaryRating';

interface InsightCardItemProps {
  card: InsightCard;
  onCardClick?: () => void;
  onCtrlClick?: (e: React.MouseEvent) => void;
  onSave?: (id: string, note: string) => void;
  isDraggable?: boolean;
  selectedCardIds?: Set<string>;
  disableFlip?: boolean;
  className?: string;
  summaryRating?: SummaryRating;
  onRate?: (cardId: string, rating: SummaryRating) => void;
  isEnriching?: boolean;
}

export function InsightCardItem({
  card,
  onCardClick,
  onCtrlClick,
  onSave,
  isDraggable: canDrag = false,
  selectedCardIds,
  disableFlip = false,
  className,
  summaryRating,
  onRate,
  isEnriching = false,
}: InsightCardItemProps) {
  const { t } = useTranslation();
  const cardFlipEnabled = useCardFlipSetting();
  const [isEditing, setIsEditing] = useState(false);
  const [noteValue, setNoteValue] = useState(card.userNote ?? '');

  // Flip is disabled when: explicitly disabled, setting off, or memo is empty
  const hasContent = !!card.userNote?.trim();
  const shouldDisableFlip = disableFlip || !cardFlipEnabled || !hasContent;

  // Build drag data — include selected card IDs for multi-select drag
  const isSelected = selectedCardIds?.has(card.id) ?? false;
  const isMultiSelect = isSelected && selectedCardIds && selectedCardIds.size > 1;
  const dragData: DragData = isMultiSelect
    ? { type: 'card', card, selectedCardIds: [...selectedCardIds!] }
    : { type: 'card-reorder', card };

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: cardDragId(card.id),
    data: dragData,
    disabled: !canDrag,
  });

  // Selected cards: entire card is draggable. Unselected: only grip handle.
  const cardListeners = isSelected ? listeners : undefined;

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (isEditing) return;
      if ((e.ctrlKey || e.metaKey) && onCtrlClick) {
        onCtrlClick(e);
        return;
      }
      onCardClick?.();
    },
    [isEditing, onCardClick, onCtrlClick]
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
    [card.userNote, handleNoteSave]
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
      ref={setNodeRef}
      {...(canDrag ? { ...attributes, ...cardListeners } : {})}
      data-dnd-draggable={isSelected ? '' : undefined}
      data-card-content
      onClick={handleClick}
      className={cn(
        'group relative cursor-pointer transition-all duration-200 [perspective:800px]',
        'border-0 shadow-none bg-transparent',
        isSelected && canDrag && 'cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-30',
        className
      )}
    >
      <div
        className={cn(
          '[transform-style:preserve-3d] transition-transform duration-500',
          !shouldDisableFlip && 'group-hover:[transform:rotateY(180deg)]'
        )}
      >
        {/* === Front face === */}
        <div className="[backface-visibility:hidden] bg-card rounded-xl border shadow-sm overflow-hidden">
          {/* Drag handle — triggers dnd-kit drag when card is not selected */}
          {canDrag && !isSelected && (
            <div
              {...listeners}
              data-dnd-handle
              className="absolute top-1 left-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing"
            >
              <div className="bg-background/80 backdrop-blur-sm rounded p-0.5">
                <GripVertical className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
              </div>
            </div>
          )}

          {/* Thumbnail */}
          <div className="relative aspect-video overflow-hidden rounded-t-xl">
            <img
              src={upgradeYouTubeThumbnail(card.thumbnail) ?? card.thumbnail}
              alt={card.title}
              className="w-full h-full object-cover"
              loading="lazy"
              onError={handleThumbnailError}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />

            {/* Title overlay */}
            <h4 className="absolute bottom-1 left-1.5 right-1.5 text-xs font-medium text-white line-clamp-2 leading-tight">
              {card.title}
            </h4>

            {/* Top-right badge stack: source type + watch position */}
            <div className="absolute top-1 right-1 flex flex-col items-end gap-0.5">
              {card.linkType && <SourceTypeBadge linkType={card.linkType} variant="overlay" />}
              {watchPos && (
                <div className="flex items-center gap-0.5 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded">
                  <Play className="w-2.5 h-2.5" aria-hidden="true" />
                  {watchPos}
                </div>
              )}
            </div>
          </div>

          {/* Note preview — fixed height area */}
          <div className="p-2 space-y-1 h-[72px] overflow-hidden">
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
                  <div className="flex items-start gap-1">
                    <StickyNote
                      className="w-3 h-3 mt-0.5 shrink-0 text-primary/60"
                      aria-hidden="true"
                    />
                    <CompactNotePreview
                      note={card.userNote}
                      maxLines={3}
                      cardId={card.id}
                      summaryRating={summaryRating}
                      onRate={onRate}
                    />
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground/50 italic">
                    {t('cards.doubleClickToNote')}
                  </p>
                )}
              </div>
            )}

            {/* Source meta info */}
            <div className="flex items-center gap-1.5">
              <SourceMetaInfo card={card} view="grid" />
            </div>
          </div>

          {/* Enriching spinner (bottom-left, inside front face) */}
          {isEnriching && (
            <div className="absolute bottom-2 left-2 z-[5] pointer-events-none">
              <div className="flex items-center gap-1 bg-blue-500/90 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>AI</span>
              </div>
            </div>
          )}
        </div>

        {/* === Back face (note/memo view) === */}
        <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)] bg-card rounded-xl border p-3 flex flex-col">
          <h4 className="text-xs font-semibold line-clamp-1 mb-1">{card.title}</h4>
          <div className="flex-1 overflow-y-auto" onDoubleClick={handleNoteDoubleClick}>
            {isEditing ? (
              <textarea
                autoFocus
                value={noteValue}
                onChange={(e) => setNoteValue(e.target.value)}
                onBlur={handleNoteSave}
                onKeyDown={handleNoteKeyDown}
                onClick={(e) => e.stopPropagation()}
                className="w-full h-full text-xs bg-muted/50 border border-input rounded px-1.5 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder={t('cards.addNote')}
              />
            ) : card.userNote ? (
              <CompactNotePreview
                note={card.userNote}
                cardId={card.id}
                summaryRating={summaryRating}
                onRate={onRate}
              />
            ) : (
              <p className="text-xs text-muted-foreground/50 italic">
                {t('cards.doubleClickToNote')}
              </p>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
