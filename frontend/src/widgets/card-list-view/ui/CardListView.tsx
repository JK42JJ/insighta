import { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useDroppable } from '@dnd-kit/core';
import type { InsightCard } from '@/entities/card/model/types';
import { cn } from '@/shared/lib/utils';
import type { ViewMode } from '@/entities/user/model/types';
import { ViewSwitcher } from '@/features/view-mode';
import { CardList } from '@/widgets/card-list/ui/CardList';
import { ListView } from '@/widgets/list-view';
import { DetailPanel } from '@/widgets/detail-panel';
import { GraphView } from '@/components/graph/GraphView';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/shared/ui/resizable';
import { ContextHeader, type SortMode } from './ContextHeader';
import { LabelFilterPills } from './LabelFilterPills';

interface CardListViewProps {
  cards: InsightCard[];
  isLoading?: boolean;
  title: string;
  viewMode: ViewMode;
  listPanelRatio: number;
  mandalaId?: string | null;
  onViewModeChange: (mode: ViewMode) => void;
  onListPanelRatioChange: (ratio: number) => void;
  onCardClick?: (card: InsightCard) => void;
  onCardDragStart?: (card: InsightCard) => void;
  onMultiCardDragStart?: (cards: InsightCard[]) => void;
  onSaveNote?: (id: string, note: string) => void;
  onCardsReorder?: (reorderedCards: InsightCard[]) => void;
  onDeleteCards?: (cardIds: string[]) => void;
  onAddCard?: (url: string) => void;
  onSaveWatchPosition?: (id: string, positionSeconds: number) => void;
  watchPositionCache?: Map<string, number>;
  panelSizeCache?: Map<string, number>;
  highlightedCardId?: string | null;
  enrichingCardIds?: Set<string>;
  failedEnrichCardIds?: Set<string>;
  onRetryEnrich?: (cardId: string, videoUrl?: string) => void;
  // Sector pills
  sectorSubjects?: string[];
  selectedCellIndex?: number | null;
  onCellClick?: (cellIndex: number, subject: string) => void;
  totalCardCount?: number;
  /** Card count per sector cell (index 0-7) for pill badges */
  cardsByCell?: Record<number, InsightCard[]>;
  /** True when an external card drag is active (from Ideation) */
  isExternalCardDragActive?: boolean;
}

export function CardListView({
  cards,
  isLoading,
  title,
  viewMode,
  listPanelRatio,
  mandalaId,
  onViewModeChange,
  onListPanelRatioChange,
  onCardClick,
  onCardDragStart,
  onMultiCardDragStart,
  onSaveNote,
  onCardsReorder,
  onDeleteCards,
  onSaveWatchPosition,
  watchPositionCache,
  panelSizeCache,
  enrichingCardIds,
  failedEnrichCardIds,
  onRetryEnrich,
  sectorSubjects,
  selectedCellIndex,
  onCellClick,
  totalCardCount,
  cardsByCell,
  isExternalCardDragActive,
}: CardListViewProps) {
  const { t } = useTranslation();
  const [activeCard, setActiveCard] = useState<InsightCard | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>('latest');

  // Grid-area droppable at CardListView level (covers header + pills + grid)
  const { setNodeRef: setGridAreaRef } = useDroppable({
    id: 'drop-grid-area',
    data: { type: 'grid-area' as const },
  });

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const effectiveViewMode = viewMode === 'list-detail' && isMobile ? 'list' : viewMode;

  // Sort cards based on sortMode
  const sortedCards = useMemo(() => {
    const arr = [...cards];
    switch (sortMode) {
      case 'latest':
        return arr.sort((a, b) => {
          if (a.sortOrder !== undefined && b.sortOrder !== undefined)
            return a.sortOrder - b.sortOrder;
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });
      case 'oldest':
        return arr.sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
      case 'title-asc':
        return arr.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
      case 'title-desc':
        return arr.sort((a, b) => (b.title || '').localeCompare(a.title || ''));
      default:
        return arr;
    }
  }, [cards, sortMode]);

  // Sector card counts (0-7)
  const sectorCounts = useMemo(() => {
    if (!sectorSubjects || !cardsByCell) return [];
    return sectorSubjects.map((_, idx) => (cardsByCell[idx] ?? []).length);
  }, [sectorSubjects, cardsByCell]);

  const handleCardSelect = useCallback((card: InsightCard) => {
    setActiveCard(card);
  }, []);

  const handlePanelResize = useCallback(
    (sizes: number[]) => {
      if (sizes[0]) onListPanelRatioChange(Math.round(sizes[0]));
    },
    [onListPanelRatioChange]
  );

  const handleSelectionChange = useCallback((ids: string[]) => {
    setSelectedCardIds(ids);
  }, []);

  const handleDeleteSelected = useCallback(() => {
    if (selectedCardIds.length > 0) {
      onDeleteCards?.(selectedCardIds);
    }
  }, [selectedCardIds, onDeleteCards]);

  const handleAllClick = useCallback(() => {
    onCellClick?.(-1, '');
  }, [onCellClick]);

  // Context header
  const contextHeaderElement = (
    <ContextHeader
      title={title}
      totalCardCount={totalCardCount ?? cards.length}
      viewMode={effectiveViewMode}
      onViewModeChange={onViewModeChange}
      selectedCardIds={selectedCardIds}
      onDeleteSelected={handleDeleteSelected}
      sortMode={sortMode}
      onSortModeChange={setSortMode}
    />
  );

  // Sector pills
  const sectorPillsElement = sectorSubjects && sectorSubjects.length > 0 && (
    <LabelFilterPills
      sectors={sectorSubjects}
      selectedIndex={selectedCellIndex ?? null}
      totalCount={totalCardCount ?? cards.length}
      sectorCounts={sectorCounts}
      onSectorClick={(idx, subject) => onCellClick?.(idx, subject)}
      onAllClick={handleAllClick}
    />
  );

  // Graph mode
  if (effectiveViewMode === 'graph') {
    return (
      <div className="h-full flex flex-col animate-fade-in">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-semibold">
            {title} {t('cards.insights')}
          </h3>
          <ViewSwitcher value={viewMode} onChange={onViewModeChange} />
        </div>
        <div className="flex-1 min-h-0 relative">
          <GraphView mandalaId={mandalaId} />
        </div>
      </div>
    );
  }

  // Grid mode
  if (effectiveViewMode === 'grid') {
    return (
      <div
        ref={setGridAreaRef}
        className={cn(
          'animate-fade-in transition-all duration-200 rounded-lg',
          isExternalCardDragActive && 'ring-2 ring-primary ring-inset bg-primary/10'
        )}
      >
        {contextHeaderElement}
        {sectorPillsElement}
        <CardList
          cards={sortedCards}
          isLoading={isLoading}
          title={title}
          onCardClick={onCardClick}
          onCardDragStart={onCardDragStart}
          onMultiCardDragStart={onMultiCardDragStart}
          onSaveNote={onSaveNote}
          onCardsReorder={onCardsReorder}
          onDeleteCards={onDeleteCards}
          onSelectionChange={handleSelectionChange}
          enrichingCardIds={enrichingCardIds}
          failedEnrichCardIds={failedEnrichCardIds}
          onRetryEnrich={onRetryEnrich}
        />
      </div>
    );
  }

  // List mode
  if (effectiveViewMode === 'list') {
    return (
      <div className="h-full flex flex-col animate-fade-in">
        {contextHeaderElement}
        {sectorPillsElement}
        <div className="flex-1 min-h-0">
          <ListView
            cards={sortedCards}
            activeCardId={activeCard?.id ?? null}
            onCardSelect={handleCardSelect}
            onCardClick={onCardClick}
          />
        </div>
      </div>
    );
  }

  // List-detail mode
  return (
    <div className="h-full flex flex-col animate-fade-in">
      {contextHeaderElement}
      {sectorPillsElement}
      <div className="flex-1 min-h-0 rounded-lg border overflow-hidden">
        <ResizablePanelGroup direction="horizontal" onLayout={handlePanelResize}>
          <ResizablePanel defaultSize={listPanelRatio} minSize={25} maxSize={60}>
            <ListView
              cards={sortedCards}
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
              onSaveWatchPosition={onSaveWatchPosition}
              watchPositionCache={watchPositionCache}
              panelSizeCache={panelSizeCache}
              onClose={() => setActiveCard(null)}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
