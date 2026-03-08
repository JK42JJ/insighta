import { type RefObject } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { InsightCard } from '@/types/mandala';
import { InsightCardItem } from '@/components/InsightCardItem';

interface VirtualMasonryGridProps {
  cards: InsightCard[];
  columns: number;
  onCardClick?: (card: InsightCard) => void;
  onSaveNote?: (id: string, note: string) => void;
  parentRef: RefObject<HTMLDivElement | null>;
}

const ESTIMATED_ROW_HEIGHT = 336;
const OVERSCAN = 5;

export function VirtualMasonryGrid({
  cards,
  columns,
  onCardClick,
  onSaveNote,
  parentRef,
}: VirtualMasonryGridProps) {
  const rowCount = Math.ceil(cards.length / columns);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: OVERSCAN,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  return (
    <div
      style={{
        height: `${virtualizer.getTotalSize()}px`,
        width: '100%',
        position: 'relative',
      }}
    >
      {virtualizer.getVirtualItems().map((virtualRow) => {
        const startIndex = virtualRow.index * columns;
        const rowCards = cards.slice(startIndex, startIndex + columns);

        return (
          <div
            key={virtualRow.key}
            ref={virtualizer.measureElement}
            data-index={virtualRow.index}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualRow.start}px)`,
              willChange: 'transform',
            }}
          >
            <div
              className="grid gap-4 pb-4"
              style={{
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              }}
            >
              {rowCards.map((card) => (
                <div key={card.id} className="min-w-0">
                  <InsightCardItem
                    card={card}
                    onClick={() => onCardClick?.(card)}
                    onSave={onSaveNote}
                    isDraggable={false}
                  />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
