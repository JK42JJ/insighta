import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { List } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useIsMobile } from '@/hooks/use-mobile';
import { InsightCard } from '@/types/mandala';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useGridFilter } from '@/shared/lib/useGridFilter';
import { GridFilterBar } from '@/shared/ui/GridFilterBar';
import { useListSelection } from '../lib/useListSelection';
import { ListRowItem } from './ListRowItem';
import { DetailPanel } from './DetailPanel';

interface ListViewProps {
  cards: InsightCard[];
  onCardClick?: (card: InsightCard) => void;
  onSaveNote?: (id: string, note: string) => void;
  onDeleteCards?: (cardIds: string[]) => void;
}

const ROW_HEIGHT = 64;

export function ListView({ cards, onCardClick, onSaveNote, onDeleteCards }: ListViewProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const scrollRef = useRef<HTMLDivElement>(null);

  const {
    searchQuery,
    setSearchQuery,
    sortBy,
    setSortBy,
    sourceFilter,
    setSourceFilter,
    filteredCards,
  } = useGridFilter(cards);

  const { selectedId, selectedCard, select, clearSelection } = useListSelection(filteredCards);

  const virtualizer = useVirtualizer({
    count: filteredCards.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const handleRowClick = (card: InsightCard) => {
    select(card);
    onCardClick?.(card);
  };

  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-muted-foreground gap-4">
        <List className="h-12 w-12 opacity-40" />
        <div className="text-center">
          <p className="text-lg font-medium text-foreground">{t('viewMode.list')}</p>
          <p className="text-sm">{t('listView.noCards')}</p>
        </div>
      </div>
    );
  }

  const listPanel = (
    <div className="flex h-full flex-col gap-3">
      <div className="px-3 pt-3">
        <GridFilterBar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          sortBy={sortBy}
          onSortChange={setSortBy}
          sourceFilter={sourceFilter}
          onSourceFilterChange={setSourceFilter}
          resultCount={filteredCards.length}
        />
      </div>

      {filteredCards.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-[40vh] text-muted-foreground gap-3">
          <List className="h-10 w-10 opacity-30" />
          <p className="text-sm">{t('listView.noResults')}</p>
        </div>
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-auto">
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const card = filteredCards[virtualRow.index];
              return (
                <div
                  key={card.id}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <ListRowItem
                    card={card}
                    isSelected={card.id === selectedId}
                    onClick={() => handleRowClick(card)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  if (isMobile) {
    return (
      <div className="flex h-full flex-col">
        {listPanel}
        <Sheet open={!!selectedCard} onOpenChange={(open) => !open && clearSelection()}>
          <SheetContent side="right" className="w-[85vw] p-0 sm:max-w-md">
            <DetailPanel
              card={selectedCard}
              onSaveNote={onSaveNote}
              onDeleteCards={onDeleteCards}
            />
          </SheetContent>
        </Sheet>
      </div>
    );
  }

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full rounded-lg border">
      <ResizablePanel defaultSize={60} minSize={35}>
        {listPanel}
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={40} minSize={25}>
        <DetailPanel card={selectedCard} onSaveNote={onSaveNote} onDeleteCards={onDeleteCards} />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
