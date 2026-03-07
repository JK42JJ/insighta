import { useRef } from 'react';
import { InsightCard } from '@/types/mandala';
import { GridFilterBar } from '@/shared/ui/GridFilterBar';
import { useGridFilter } from '@/shared/lib/useGridFilter';
import { useColumnCount } from '../lib/useColumnCount';
import { VirtualMasonryGrid } from './VirtualMasonryGrid';
import { EmptyState } from './EmptyState';

interface CardGridViewProps {
  cards: InsightCard[];
  onCardClick?: (card: InsightCard) => void;
  onSaveNote?: (id: string, note: string) => void;
  onDeleteCards?: (cardIds: string[]) => void;
}

export function CardGridView({ cards, onCardClick, onSaveNote }: CardGridViewProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const columns = useColumnCount(parentRef);

  const {
    searchQuery,
    setSearchQuery,
    sortBy,
    setSortBy,
    sourceFilter,
    setSourceFilter,
    filteredCards,
    resetFilters,
  } = useGridFilter(cards);

  if (cards.length === 0) {
    return <EmptyState type="no-cards" />;
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
        <EmptyState type="no-results" onReset={resetFilters} />
      ) : (
        <div ref={parentRef} className="flex-1 overflow-auto" style={{ contain: 'strict' }}>
          <VirtualMasonryGrid
            cards={filteredCards}
            columns={columns}
            onCardClick={onCardClick}
            onSaveNote={onSaveNote}
            parentRef={parentRef}
          />
        </div>
      )}
    </div>
  );
}
