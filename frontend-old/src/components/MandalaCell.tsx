import { useState, memo, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { useDroppable, useDraggable } from '@dnd-kit/core';
import { GripVertical, ChevronDown, ChevronUp } from 'lucide-react';
import { InsightCard } from '@/types/mandala';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslation } from 'react-i18next';
import { createCardDragData, createCellDragData } from '@/features/dnd';

export interface MandalaCellProps {
  index: number;
  label: string;
  isCenter: boolean;
  cards: InsightCard[];
  isDropTarget: boolean;
  isCellSwapTarget: boolean;
  isSelected: boolean;
  isSwapping?: boolean;
  swapDirection?: 'from' | 'to' | null;
  onDrop: (
    index: number,
    url?: string,
    cardId?: string,
    multiCardIds?: string[],
    files?: FileList
  ) => void;
  onCellSwap: (fromIndex: number, toIndex: number) => void;
  onClick: () => void;
  onDoubleClick?: () => void;
  onCardClick: (card: InsightCard) => void;
  onCardDragStart: (card: InsightCard) => void;
  hasSubLevel?: boolean;
  onNavigateToSubLevel?: () => void;
}

export const MandalaCell = memo(
  function MandalaCell({
    index,
    label,
    isCenter,
    cards,
    isDropTarget,
    isCellSwapTarget,
    isSelected,
    isSwapping = false,
    swapDirection = null,
    onDrop,
    onCellSwap,
    onClick,
    onDoubleClick,
    onCardClick,
    onCardDragStart,
    hasSubLevel,
    onNavigateToSubLevel,
  }: MandalaCellProps) {
    const { t } = useTranslation();

    // dnd-kit droppable for internal card/cell drops
    const { setNodeRef: setDropRef, isOver } = useDroppable({
      id: `cell-${index}`,
      data: { type: 'cell', cellIndex: index, isCenter },
      disabled: isCenter,
    });

    // dnd-kit draggable for cell swap (on the grip handle)
    const {
      attributes: cellDragAttributes,
      listeners: cellDragListeners,
      setNodeRef: setCellDragRef,
      isDragging: isCellDragging,
    } = useDraggable({
      id: `cell-drag-${index}`,
      data: createCellDragData(index),
      disabled: isCenter,
    });

    // HTML5 drag handlers for external URL/file drops only
    const handleExternalDragOver = useCallback(
      (e: React.DragEvent) => {
        // Only handle external drops (URLs, files)
        const types = e.dataTransfer.types;
        const isExternal =
          types.includes('text/uri-list') ||
          types.includes('Files') ||
          (types.includes('text/plain') && !types.includes('application/card-id'));

        if (isExternal && !isCenter) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      [isCenter]
    );

    const handleExternalDrop = useCallback(
      (e: React.DragEvent) => {
        // Only handle external drops
        const types = e.dataTransfer.types;
        const hasInternalData =
          types.includes('application/card-id') ||
          types.includes('application/cell-index') ||
          types.includes('application/multi-card-ids');

        if (hasInternalData || isCenter) return;

        e.preventDefault();
        e.stopPropagation();

        // File drops
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          onDrop(index, undefined, undefined, undefined, e.dataTransfer.files);
          return;
        }

        // URL drops
        const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
        if (url) {
          onDrop(index, url);
        }
      },
      [index, isCenter, onDrop]
    );

    const [isExpanded, setIsExpanded] = useState(false);
    const cardCount = cards.length;

    const formatCardDate = (date: Date) => {
      return format(new Date(date), 'M/d HH:mm', { locale: ko });
    };

    const renderStackingBlocks = () => {
      if (cardCount === 0) return null;

      if (cardCount <= 2) {
        return (
          <div className="flex gap-1 mt-2">
            {cards.map((card, i) => (
              <MiniCardThumbnail
                key={card.id}
                card={card}
                index={i}
                onCardClick={onCardClick}
                onCardDragStart={onCardDragStart}
              />
            ))}
          </div>
        );
      }

      const baseMaxBlocks = 16;
      const maxBlocks = isExpanded ? cardCount : baseMaxBlocks;
      const filledBlocks = Math.min(cardCount, maxBlocks);
      const cols = 4;
      const rows = Math.ceil(filledBlocks / cols);
      const hasOverflow = cardCount > baseMaxBlocks;

      const getBlockColor = (blockIndex: number, totalRows: number, row: number) => {
        const rowIntensity = 100 - (totalRows - 1 - row) * 10;
        return `hsl(var(--primary) / ${Math.max(50, rowIntensity)}%)`;
      };

      const renderBlock = (card: InsightCard, blockIndex: number, row: number) => {
        const tooltipText = card.title
          ? `${card.title} (${formatCardDate(card.createdAt)})`
          : `${t('mandala.titleLoading')} (${formatCardDate(card.createdAt)})`;

        return (
          <TooltipProvider key={card.id} delayDuration={100}>
            <Tooltip>
              <TooltipTrigger asChild>
                <CardBlock
                  card={card}
                  blockIndex={blockIndex}
                  row={row}
                  rows={rows}
                  getBlockColor={getBlockColor}
                  onCardClick={onCardClick}
                  onCardDragStart={onCardDragStart}
                />
              </TooltipTrigger>
              <TooltipContent
                side="top"
                className="p-0 overflow-hidden rounded-lg z-[100] border-0"
                sideOffset={8}
              >
                <div className="w-[160px]">
                  <div className="relative aspect-video overflow-hidden bg-muted">
                    <img
                      src={card.thumbnail}
                      alt={card.title}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-foreground/60 to-transparent" />
                  </div>
                  <div className="px-2 py-1.5 bg-popover">
                    <p className="text-[10px] font-medium text-popover-foreground line-clamp-2 leading-tight">
                      {card.title || t('mandala.titleLoading')}
                    </p>
                    <span className="text-[9px] text-muted-foreground">
                      {formatCardDate(card.createdAt)}
                    </span>
                  </div>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      };

      return (
        <div className="mt-2 flex flex-col items-center">
          <div
            className={cn(
              'grid gap-[2px] p-1 bg-border/20 rounded-md transition-all duration-300',
              isExpanded && 'max-h-[120px] overflow-y-auto'
            )}
            style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
          >
            {Array.from({ length: rows }).map((_, row) =>
              Array.from({ length: cols }).map((_, col) => {
                const blockIndex = (rows - 1 - row) * cols + col;
                if (blockIndex >= filledBlocks) {
                  return (
                    <div
                      key={`empty-${row}-${col}`}
                      className="w-3 h-3 md:w-3.5 md:h-3.5 rounded-[2px] bg-muted/30"
                      style={{ opacity: 0.3 }}
                    />
                  );
                }
                const card = cards[blockIndex];
                if (!card) return null;
                return renderBlock(card, blockIndex, row);
              })
            )}
          </div>

          {hasOverflow && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded(!isExpanded);
              }}
              className={cn(
                'mt-1 flex items-center gap-0.5 text-xs text-primary font-bold',
                'hover:underline transition-all duration-200',
                !isExpanded && 'animate-[pulse_3s_ease-in-out_infinite]'
              )}
            >
              {isExpanded ? (
                <>
                  <ChevronUp className="w-3 h-3" />
                  {t('mandala.collapse')}
                </>
              ) : (
                <>
                  <ChevronDown className="w-3 h-3" />+{cardCount - baseMaxBlocks}
                </>
              )}
            </button>
          )}
        </div>
      );
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick();
      }
    };

    const showDropIndicator = isDropTarget || (isOver && !isCenter);

    return (
      <div
        ref={setDropRef}
        role="button"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        aria-label={
          isCenter ? label : `${label} (${cardCount} ${cardCount === 1 ? 'card' : 'cards'})`
        }
        className={cn(
          'relative flex flex-col items-center justify-start p-2 md:p-3 rounded-xl cursor-pointer group/cell',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          'border bg-surface-light',
          'transition-all duration-200 ease-out',
          isSwapping && swapDirection === 'from' && 'animate-scale-out',
          isSwapping && swapDirection === 'to' && 'animate-scale-in',
          !isCenter &&
            !isSelected &&
            'border-border/40 hover:border-primary/40 hover:-translate-y-0.5',
          isCenter && 'border-primary/50 bg-gradient-to-br from-primary/12 to-primary/5',
          isSelected && !isCenter && 'border-primary bg-primary/8 scale-[1.02]',
          showDropIndicator && !isCenter && 'border-primary border-dashed bg-primary/10 scale-105',
          isCellSwapTarget &&
            !isCenter &&
            'ring-2 ring-accent-foreground ring-offset-2 ring-offset-background scale-105',
          isCellDragging && 'opacity-50'
        )}
        style={{
          boxShadow:
            isSelected || showDropIndicator
              ? 'var(--shadow-lg)'
              : isCenter
                ? 'var(--shadow-inset-raised)'
                : 'var(--shadow-sm)',
        }}
        onDragOver={handleExternalDragOver}
        onDrop={handleExternalDrop}
        onClick={onClick}
        onDoubleClick={isCenter && onDoubleClick ? onDoubleClick : undefined}
      >
        {/* Cell Drag Handle — dnd-kit draggable */}
        {!isCenter && (
          <div
            ref={setCellDragRef}
            {...cellDragListeners}
            {...cellDragAttributes}
            className="absolute top-1.5 right-1.5 z-10 opacity-0 group-hover/cell:opacity-100 hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-background/90 backdrop-blur-sm rounded-md p-1 hover:bg-primary/20 shadow-sm">
              <GripVertical className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
          </div>
        )}

        {/* Label */}
        <span
          className={cn(
            'text-center font-medium leading-tight transition-colors',
            isCenter
              ? 'text-primary text-sm md:text-base font-semibold'
              : 'text-foreground/90 text-xs md:text-sm',
            isSelected && !isCenter && 'text-primary'
          )}
        >
          {label}
        </span>

        {/* Card visualization */}
        {!isCenter && renderStackingBlocks()}

        {/* Card count badge */}
        {!isCenter && cardCount > 0 && (
          <div
            className={cn(
              'absolute bottom-1.5 right-1.5 flex items-center justify-center',
              'min-w-[20px] h-5 px-1.5 rounded-full text-xs font-bold',
              'bg-primary text-primary-foreground shadow-md',
              'transition-transform hover:scale-110'
            )}
          >
            {cardCount}
          </div>
        )}

        {/* Empty state indicator */}
        {!isCenter && cardCount === 0 && (
          <div className="mt-3 flex flex-col items-center gap-1 text-muted-foreground/50">
            <div className="grid grid-cols-3 gap-0.5 opacity-30">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="w-2 h-2 rounded-[1px] bg-muted-foreground/30" />
              ))}
            </div>
            <span className="text-xs">{t('mandala.dragToAdd')}</span>
          </div>
        )}

        {/* Drop indicator overlay */}
        {showDropIndicator && !isCenter && !isCellSwapTarget && (
          <div className="absolute inset-0 flex items-center justify-center bg-primary/30 backdrop-blur-[1px] rounded-xl pointer-events-none">
            <span className="text-primary-foreground font-semibold text-sm bg-primary/90 px-3 py-1.5 rounded-lg shadow-lg">
              {t('mandala.dropHere')}
            </span>
          </div>
        )}

        {/* Cell swap indicator */}
        {isCellSwapTarget && !isCenter && (
          <div className="absolute inset-0 flex items-center justify-center bg-accent/60 backdrop-blur-[1px] rounded-xl pointer-events-none">
            <span className="text-accent-foreground font-semibold text-sm bg-accent px-3 py-1.5 rounded-lg shadow-lg">
              {t('mandala.swapPosition')}
            </span>
          </div>
        )}
      </div>
    );
  },
  (prev, next) => {
    if (prev.index !== next.index) return false;
    if (prev.label !== next.label) return false;
    if (prev.isCenter !== next.isCenter) return false;
    if (prev.isDropTarget !== next.isDropTarget) return false;
    if (prev.isCellSwapTarget !== next.isCellSwapTarget) return false;
    if (prev.isSelected !== next.isSelected) return false;
    if (prev.isSwapping !== next.isSwapping) return false;
    if (prev.swapDirection !== next.swapDirection) return false;
    if (prev.hasSubLevel !== next.hasSubLevel) return false;

    const pc = prev.cards,
      nc = next.cards;
    if (pc.length !== nc.length) return false;
    for (let i = 0; i < pc.length; i++) {
      if (pc[i].id !== nc[i].id || pc[i].cellIndex !== nc[i].cellIndex) return false;
    }
    return true;
  }
);

// Sub-components for card blocks inside cells (using dnd-kit draggable)

function MiniCardThumbnail({
  card,
  index: i,
  onCardClick,
  onCardDragStart,
}: {
  card: InsightCard;
  index: number;
  onCardClick: (card: InsightCard) => void;
  onCardDragStart: (card: InsightCard) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `mini-card-${card.id}`,
    data: createCardDragData(card),
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        'w-10 aspect-video overflow-hidden rounded-md border border-border/30 cursor-grab',
        'shadow-sm hover:shadow-md hover:scale-105 transition-all duration-200',
        'animate-[scale-in_0.3s_ease-out_forwards]',
        isDragging && 'opacity-50'
      )}
      style={{ animationDelay: `${i * 100}ms` }}
      onClick={(e) => {
        e.stopPropagation();
        onCardClick(card);
      }}
    >
      <img src={card.thumbnail} alt={card.title} className="w-full h-full object-cover" />
    </div>
  );
}

function CardBlock({
  card,
  blockIndex,
  row,
  rows,
  getBlockColor,
  onCardClick,
  onCardDragStart,
}: {
  card: InsightCard;
  blockIndex: number;
  row: number;
  rows: number;
  getBlockColor: (blockIndex: number, totalRows: number, row: number) => string;
  onCardClick: (card: InsightCard) => void;
  onCardDragStart: (card: InsightCard) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `block-card-${card.id}`,
    data: createCardDragData(card),
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        'w-3 h-3 md:w-3.5 md:h-3.5 rounded-[2px] transition-all duration-300',
        'bg-primary shadow-sm cursor-pointer hover:scale-125 hover:z-10 hover:shadow-primary/50 hover:shadow-lg',
        'animate-[block-pop_0.4s_ease-out_forwards]',
        isDragging && 'opacity-50'
      )}
      style={{
        backgroundColor: getBlockColor(blockIndex, rows, row),
        animationDelay: `${blockIndex * 40}ms`,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onCardClick(card);
      }}
    />
  );
}
