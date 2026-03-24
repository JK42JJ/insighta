import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useDroppable } from '@dnd-kit/core';
import { InsightCard } from '@/entities/card/model/types';
import { InsightCardItem } from './InsightCardItem';
import { FileVideo, Check } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { useDragSelect } from '@/features/drag-select/model/useDragSelect';
import { cardSlotDropId } from '@/shared/lib/dnd';
import { CardSkeleton } from './CardSkeleton';
import { useQueryClient } from '@tanstack/react-query';
import { localCardsKeys } from '@/features/card-management/model/useLocalCards';
import type { LocalCardsResponse } from '@/entities/card/model/local-cards';
import {
  useSummaryRatings,
  useRateSummary,
} from '@/features/card-management/model/useSummaryRating';
import type { SummaryRating } from '@/features/card-management/model/useSummaryRating';

interface CardListProps {
  cards: InsightCard[];
  isLoading?: boolean;
  title: string;
  onCardClick?: (card: InsightCard) => void;
  onCardDragStart?: (card: InsightCard) => void;
  onMultiCardDragStart?: (cards: InsightCard[]) => void;
  onSaveNote?: (id: string, note: string) => void;
  onCardsReorder?: (reorderedCards: InsightCard[]) => void;
  onDeleteCards?: (cardIds: string[]) => void;
  onSelectionChange?: (selectedIds: string[]) => void;
  enrichingCardIds?: Set<string>;
  failedEnrichCardIds?: Set<string>;
  onRetryEnrich?: (cardId: string, videoUrl?: string) => void;
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
      data-card-id={card.id}
      className={cn(
        'w-full transition-all duration-200 rounded-2xl relative',
        isOver && 'border-2 border-dashed border-primary bg-primary/5 scale-[1.02]'
      )}
    >
      {children}
    </div>
  );
}

const PAGE_SIZE = 24;

export function CardList({
  cards,
  isLoading,
  onCardClick,
  onSaveNote,
  onSelectionChange,
  enrichingCardIds,
  failedEnrichCardIds,
  onRetryEnrich,
}: CardListProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();


  const { data: summaryRatings } = useSummaryRatings();
  const rateSummary = useRateSummary();

  const handleRate = useCallback(
    (cardId: string, rating: SummaryRating) => {
      rateSummary.mutate({ cardId, rating });
    },
    [rateSummary]
  );
  const cachedCardCount = queryClient.getQueryData<LocalCardsResponse>(localCardsKeys.list())?.cards
    .length;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

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

  // Reset visible count when card list changes (e.g., cell switch)
  const cardListKey = useMemo(() => cards.map((c) => c.id).join(','), [cards]);
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [cardListKey]);

  // Infinite scroll: observe sentinel at bottom of grid
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, sortedCards.length));
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sortedCards.length]);

  const visibleCards = useMemo(
    () => sortedCards.slice(0, visibleCount),
    [sortedCards, visibleCount]
  );
  const hasMore = visibleCount < sortedCards.length;

  // Filter out selection IDs that no longer exist in cards (e.g., after moving cards)
  useEffect(() => {
    setSelectedCardIds((prev) => {
      const cardIdSet = new Set(cards.map((c) => c.id));
      const filtered = new Set([...prev].filter((id) => cardIdSet.has(id)));
      if (filtered.size !== prev.size) {
        setLastSelectedIndex(null);
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

  // Ref to track justFinishedDrag without stale closure
  const justFinishedDragRef = useRef(false);

  // Click anywhere outside card content to clear selection
  useEffect(() => {
    const handleClickAnywhere = (e: MouseEvent) => {
      if (justFinishedDragRef.current) return;
      const target = e.target as HTMLElement;
      if (target.closest('[data-card-content]')) return;
      if (target.closest('[data-card-deselect]')) return;
      setSelectedCardIds(new Set());
      setLastSelectedIndex(null);
    };
    document.addEventListener('click', handleClickAnywhere);
    return () => document.removeEventListener('click', handleClickAnywhere);
  }, []);

  // Drag select hook
  const handleDragSelectChange = useCallback(
    (selectedIndices: number[]) => {
      const newSelectedIds = new Set(
        selectedIndices.map((idx) => sortedCards[idx]?.id).filter(Boolean)
      );
      setSelectedCardIds(newSelectedIds);
    },
    [sortedCards]
  );

  const {
    selectionStyle,
    justFinishedDrag,
    isDragging: isDragSelecting,
  } = useDragSelect({
    containerRef: gridRef,
    itemSelector: '[data-card-item]',
    onSelectionChange: handleDragSelectChange,
    enabled: true,
  });

  // Keep ref in sync for document click handler (avoids stale closure)
  useEffect(() => {
    justFinishedDragRef.current = justFinishedDrag;
  }, [justFinishedDrag]);

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


  if (isLoading && cards.length === 0) {
    return <CardSkeleton count={cachedCardCount ?? 6} />;
  }

  if (cards.length === 0) {
    return (
      <div
        ref={gridRef}
        className={cn(
          'text-center py-12 text-muted-foreground transition-all duration-200 rounded-lg',
          false
        )}
        style={{ minHeight: 'calc(100vh - 300px)' }}
      >
        <FileVideo className="w-12 h-12 mx-auto mb-3 opacity-50" />
        <p>{t('cards.noInsights')}</p>
        <p className="text-sm mt-1">{t('cards.dragToAdd')}</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in" ref={containerRef}>
      <div
        ref={gridRef}
        className={cn(
          'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-3 relative min-h-full flex-1 pb-20 justify-items-center transition-all duration-200',
          false
        )}
        style={{ minHeight: 'calc(100vh - 200px)' }}
      >
        {selectionStyle && <div style={selectionStyle} />}
        {visibleCards.map((card, idx) => {
          const isSelected = selectedCardIds.has(card.id);
          return (
            <CardSlot key={card.id} card={card} isOver={false}>
              {isSelected && (
                <div
                  className="absolute top-2 left-2 z-20 bg-primary rounded-full p-1 cursor-pointer hover:bg-primary/80 transition-colors"
                  data-card-deselect
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
                summaryRating={summaryRatings?.[card.id] as SummaryRating | undefined}
                onRate={handleRate}
                isEnriching={enrichingCardIds?.has(card.id)}
                isEnrichFailed={failedEnrichCardIds?.has(card.id)}
                onRetryEnrich={onRetryEnrich}
              />
            </CardSlot>
          );
        })}
      </div>

      {/* Infinite scroll sentinel */}
      {hasMore && (
        <div ref={sentinelRef} className="flex justify-center py-6">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="w-4 h-4 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
            {t('cards.loadingMore', { loaded: visibleCount, total: sortedCards.length })}
          </div>
        </div>
      )}
    </div>
  );
}
