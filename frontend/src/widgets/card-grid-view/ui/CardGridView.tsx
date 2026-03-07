import { useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutGrid } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { InsightCard } from '@/types/mandala';
import { InsightCardItem } from '@/components/InsightCardItem';
import { GridFilterBar } from '@/shared/ui/GridFilterBar';
import { useGridFilter } from '@/shared/lib/useGridFilter';

interface CardGridViewProps {
  cards: InsightCard[];
  onCardClick?: (card: InsightCard) => void;
  onSaveNote?: (id: string, note: string) => void;
  onDeleteCards?: (cardIds: string[]) => void;
}

const CARD_HEIGHT = 320;
const GAP = 16;

function useColumns(containerRef: React.RefObject<HTMLDivElement | null>) {
  const getColumns = useCallback(() => {
    const width = containerRef.current?.offsetWidth ?? 1200;
    if (width < 640) return 1;
    if (width < 768) return 2;
    if (width < 1280) return 3;
    return 4;
  }, [containerRef]);

  return getColumns;
}

export function CardGridView({ cards, onCardClick, onSaveNote, onDeleteCards }: CardGridViewProps) {
  const { t } = useTranslation();
  const parentRef = useRef<HTMLDivElement>(null);
  const getColumns = useColumns(parentRef);

  const {
    searchQuery,
    setSearchQuery,
    sortBy,
    setSortBy,
    sourceFilter,
    setSourceFilter,
    filteredCards,
  } = useGridFilter(cards);

  const columns = getColumns();
  const rowCount = Math.ceil(filteredCards.length / columns);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => CARD_HEIGHT + GAP,
    overscan: 3,
  });

  // Re-measure on resize
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      virtualizer.measure();
    });
    if (parentRef.current) {
      observer.observe(parentRef.current);
    }
    return () => observer.disconnect();
  }, [virtualizer]);

  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-muted-foreground gap-4">
        <LayoutGrid className="h-12 w-12 opacity-40" />
        <div className="text-center">
          <p className="text-lg font-medium text-foreground">{t('viewMode.grid')}</p>
          <p className="text-sm">{t('gridView.noCards')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      <GridFilterBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        sortBy={sortBy}
        onSortChange={setSortBy}
        sourceFilter={sourceFilter}
        onSourceFilterChange={setSourceFilter}
        resultCount={filteredCards.length}
      />

      {filteredCards.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-[40vh] text-muted-foreground gap-3">
          <LayoutGrid className="h-10 w-10 opacity-30" />
          <p className="text-sm">{t('gridView.noResults')}</p>
        </div>
      ) : (
        <div ref={parentRef} className="flex-1 overflow-auto" style={{ contain: 'strict' }}>
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const startIndex = virtualRow.index * columns;
              const rowCards = filteredCards.slice(startIndex, startIndex + columns);

              return (
                <div
                  key={virtualRow.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <div
                    className="grid gap-4"
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
        </div>
      )}
    </div>
  );
}
