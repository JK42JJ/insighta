import { memo, useMemo } from 'react';
import { cn } from '@/shared/lib/utils';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { GripVertical, Plus, Play, FileText, Link as LinkIcon } from 'lucide-react';
import { generateProxySrc } from '@/shared/lib/image-utils';
import { InsightCard } from '@/entities/card/model/types';
import { useTranslation } from 'react-i18next';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/ui/tooltip';
import {
  type DragData,
  type DropData,
  cardDragId,
  cellDragId,
  cellDropId,
} from '@/shared/lib/dnd';
import type { MandalaSizeMode } from './MandalaGrid';

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
  sizeMode?: MandalaSizeMode;
  hasSubLevel?: boolean;
  onNavigateToSubLevel?: () => void;
}

// --- Diagonal tooltip placement based on tile position in grid ---
function useTooltipPlacement(gridCol: number, gridRow: number, totalCols: number, totalRows: number) {
  const isRight = gridCol >= totalCols / 2;
  const isBottom = gridRow >= totalRows / 2;
  const side = isBottom ? 'top' : 'bottom';
  const align = isRight ? 'start' : 'end';
  return { side, align } as const;
}

// --- Shared tooltip content (glassmorphism card) ---
function TileTooltipContent({
  card,
  placement,
}: {
  card: InsightCard;
  placement: { side: 'top' | 'bottom'; align: 'start' | 'end' };
}) {
  return (
    <TooltipContent
      side={placement.side}
      align={placement.align}
      sideOffset={24}
      collisionPadding={16}
      className={cn(
        'w-[180px] z-[100] pointer-events-none p-0 overflow-hidden',
        // Glassmorphism
        'border border-white/15',
        'bg-popover/80 backdrop-blur-xl',
        'shadow-[0_8px_32px_-4px_rgba(0,0,0,0.4)]',
        'rounded-xl',
        // Instant close — no exit animation lag
        'data-[state=closed]:duration-0',
      )}
    >
      {/* Thumbnail — vertical layout */}
      {card.thumbnail ? (
        <div className="relative">
          <img src={generateProxySrc(card.thumbnail, 180) ?? card.thumbnail} alt="" className="w-full aspect-video object-cover" loading="lazy" />
          {/* Bottom gradient fade */}
          <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/40 to-transparent" />
        </div>
      ) : (
        <div className="w-full aspect-video flex items-center justify-center bg-primary/8">
          <Play className="w-5 h-5 text-primary/30" />
        </div>
      )}
      {/* Title — below thumbnail */}
      <div className="px-2.5 py-2">
        <p className="text-[11px] font-medium leading-snug line-clamp-2 text-foreground/85">
          {card.title}
        </p>
      </div>
    </TooltipContent>
  );
}

// --- Mini thumbnail block (flat, no flip) ---
function MiniThumbnail({
  card,
  index,
  onCardClick,
}: {
  card: InsightCard;
  index: number;
  onCardClick: (card: InsightCard) => void;
}) {
  const dragData: DragData = { type: 'card', card };
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: cardDragId(card.id),
    data: dragData,
  });

  const iconEl =
    card.linkType === 'youtube' || card.linkType === 'youtube-shorts' ? (
      <Play className="w-1/3 h-1/3 text-primary/60" />
    ) : card.linkType === 'pdf' || card.linkType === 'txt' || card.linkType === 'md' ? (
      <FileText className="w-1/3 h-1/3 text-primary/60" />
    ) : (
      <LinkIcon className="w-1/3 h-1/3 text-primary/60" />
    );

  // MiniThumbnail is used in CardBlock (1-3 cards), no grid position needed
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          ref={setNodeRef}
          {...listeners}
          {...attributes}
          className={cn(
            'aspect-video rounded-md overflow-hidden cursor-pointer',
            'shadow-sm hover:shadow-md hover:scale-105 hover:z-10',
            'transition-all duration-300',
            isDragging && 'opacity-20',
          )}
          style={{ animation: `block-pop 0.4s ease-out ${index * 100}ms forwards` }}
          onClick={(e) => {
            e.stopPropagation();
            onCardClick(card);
          }}
        >
          {card.thumbnail ? (
            <img src={generateProxySrc(card.thumbnail, 120) ?? card.thumbnail} alt="" className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center"
              style={{ background: 'hsl(var(--primary) / 15%)' }}
            >
              {iconEl}
            </div>
          )}
        </div>
      </TooltipTrigger>
      <TileTooltipContent card={card} placement={{ side: 'top', align: 'end' }} />
    </Tooltip>
  );
}

// --- Draggable color tile for 4+ cards ---
function DraggableColorTile({
  card,
  index,
  intensity,
  gridCol,
  gridRow,
  totalCols,
  totalRows,
  onCardClick,
}: {
  card: InsightCard;
  index: number;
  intensity: number;
  gridCol: number;
  gridRow: number;
  totalCols: number;
  totalRows: number;
  onCardClick: (card: InsightCard) => void;
}) {
  const dragData: DragData = { type: 'card', card };
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: cardDragId(card.id),
    data: dragData,
  });

  const placement = useTooltipPlacement(gridCol, gridRow, totalCols, totalRows);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          ref={setNodeRef}
          {...listeners}
          {...attributes}
          className={cn(
            'aspect-video rounded-[2px] cursor-pointer',
            'shadow-sm hover:scale-125 hover:z-10 hover:shadow-lg hover:shadow-primary/40',
            'transition-all duration-300',
            isDragging && 'opacity-20',
          )}
          style={{
            background: `hsl(var(--primary) / ${intensity}%)`,
            animation: `block-pop 0.4s ease-out ${index * 40}ms forwards`,
          }}
          onClick={(e) => {
            e.stopPropagation();
            onCardClick(card);
          }}
        />
      </TooltipTrigger>
      <TileTooltipContent card={card} placement={placement} />
    </Tooltip>
  );
}

// --- Color tile block for 4+ cards (v1 style) ---
function ColorTileBlock({
  cards,
  onCardClick,
}: {
  cards: InsightCard[];
  onCardClick: (card: InsightCard) => void;
}) {
  const maxBlocks = 16;
  const maxVisible = maxBlocks - 1;
  const hasOverflow = cards.length > maxBlocks;
  const displayCards = hasOverflow ? cards.slice(0, maxVisible) : cards;
  const overflow = cards.length - maxVisible;
  const totalRows = Math.ceil(displayCards.length / 4);

  return (
    <TooltipProvider delayDuration={0} skipDelayDuration={0} disableHoverableContent>
      <div className="flex-1 w-full min-h-0 flex items-start justify-center p-[8%]">
        <div className="w-full grid grid-cols-4 gap-[2px]">
          {displayCards.map((card, i) => {
            const row = Math.floor(i / 4);
            const col = i % 4;
            const intensity = totalRows > 1
              ? 100 - (row / (totalRows - 1)) * 40
              : 100;
            return (
              <DraggableColorTile
                key={card.id}
                card={card}
                index={i}
                intensity={intensity}
                gridCol={col}
                gridRow={row}
                totalCols={4}
                totalRows={totalRows}
                onCardClick={onCardClick}
              />
            );
          })}
          {hasOverflow && (
            <div
              className="aspect-video rounded-[2px] flex items-center justify-center"
              style={{
                background: 'hsl(var(--muted) / 60%)',
                animation: `block-pop 0.4s ease-out ${maxVisible * 40}ms both`,
              }}
            >
              <span
                className="text-muted-foreground font-bold leading-none"
                style={{ fontSize: 'clamp(6px, 1.8cqi, 10px)' }}
              >
                +{overflow}
              </span>
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}

// --- Mini-thumbnail grid for 1-6 cards with center balance ---
function CardBlock({
  cards,
  onCardClick,
}: {
  cards: InsightCard[];
  onCardClick: (card: InsightCard) => void;
}) {
  const len = cards.length;
  const cols = len === 1 ? 'grid-cols-1' : len === 2 ? 'grid-cols-2' : 'grid-cols-3';
  const maxW = len === 1 ? 'max-w-[55%]' : len === 2 ? 'max-w-[75%]' : '';

  return (
    <TooltipProvider delayDuration={0} skipDelayDuration={0} disableHoverableContent>
      <div className="flex-1 w-full min-h-0 flex items-start justify-center p-[8%]">
        <div className={cn('w-full grid gap-[3px]', cols, maxW)}>
          {cards.map((card, i) => (
            <MiniThumbnail key={card.id} card={card} index={i} onCardClick={onCardClick} />
          ))}
        </div>
      </div>
    </TooltipProvider>
  );
}

// --- Cell drag handle ---
function CellDragHandle({ gridIndex, isCenter }: { gridIndex: number; isCenter: boolean }) {
  const dragData: DragData = { type: 'cell', gridIndex };
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: cellDragId(gridIndex),
    data: dragData,
    disabled: isCenter,
  });

  if (isCenter) return null;

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        'absolute top-1 right-1 z-10',
        'opacity-0 group-hover/cell:opacity-100',
        'transition-all duration-200 cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-50'
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="bg-background/80 backdrop-blur-md rounded-md p-0.5 shadow-sm hover:bg-primary/10 hover:shadow-md transition-all">
        <GripVertical className="w-3 h-3 text-muted-foreground" />
      </div>
    </div>
  );
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
    onClick,
    onDoubleClick,
    onCardClick,
    sizeMode = 'standard',
  }: MandalaCellProps) {
    const { t } = useTranslation();
    const cardCount = cards.length;

    // --- dnd-kit droppable ---
    const dropData: DropData = {
      type: 'mandala-cell',
      gridIndex: index,
      subjectIndex: index,
    };
    const { setNodeRef: setDropRef, isOver } = useDroppable({
      id: cellDropId(index),
      data: dropData,
      disabled: isCenter,
    });

    // --- External drop (HTML5) ---
    const handleExternalDragOver = (e: React.DragEvent) => {
      const hasExternalData =
        e.dataTransfer.types.includes('text/uri-list') ||
        e.dataTransfer.types.includes('Files') ||
        e.dataTransfer.types.includes('application/card-id') ||
        (e.dataTransfer.types.includes('text/plain') && e.dataTransfer.types.length === 1);
      if (hasExternalData && !isCenter) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const handleExternalDrop = (e: React.DragEvent) => {
      if (isCenter) return;
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        onDrop(index, undefined, undefined, undefined, e.dataTransfer.files);
        return;
      }
      const cardId = e.dataTransfer.getData('application/card-id');
      if (cardId) {
        e.preventDefault();
        e.stopPropagation();
        const multiCardIdsStr = e.dataTransfer.getData('application/multi-card-ids');
        if (multiCardIdsStr) {
          try {
            const multiCardIds = JSON.parse(multiCardIdsStr) as string[];
            onDrop(index, undefined, undefined, multiCardIds);
            return;
          } catch { /* fall through to single card */ }
        }
        onDrop(index, undefined, cardId);
        return;
      }
      const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
      if (url) {
        e.preventDefault();
        e.stopPropagation();
        onDrop(index, url);
      }
    };

    // swapKey triggers re-mount on swap state change → block-pop replays
    const swapKey = isSwapping ? 'swapping' : 'settled';

    const renderCards = useMemo(() => {
      if (cardCount === 0) return null;
      if (cardCount <= 6) return <CardBlock key={swapKey} cards={cards} onCardClick={onCardClick} />;
      return <ColorTileBlock key={swapKey} cards={cards} onCardClick={onCardClick} />;
    }, [cards, cardCount, onCardClick, swapKey]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick();
      }
    };

    const showDropIndicator = (isDropTarget || isOver) && !isCenter && !isCellSwapTarget;

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
          'relative flex flex-col items-center cursor-pointer group/cell',
          'aspect-square overflow-hidden',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
          'transition-all duration-200 ease-out',
          'border bg-card/90 backdrop-blur-sm border-border/15',
          // Swapping animations
          isSwapping && swapDirection === 'from' && 'animate-scale-out',
          isSwapping && swapDirection === 'to' && 'animate-scale-in',
          // Normal hover — lift effect (v1 style)
          !isCenter && !isSelected && !showDropIndicator && !isCellSwapTarget &&
            'hover:border-primary/40 hover:-translate-y-0.5',
          // Center cell
          isCenter && [
            'border-primary/30',
            'bg-gradient-to-br from-primary/10 via-card to-primary/5',
          ],
          // Selected
          isSelected && !isCenter && [
            'border-primary/60 bg-primary/5',
            'shadow-[0_0_0_1px_hsl(var(--primary)/0.15),0_4px_12px_-2px_hsl(var(--primary)/0.1)]',
          ],
          // Drop target — enhanced glow effect
          showDropIndicator && [
            'border-2 border-primary border-dashed bg-primary/10',
            'shadow-[0_0_24px_-4px_hsl(var(--primary)/0.4),0_0_8px_-2px_hsl(var(--primary)/0.2)]',
            'scale-[1.02]',
          ],
          // Cell swap target
          isCellSwapTarget && !isCenter && [
            'ring-2 ring-primary/60 ring-offset-1 ring-offset-background',
            'bg-primary/10 scale-105',
          ]
        )}
        style={{
          padding: 'clamp(4px, 2%, 10px)',
          borderRadius: 'clamp(8px, 2cqi, 16px)',
          boxShadow: isSelected
            ? 'var(--shadow-md)'
            : isCenter
              ? 'var(--shadow-inset-raised)'
              : 'var(--shadow-sm)',
        }}
        onDragOver={handleExternalDragOver}
        onDrop={handleExternalDrop}
        onClick={onClick}
        onDoubleClick={isCenter && onDoubleClick ? onDoubleClick : undefined}
      >
        {/* Cell Drag Handle */}
        <CellDragHandle gridIndex={index} isCenter={isCenter} />

        {/* Label — fluid typography */}
        <span
          className={cn(
            'text-center font-medium leading-tight transition-colors w-full shrink-0',
            sizeMode === 'compact' ? 'line-clamp-1' : 'line-clamp-2',
            isCenter && 'text-primary font-semibold',
            !isCenter && 'text-foreground/80',
            isSelected && !isCenter && 'text-primary'
          )}
          style={{
            fontSize: isCenter
              ? 'clamp(10px, 3cqi, 16px)'
              : 'clamp(8px, 2.5cqi, 14px)',
          }}
        >
          {label}
        </span>

        {/* Card visualization — fills remaining space */}
        {!isCenter && renderCards}

        {/* Card count badge — fluid sizing */}
        {!isCenter && cardCount > 0 && (
          <div
            className="absolute bottom-1 right-1 flex items-center justify-center rounded-full font-bold bg-primary text-primary-foreground shadow-sm shadow-primary/25 ring-1.5 ring-background"
            style={{
              minWidth: 'clamp(14px, 3.5cqi, 20px)',
              height: 'clamp(14px, 3.5cqi, 20px)',
              fontSize: 'clamp(7px, 2cqi, 11px)',
              padding: '0 clamp(2px, 0.5cqi, 4px)',
            }}
          >
            {cardCount}
          </div>
        )}

        {/* Empty state — subtle + icon only */}
        {!isCenter && cardCount === 0 && (
          <div className="flex-1 flex items-center justify-center w-full">
            <Plus
              className="text-muted-foreground/20"
              style={{ width: 'clamp(12px, 4cqi, 24px)', height: 'clamp(12px, 4cqi, 24px)' }}
            />
          </div>
        )}

        {/* Drop overlay */}
        {showDropIndicator && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-primary/20 backdrop-blur-[2px] pointer-events-none">
            <div className="bg-primary/90 text-primary-foreground text-[10px] font-semibold px-2 py-1 rounded-md shadow-lg">
              {t('mandala.dropHere')}
            </div>
          </div>
        )}

        {/* Cell swap overlay */}
        {isCellSwapTarget && !isCenter && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-accent/40 backdrop-blur-[2px] pointer-events-none">
            <div className="bg-accent text-accent-foreground text-[10px] font-semibold px-2 py-1 rounded-md shadow-lg">
              {t('mandala.swapPosition')}
            </div>
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
    if (prev.sizeMode !== next.sizeMode) return false;

    const pc = prev.cards,
      nc = next.cards;
    if (pc.length !== nc.length) return false;
    for (let i = 0; i < pc.length; i++) {
      if (pc[i].id !== nc[i].id || pc[i].cellIndex !== nc[i].cellIndex) return false;
    }
    return true;
  }
);
