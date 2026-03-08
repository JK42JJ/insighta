import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useDroppable } from '@dnd-kit/core';
import { InsightCard } from '@/entities/card/model/types';
import { InsightCardItem } from './InsightCardItem';
import { FileVideo, Check } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { useDragSelect } from '@/features/drag-select/model/useDragSelect';
import { cardSlotDropId } from '@/shared/lib/dnd';

interface CardListProps {
  cards: InsightCard[];
  title: string;
  onCardClick?: (card: InsightCard) => void;
  onCardDragStart?: (card: InsightCard) => void;
  onMultiCardDragStart?: (cards: InsightCard[]) => void;
  onSaveNote?: (id: string, note: string) => void;
  onCardsReorder?: (reorderedCards: InsightCard[]) => void;
  onDeleteCards?: (cardIds: string[]) => void;
  onSelectionChange?: (selectedIds: string[]) => void;
}

// Wrapper to make each card slot a droppable for reorder
function CardSlot({
  card,
  isOver,
  children,
}: {
  card: InsightCard;
  isOver: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({
    id: cardSlotDropId(card.id),
    data: { type: 'card-slot' as const, cardId: card.id },
  });

  return (
    <div
      ref={setNodeRef}
      data-card-item
      className={cn(
        'w-full transition-all duration-200 rounded-2xl relative',
        isOver && 'ring-2 ring-primary ring-offset-2 ring-offset-background scale-[1.02]'
      )}
    >
      {children}
    </div>
  );
}

export function CardList({
  cards,
  onCardClick,
  onSaveNote,
  onDeleteCards,
  onSelectionChange,
}: CardListProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);

  // Sort cards: by sortOrder if available, otherwise by createdAt (newest first)
  const sortedCards = useMemo(() => {
    return [...cards].sort((a, b) => {
      if (a.sortOrder !== undefined && b.sortOrder !== undefined) {
        return a.sortOrder - b.sortOrder;
      }
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      return dateB - dateA;
    });
  }, [cards]);

  // Clear selection when cards change (e.g., after moving cards)
  useEffect(() => {
    setSelectedCardIds((prev) => {
      const cardIdSet = new Set(cards.map((c) => c.id));
      const filtered = new Set([...prev].filter((id) => cardIdSet.has(id)));
      if (filtered.size !== prev.size) {
        return filtered;
      }
      return prev;
    });
  }, [cards]);

  // Notify parent of selection changes
  useEffect(() => {
    onSelectionChange?.([...selectedCardIds]);
  }, [selectedCardIds, onSelectionChange]);

  // ESC key to clear selection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedCardIds(new Set());
        setLastSelectedIndex(null);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Click anywhere outside the list to clear selection
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setSelectedCardIds(new Set());
        setLastSelectedIndex(null);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // Drag select hook
  const handleDragSelectChange = useCallback(
    (selectedIndices: number[]) => {
      const newSelectedIds = new Set(
        selectedIndices.map((idx) => sortedCards[idx]?.id).filter(Boolean)
      );
      setSelectedCardIds((prev) => {
        const combined = new Set([...prev, ...newSelectedIds]);
        return combined;
      });
    },
    [sortedCards]
  );

  const { selectionStyle, justFinishedDrag, isDragging: isDragSelecting } = useDragSelect({
    containerRef: gridRef,
    itemSelector: '[data-card-item]',
    onSelectionChange: handleDragSelectChange,
    enabled: true,
  });

  const handleCardClick = useCallback(
    (e: React.MouseEvent, card: InsightCard, cardIndex: number) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();

        if (lastSelectedIndex !== null) {
          const start = Math.min(lastSelectedIndex, cardIndex);
          const end = Math.max(lastSelectedIndex, cardIndex);
          const rangeCardIds = sortedCards.slice(start, end + 1).map((c) => c.id);

          setSelectedCardIds((prev) => {
            const next = new Set(prev);
            rangeCardIds.forEach((id) => next.add(id));
            return next;
          });
        } else {
          setSelectedCardIds(new Set([card.id]));
          setLastSelectedIndex(cardIndex);
        }
      } else if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        setSelectedCardIds((prev) => {
          const next = new Set(prev);
          if (next.has(card.id)) {
            next.delete(card.id);
          } else {
            next.add(card.id);
          }
          return next;
        });
        setLastSelectedIndex(cardIndex);
      } else {
        setSelectedCardIds(new Set());
        setLastSelectedIndex(null);
        onCardClick?.(card);
      }
    },
    [lastSelectedIndex, sortedCards, onCardClick]
  );

  if (cards.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <FileVideo className="w-12 h-12 mx-auto mb-3 opacity-50" />
        <p>{t('cards.noInsights')}</p>
        <p className="text-sm mt-1">{t('cards.dragToAdd')}</p>
      </div>
    );
  }

  const handleContainerClick = (e: React.MouseEvent) => {
    if (justFinishedDrag) return;
    const target = e.target as HTMLElement;
    const isCard = target.closest('[data-card-item]');
    if (!isCard) {
      setSelectedCardIds(new Set());
      setLastSelectedIndex(null);
    }
  };

  return (
    <div className="animate-fade-in" onClick={handleContainerClick} ref={containerRef}>
      <div
        ref={gridRef}
        className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 p-3 relative min-h-full flex-1 pb-20 justify-items-center"
        style={{ minHeight: 'calc(100vh - 200px)' }}
        onClick={handleContainerClick}
      >
        {selectionStyle && <div style={selectionStyle} />}
        {sortedCards.map((card, idx) => {
          const isSelected = selectedCardIds.has(card.id);
          return (
            <CardSlot key={card.id} card={card} isOver={false}>
              {isSelected && (
                <div
                  className="absolute top-2 left-2 z-20 bg-primary rounded-full p-1 cursor-pointer hover:bg-primary/80 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedCardIds((prev) => {
                      const next = new Set(prev);
                      next.delete(card.id);
                      return next;
                    });
                  }}
                  title={t('cards.deselectCard')}
                >
                  <Check className="w-3 h-3 text-primary-foreground" />
                </div>
              )}
              <InsightCardItem
                card={card}
                onCardClick={() => onCardClick?.(card)}
                onCtrlClick={(e) => handleCardClick(e, card, idx)}
                onSave={onSaveNote}
                isDraggable={true}
                selectedCardIds={selectedCardIds.size > 0 ? selectedCardIds : undefined}
                disableFlip={isDragSelecting}
              />
            </CardSlot>
          );
        })}
      </div>
    </div>
  );
}
