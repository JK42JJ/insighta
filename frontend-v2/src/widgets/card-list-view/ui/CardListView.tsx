import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Move } from 'lucide-react';
import type { InsightCard } from '@/entities/card/model/types';
import type { ViewMode } from '@/entities/user/model/types';
import { ViewSwitcher } from '@/features/view-mode';
import { CardList } from '@/widgets/card-list/ui/CardList';
import { ListView } from '@/widgets/list-view';
import { DetailPanel } from '@/widgets/detail-panel';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/shared/ui/resizable';

interface CardListViewProps {
  cards: InsightCard[];
  title: string;
  viewMode: ViewMode;
  listPanelRatio: number;
  onViewModeChange: (mode: ViewMode) => void;
  onListPanelRatioChange: (ratio: number) => void;
  onCardClick?: (card: InsightCard) => void;
  onCardDragStart?: (card: InsightCard) => void;
  onMultiCardDragStart?: (cards: InsightCard[]) => void;
  onSaveNote?: (id: string, note: string) => void;
  onCardsReorder?: (reorderedCards: InsightCard[]) => void;
  onDeleteCards?: (cardIds: string[]) => void;
}

export function CardListView({
  cards,
  title,
  viewMode,
  listPanelRatio,
  onViewModeChange,
  onListPanelRatioChange,
  onCardClick,
  onCardDragStart,
  onMultiCardDragStart,
  onSaveNote,
  onCardsReorder,
  onDeleteCards,
}: CardListViewProps) {
  const { t } = useTranslation();
  const [activeCard, setActiveCard] = useState<InsightCard | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  // Mobile detection: auto-fallback list-detail to list
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const effectiveViewMode = viewMode === 'list-detail' && isMobile ? 'list' : viewMode;

  const handleCardSelect = useCallback((card: InsightCard) => {
    setActiveCard(card);
  }, []);

  const handlePanelResize = useCallback(
    (sizes: number[]) => {
      if (sizes[0]) onListPanelRatioChange(Math.round(sizes[0]));
    },
    [onListPanelRatioChange]
  );

  // Header with title, sort info, and ViewSwitcher
  const headerElement = (
    <div className="flex items-center justify-between mb-4">
      <h3 className="text-lg font-semibold">
        {title} {t('cards.insights')}
      </h3>
      <div className="flex items-center gap-3">
        {effectiveViewMode === 'grid' && (
          <>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="w-3 h-3" />
              <span>{t('cards.latestFirst')}</span>
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Move className="w-3 h-3" />
              <span>{t('cards.dragToMove')}</span>
            </div>
          </>
        )}
        <ViewSwitcher value={viewMode} onChange={onViewModeChange} />
      </div>
    </div>
  );

  // Grid mode: render existing CardList
  if (effectiveViewMode === 'grid') {
    return (
      <div className="animate-fade-in">
        {headerElement}
        <CardList
          cards={cards}
          title={title}
          onCardClick={onCardClick}
          onCardDragStart={onCardDragStart}
          onMultiCardDragStart={onMultiCardDragStart}
          onSaveNote={onSaveNote}
          onCardsReorder={onCardsReorder}
          onDeleteCards={onDeleteCards}
        />
      </div>
    );
  }

  // List mode: full-width list
  if (effectiveViewMode === 'list') {
    return (
      <div className="h-full flex flex-col animate-fade-in">
        {headerElement}
        <div className="flex-1 min-h-0">
          <ListView
            cards={cards}
            activeCardId={activeCard?.id ?? null}
            onCardSelect={handleCardSelect}
            onCardClick={onCardClick}
          />
        </div>
      </div>
    );
  }

  // List-detail mode: split panel
  return (
    <div className="h-full flex flex-col animate-fade-in">
      {headerElement}
      <div className="flex-1 min-h-0 rounded-lg border overflow-hidden">
        <ResizablePanelGroup
          direction="horizontal"
          onLayout={handlePanelResize}
        >
          <ResizablePanel defaultSize={listPanelRatio} minSize={25} maxSize={60}>
            <ListView
              cards={cards}
              activeCardId={activeCard?.id ?? null}
              onCardSelect={handleCardSelect}
              onCardClick={onCardClick}
            />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={100 - listPanelRatio} minSize={30}>
            <DetailPanel
              card={activeCard}
              onSaveNote={onSaveNote}
              onCardClick={onCardClick}
              onClose={() => setActiveCard(null)}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
