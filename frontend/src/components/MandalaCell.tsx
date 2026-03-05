import { useState, memo } from 'react';
import { cn } from '@/lib/utils';
import { GripVertical, ChevronDown, ChevronUp } from 'lucide-react';
import { InsightCard } from '@/types/mandala';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslation } from 'react-i18next';

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
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDragLeave: () => void;
  onCardClick: (card: InsightCard) => void;
  onCardDragStart: (card: InsightCard) => void;
  onCellDragStart: (index: number) => void;
  onCellDragEnd: () => void;
  onCellDragOver: (e: React.DragEvent, index: number) => void;
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
    onDragOver,
    onDragLeave,
    onCardClick,
    onCardDragStart,
    onCellDragStart,
    onCellDragEnd,
    onCellDragOver,
    hasSubLevel,
    onNavigateToSubLevel,
  }: MandalaCellProps) {
    const { t } = useTranslation();

    const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const cellIndex = e.dataTransfer.types.includes('application/cell-index');
      if (cellIndex && !isCenter) {
        onCellDragOver(e, index);
        return;
      }

      if (!isCenter) {
        onDragOver(e, index);
      }
    };

    const handleDrop = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (isCenter) return;

      const fromCellIndex = e.dataTransfer.getData('application/cell-index');
      if (fromCellIndex) {
        onCellSwap(parseInt(fromCellIndex), index);
        return;
      }

      // Check for file drops
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        onDrop(index, undefined, undefined, undefined, e.dataTransfer.files);
        return;
      }

      // Check for multi-card drop first
      const multiCardIdsData = e.dataTransfer.getData('application/multi-card-ids');
      if (multiCardIdsData) {
        try {
          const multiCardIds = JSON.parse(multiCardIdsData) as string[];
          onDrop(index, undefined, undefined, multiCardIds);
          return;
        } catch (err) {
          // Fall through to single card handling
        }
      }

      const cardId = e.dataTransfer.getData('application/card-id');
      if (cardId) {
        onDrop(index, undefined, cardId);
        return;
      }

      const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
      if (url) {
        onDrop(index, url);
      }
    };

    const handleCellDragStart = (e: React.DragEvent) => {
      if (isCenter) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.setData('application/cell-index', index.toString());
      e.dataTransfer.effectAllowed = 'move';
      onCellDragStart(index);
    };

    const [isExpanded, setIsExpanded] = useState(false);
    const cardCount = cards.length;

    // Format date for tooltip
    const formatCardDate = (date: Date) => {
      return format(new Date(date), 'M/d HH:mm', { locale: ko });
    };

    // Generate stacking block visualization with animation
    const renderStackingBlocks = () => {
      if (cardCount === 0) return null;

      // For 1-2 cards, show mini thumbnails
      if (cardCount <= 2) {
        return (
          <div className="flex gap-1 mt-2">
            {cards.map((card, i) => (
              <div
                key={card.id}
                className="w-10 aspect-video overflow-hidden rounded-md border border-border/30 cursor-grab 
                         shadow-sm hover:shadow-md hover:scale-105 transition-all duration-200
                         animate-[scale-in_0.3s_ease-out_forwards]"
                style={{ animationDelay: `${i * 100}ms` }}
                draggable
                onDragStart={(e) => {
                  e.stopPropagation();
                  e.dataTransfer.setData('application/card-id', card.id);
                  e.dataTransfer.setData('text/plain', card.videoUrl);
                  onCardDragStart(card);
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onCardClick(card);
                }}
              >
                <img src={card.thumbnail} alt={card.title} className="w-full h-full object-cover" />
              </div>
            ))}
          </div>
        );
      }

      // For 3+ cards, show stacking block visualization
      const baseMaxBlocks = 16;
      const maxBlocks = isExpanded ? cardCount : baseMaxBlocks;
      const filledBlocks = Math.min(cardCount, maxBlocks);
      const cols = 4;
      const rows = Math.ceil(filledBlocks / cols);
      const hasOverflow = cardCount > baseMaxBlocks;

      // Get color intensity based on position (gradient effect)
      const getBlockColor = (blockIndex: number, totalRows: number, row: number) => {
        // Create a gradient from darker at bottom to lighter at top
        const rowIntensity = 100 - (totalRows - 1 - row) * 10;
        return `hsl(var(--primary) / ${Math.max(50, rowIntensity)}%)`;
      };

      // Create block with tooltip helper
      const renderBlock = (card: InsightCard, blockIndex: number, row: number) => {
        const blockElement = (
          <div
            key={card.id}
            className={cn(
              'w-3 h-3 md:w-3.5 md:h-3.5 rounded-[2px] transition-all duration-300',
              'bg-primary shadow-sm cursor-pointer hover:scale-125 hover:z-10 hover:shadow-primary/50 hover:shadow-lg',
              'animate-[block-pop_0.4s_ease-out_forwards]'
            )}
            style={{
              backgroundColor: getBlockColor(blockIndex, rows, row),
              animationDelay: `${blockIndex * 40}ms`,
            }}
            onClick={(e) => {
              e.stopPropagation();
              onCardClick(card);
            }}
            draggable
            onDragStart={(e) => {
              e.stopPropagation();
              e.dataTransfer.setData('application/card-id', card.id);
              e.dataTransfer.setData('text/plain', card.videoUrl);
              onCardDragStart(card);
            }}
          />
        );

        const tooltipText = card.title
          ? `${card.title} (${formatCardDate(card.createdAt)})`
          : `${t('mandala.titleLoading')} (${formatCardDate(card.createdAt)})`;

        return (
          <TooltipProvider key={card.id} delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>{blockElement}</TooltipTrigger>
              <TooltipContent
                side="top"
                className="max-w-[250px] text-xs font-medium z-[100]"
                sideOffset={5}
              >
                <p className="line-clamp-2">{tooltipText}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      };

      return (
        <div className="mt-2 flex flex-col items-center">
          {/* Stacking blocks grid */}
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

          {/* Overflow toggle button */}
          {hasOverflow && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded(!isExpanded);
              }}
              className={cn(
                'mt-1 flex items-center gap-0.5 text-[9px] text-primary font-bold',
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

    return (
      <div
        className={cn(
          'relative flex flex-col items-center justify-start p-2 md:p-3 rounded-xl cursor-pointer group/cell',
          'border bg-surface-light',
          'transition-all duration-200 ease-out',
          // Swap animation
          isSwapping && swapDirection === 'from' && 'animate-scale-out',
          isSwapping && swapDirection === 'to' && 'animate-scale-in',
          // Default state
          !isCenter &&
            !isSelected &&
            'border-border/40 hover:border-primary/40 hover:-translate-y-0.5',
          // Center cell
          isCenter && 'border-primary/50 bg-gradient-to-br from-primary/12 to-primary/5',
          // Selected state
          isSelected && !isCenter && 'border-primary bg-primary/8 scale-[1.02]',
          // Drop target
          isDropTarget && !isCenter && 'border-primary border-dashed bg-primary/10 scale-105',
          // Cell swap target
          isCellSwapTarget &&
            !isCenter &&
            'ring-2 ring-accent-foreground ring-offset-2 ring-offset-background scale-105'
        )}
        style={{
          boxShadow:
            isSelected || isDropTarget
              ? 'var(--shadow-lg)'
              : isCenter
                ? 'var(--shadow-inset-raised)'
                : 'var(--shadow-sm)',
        }}
        onDragOver={handleDragOver}
        onDragLeave={onDragLeave}
        onDrop={handleDrop}
        onClick={onClick}
        onDoubleClick={isCenter && onDoubleClick ? onDoubleClick : undefined}
      >
        {/* Cell Drag Handle */}
        {!isCenter && (
          <div
            draggable
            onDragStart={handleCellDragStart}
            onDragEnd={onCellDragEnd}
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
              'min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold',
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
            <span className="text-[9px]">{t('mandala.dragToAdd')}</span>
          </div>
        )}

        {/* Drop indicator overlay */}
        {isDropTarget && !isCenter && !isCellSwapTarget && (
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
    // Custom comparator: only re-render when data props change (skip callback refs)
    if (prev.index !== next.index) return false;
    if (prev.label !== next.label) return false;
    if (prev.isCenter !== next.isCenter) return false;
    if (prev.isDropTarget !== next.isDropTarget) return false;
    if (prev.isCellSwapTarget !== next.isCellSwapTarget) return false;
    if (prev.isSelected !== next.isSelected) return false;
    if (prev.isSwapping !== next.isSwapping) return false;
    if (prev.swapDirection !== next.swapDirection) return false;
    if (prev.hasSubLevel !== next.hasSubLevel) return false;

    // cards array: id-based comparison
    const pc = prev.cards,
      nc = next.cards;
    if (pc.length !== nc.length) return false;
    for (let i = 0; i < pc.length; i++) {
      if (pc[i].id !== nc[i].id || pc[i].cellIndex !== nc[i].cellIndex) return false;
    }
    return true;
  }
);
