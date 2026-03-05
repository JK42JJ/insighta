import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { InsightCard } from '@/types/mandala';
import { InsightCardItem } from './InsightCardItem';
import { FileVideo, Move, Clock, Check, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDragSelect } from '@/hooks/useDragSelect';

interface CardListProps {
  cards: InsightCard[];
  title: string;
  onCardClick?: (card: InsightCard) => void;
  onCardDragStart?: (card: InsightCard) => void;
  onMultiCardDragStart?: (cards: InsightCard[]) => void;
  onSaveNote?: (id: string, note: string) => void;
  onCardsReorder?: (reorderedCards: InsightCard[]) => void;
  onDeleteCards?: (cardIds: string[]) => void;
}

export function CardList({
  cards,
  title,
  onCardClick,
  onCardDragStart,
  onMultiCardDragStart,
  onSaveNote,
  onCardsReorder,
  onDeleteCards,
}: CardListProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);

  // Sort cards: by sortOrder if available, otherwise by createdAt (newest first)
  const sortedCards = useMemo(() => {
    return [...cards].sort((a, b) => {
      // If both have sortOrder, use that
      if (a.sortOrder !== undefined && b.sortOrder !== undefined) {
        return a.sortOrder - b.sortOrder;
      }
      // Otherwise, fall back to date (newest first)
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

  const { selectionStyle, justFinishedDrag } = useDragSelect({
    containerRef: gridRef,
    itemSelector: '[data-card-item]',
    onSelectionChange: handleDragSelectChange,
    enabled: true,
  });

  const handleDragOver = useCallback((e: React.DragEvent, cardId: string) => {
    e.preventDefault();
    e.stopPropagation();
    // Only handle internal card reorder
    if (e.dataTransfer.types.includes('application/card-reorder')) {
      setDragOverId(cardId);
    }
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverId(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetCardId: string) => {
      e.preventDefault();
      e.stopPropagation();

      const draggedCardId = e.dataTransfer.getData('application/card-reorder');
      if (!draggedCardId || draggedCardId === targetCardId) {
        setDragOverId(null);
        return;
      }

      const draggedIndex = sortedCards.findIndex((c) => c.id === draggedCardId);
      const targetIndex = sortedCards.findIndex((c) => c.id === targetCardId);

      if (draggedIndex === -1 || targetIndex === -1) {
        setDragOverId(null);
        return;
      }

      // Create new order
      const newCards = [...sortedCards];
      const [removed] = newCards.splice(draggedIndex, 1);
      newCards.splice(targetIndex, 0, removed);

      // Assign sortOrder to maintain custom order
      const reorderedCards = newCards.map((card, index) => ({
        ...card,
        sortOrder: index,
      }));

      onCardsReorder?.(reorderedCards);
      setDragOverId(null);
    },
    [sortedCards, onCardsReorder]
  );

  const handleCardInternalDragStart = useCallback(
    (e: React.DragEvent, card: InsightCard) => {
      // If dragging a selected card and multiple are selected, drag all
      if (selectedCardIds.has(card.id) && selectedCardIds.size > 1) {
        const selectedCards = sortedCards.filter((c) => selectedCardIds.has(c.id));
        const cardIds = selectedCards.map((c) => c.id);
        e.dataTransfer.setData('application/multi-card-ids', JSON.stringify(cardIds));
        e.dataTransfer.setData('application/card-id', card.id);
        e.dataTransfer.setData('text/plain', selectedCards.map((c) => c.videoUrl).join('\n'));
        e.dataTransfer.effectAllowed = 'move';

        // Create professional drag image with stacked cards effect
        const dragImage = document.createElement('div');
        dragImage.style.cssText = `
        position: absolute; 
        left: -9999px; 
        display: flex; 
        align-items: center;
        justify-content: center;
        width: 140px;
        height: 100px;
      `;

        // Create stacked cards container
        const stackContainer = document.createElement('div');
        stackContainer.style.cssText = `
        position: relative;
        width: 100px;
        height: 70px;
        transform-style: preserve-3d;
        perspective: 400px;
      `;

        const maxThumbs = Math.min(selectedCards.length, 3);
        for (let i = maxThumbs - 1; i >= 0; i--) {
          const cardWrapper = document.createElement('div');
          const offset = i * 6;
          const rotation = (i - 1) * -3;
          const scale = 1 - i * 0.02;

          cardWrapper.style.cssText = `
          position: absolute;
          left: ${offset}px;
          top: ${offset}px;
          width: 88px;
          height: 56px;
          border-radius: 8px;
          overflow: hidden;
          box-shadow: 0 ${4 + i * 2}px ${12 + i * 4}px rgba(0,0,0,${0.3 - i * 0.05}),
                      0 ${2 + i}px ${4 + i * 2}px rgba(0,0,0,${0.2 - i * 0.03}),
                      inset 0 1px 0 rgba(255,255,255,0.1);
          transform: rotate(${rotation}deg) scale(${scale});
          border: 2px solid rgba(255,255,255,0.15);
          background: linear-gradient(135deg, #2a2a2a 0%, #1a1a1a 100%);
          z-index: ${maxThumbs - i};
        `;

          if (selectedCards[i]) {
            const thumb = document.createElement('img');
            thumb.src = selectedCards[i].thumbnail;
            thumb.style.cssText = `
            width: 100%; 
            height: 100%; 
            object-fit: cover;
            filter: brightness(0.95);
          `;
            cardWrapper.appendChild(thumb);

            // Add subtle gradient overlay
            const overlay = document.createElement('div');
            overlay.style.cssText = `
            position: absolute;
            inset: 0;
            background: linear-gradient(180deg, transparent 40%, rgba(0,0,0,0.4) 100%);
          `;
            cardWrapper.appendChild(overlay);
          }

          stackContainer.appendChild(cardWrapper);
        }

        // Create professional count badge
        const badge = document.createElement('div');
        badge.style.cssText = `
        position: absolute;
        right: -4px;
        top: -8px;
        min-width: 28px;
        height: 28px;
        background: linear-gradient(135deg, #FF6B3D 0%, #FF8F6B 100%);
        color: white;
        font-size: 13px;
        font-weight: 700;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        padding: 0 8px;
        border-radius: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 12px rgba(255,107,61,0.4),
                    0 2px 4px rgba(0,0,0,0.2),
                    inset 0 1px 0 rgba(255,255,255,0.3);
        border: 2px solid rgba(255,255,255,0.2);
        z-index: 100;
        letter-spacing: -0.5px;
      `;
        badge.textContent = `${selectedCards.length}`;
        stackContainer.appendChild(badge);

        dragImage.appendChild(stackContainer);
        document.body.appendChild(dragImage);
        e.dataTransfer.setDragImage(dragImage, 60, 45);
        setTimeout(() => document.body.removeChild(dragImage), 0);

        onMultiCardDragStart?.(selectedCards);
      } else {
        // Single card drag
        e.dataTransfer.setData('application/card-reorder', card.id);
        e.dataTransfer.setData('application/card-id', card.id);
        e.dataTransfer.setData('text/plain', card.videoUrl);
        e.dataTransfer.effectAllowed = 'move';

        // Create single card drag image
        const dragImage = document.createElement('div');
        dragImage.style.cssText = `
        position: absolute; 
        left: -9999px; 
        display: flex; 
        align-items: center;
        justify-content: center;
        width: 120px;
        height: 85px;
      `;

        const cardWrapper = document.createElement('div');
        cardWrapper.style.cssText = `
        width: 100px;
        height: 64px;
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 8px 24px rgba(0,0,0,0.35),
                    0 4px 8px rgba(0,0,0,0.2),
                    inset 0 1px 0 rgba(255,255,255,0.1);
        border: 2px solid rgba(255,255,255,0.15);
        background: linear-gradient(135deg, #2a2a2a 0%, #1a1a1a 100%);
        transform: rotate(-2deg);
      `;

        if (card.thumbnail) {
          const thumb = document.createElement('img');
          thumb.src = card.thumbnail;
          thumb.style.cssText = `
          width: 100%; 
          height: 100%; 
          object-fit: cover;
          filter: brightness(0.95);
        `;
          cardWrapper.appendChild(thumb);

          // Add subtle gradient overlay
          const overlay = document.createElement('div');
          overlay.style.cssText = `
          position: absolute;
          inset: 0;
          background: linear-gradient(180deg, transparent 40%, rgba(0,0,0,0.4) 100%);
        `;
          cardWrapper.appendChild(overlay);
        }

        dragImage.appendChild(cardWrapper);
        document.body.appendChild(dragImage);
        e.dataTransfer.setDragImage(dragImage, 50, 32);
        setTimeout(() => document.body.removeChild(dragImage), 0);

        onCardDragStart?.(card);
      }
    },
    [selectedCardIds, sortedCards, onCardDragStart, onMultiCardDragStart]
  );

  const handleCardClick = useCallback(
    (e: React.MouseEvent, card: InsightCard, cardIndex: number) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
        // Ctrl+Shift+Click: range selection
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
        // Ctrl+Click: toggle selection
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
        // Normal click: clear selection and trigger onClick
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

  // Clear selection when clicking empty space (but not right after drag selection)
  const handleContainerClick = (e: React.MouseEvent) => {
    if (justFinishedDrag) return;
    // Check if clicked on a card or its children
    const target = e.target as HTMLElement;
    const isCard = target.closest('[data-card-item]');
    if (!isCard) {
      setSelectedCardIds(new Set());
      setLastSelectedIndex(null);
    }
  };

  return (
    <div className="space-y-4 animate-fade-in" onClick={handleContainerClick} ref={containerRef}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold">
            {title} {t('cards.insights')}
          </h3>
          {selectedCardIds.size > 0 && (
            <>
              <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full">
                {t('cards.selected', { count: selectedCardIds.size })}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteCards?.([...selectedCardIds]);
                  setSelectedCardIds(new Set());
                  setLastSelectedIndex(null);
                }}
                className="p-1.5 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"
                title={t('cards.deleteSelected')}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span>{t('cards.latestFirst')}</span>
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Move className="w-3 h-3" />
            <span>{t('cards.dragToMove')}</span>
          </div>
        </div>
      </div>
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
            <div
              key={card.id}
              data-card-item
              onDragOver={(e) => handleDragOver(e, card.id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, card.id)}
              className={cn(
                'w-full transition-all duration-200 rounded-2xl relative',
                dragOverId === card.id &&
                  'ring-2 ring-primary ring-offset-2 ring-offset-background scale-[1.02]'
              )}
            >
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
                onClick={() => onCardClick?.(card)}
                onCtrlClick={(e) => handleCardClick(e, card, idx)}
                onDragStart={() => onCardDragStart?.(card)}
                onInternalDragStart={(e) => handleCardInternalDragStart(e, card)}
                onSave={onSaveNote}
                isDraggable={true}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
