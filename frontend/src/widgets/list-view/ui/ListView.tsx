import { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import { FileVideo } from 'lucide-react';
import type { InsightCard } from '@/entities/card/model/types';
import { ListViewItem } from './ListViewItem';

interface ListViewProps {
  cards: InsightCard[];
  activeCardId: string | null;
  onCardSelect: (card: InsightCard) => void;
  onCardClick?: (card: InsightCard) => void;
}

export function ListView({ cards, activeCardId, onCardSelect, onCardClick }: ListViewProps) {
  const { t } = useTranslation();
  const parentRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const sortedCards = useMemo(() => {
    return [...cards].sort((a, b) => {
      if (a.sortOrder !== undefined && b.sortOrder !== undefined) {
        return a.sortOrder - b.sortOrder;
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [cards]);

  const virtualizer = useVirtualizer({
    count: sortedCards.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 10,
  });

  // Sync activeIndex when activeCardId changes externally
  useEffect(() => {
    if (activeCardId) {
      const idx = sortedCards.findIndex((c) => c.id === activeCardId);
      if (idx !== -1) setActiveIndex(idx);
    }
  }, [activeCardId, sortedCards]);

  const handleItemClick = useCallback(
    (e: React.MouseEvent, card: InsightCard, index: number) => {
      if (e.ctrlKey || e.metaKey) {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(card.id)) next.delete(card.id);
          else next.add(card.id);
          return next;
        });
      } else {
        setSelectedIds(new Set());
        setActiveIndex(index);
        onCardSelect(card);
      }
    },
    [onCardSelect]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (sortedCards.length === 0) return;

      let nextIndex = activeIndex;
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          nextIndex = Math.min(activeIndex + 1, sortedCards.length - 1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          nextIndex = Math.max(activeIndex - 1, 0);
          break;
        case 'Home':
          e.preventDefault();
          nextIndex = 0;
          break;
        case 'End':
          e.preventDefault();
          nextIndex = sortedCards.length - 1;
          break;
        case 'Enter':
          e.preventDefault();
          if (sortedCards[activeIndex]) {
            onCardClick?.(sortedCards[activeIndex]);
          }
          return;
        case 'Escape':
          setSelectedIds(new Set());
          return;
        default:
          return;
      }

      if (nextIndex !== activeIndex) {
        setActiveIndex(nextIndex);
        onCardSelect(sortedCards[nextIndex]);
        virtualizer.scrollToIndex(nextIndex, { align: 'auto' });
      }
    },
    [activeIndex, sortedCards, onCardSelect, onCardClick, virtualizer]
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

  return (
    <div
      ref={parentRef}
      className="h-full overflow-y-auto scrollbar-pro focus:outline-none"
      tabIndex={0}
      role="listbox"
      aria-label={t('view.list')}
      onKeyDown={handleKeyDown}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const card = sortedCards[virtualRow.index];
          return (
            <ListViewItem
              key={card.id}
              card={card}
              isActive={activeCardId === card.id || activeIndex === virtualRow.index}
              isSelected={selectedIds.has(card.id)}
              onClick={(e) => handleItemClick(e, card, virtualRow.index)}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
