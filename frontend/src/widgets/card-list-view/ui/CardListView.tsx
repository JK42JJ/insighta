import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useDroppable } from '@dnd-kit/core';
import type { InsightCard } from '@/entities/card/model/types';
import { cn } from '@/shared/lib/utils';
import { extractUrlFromDragData, extractUrlFromHtml } from '@/shared/data/mockData';
import type { ViewMode } from '@/entities/user/model/types';
import { ViewSwitcher } from '@/features/view-mode';
import { CardList } from '@/widgets/card-list/ui/CardList';
import { ListView } from '@/widgets/list-view';
import { DetailPanel } from '@/widgets/detail-panel';
import { GraphView } from '@/components/graph/GraphView';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/shared/ui/resizable';
import { LayoutGrid, Grid3X3, Plus } from 'lucide-react';
import { Slider } from '@/shared/ui/slider';
import { ContextHeader, type SortMode } from './ContextHeader';
import { LabelFilterPillsV2 } from './LabelFilterPillsV2';

const MIN_GRID_COLUMNS = 2;
const MAX_GRID_COLUMNS = 6;
const COMPACT_THRESHOLD = 5;

// Responsive grid columns by CONTAINER width (auto-calculated, replaces manual slider).
// Reacts to side panel open/close — when main area shrinks, columns auto-reduce.
// Slider component is preserved below for future reuse but hidden via SHOW_GRID_SLIDER flag.
const SHOW_GRID_SLIDER = false;
const CONTAINER_4COL = 1200;
const CONTAINER_3COL = 900;
const CONTAINER_2COL = 600;

function getColumnsForWidth(width: number): number {
  if (width >= CONTAINER_4COL) return 4;
  if (width >= CONTAINER_3COL) return 3;
  if (width >= CONTAINER_2COL) return 2;
  return 1;
}

function useContainerColumns(ref: React.RefObject<HTMLElement>): number {
  const [cols, setCols] = useState(3);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        setCols(getColumnsForWidth(w));
      }
    });
    observer.observe(el);
    // Initial measurement
    setCols(getColumnsForWidth(el.getBoundingClientRect().width));
    return () => observer.disconnect();
  }, [ref]);
  return cols;
}

interface CardListViewProps {
  cards: InsightCard[];
  isLoading?: boolean;
  title: string;
  viewMode: ViewMode;
  listPanelRatio: number;
  mandalaId?: string | null;
  onViewModeChange: (mode: ViewMode) => void;
  onListPanelRatioChange: (ratio: number) => void;
  onCardClick?: (card: InsightCard, sortedList?: InsightCard[]) => void;
  onCardDragStart?: (card: InsightCard) => void;
  onMultiCardDragStart?: (cards: InsightCard[]) => void;
  onSaveNote?: (id: string, note: string) => void;
  onCardsReorder?: (reorderedCards: InsightCard[]) => void;
  onDeleteCards?: (cardIds: string[]) => void;
  onAddCard?: (url: string) => void;
  /** External URL drop (native HTML5 drag from browser) */
  onExternalUrlDrop?: (url: string) => void;
  onExternalFileDrop?: (files: FileList) => void;
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
  /** Grid column count (2-6) */
  gridColumns?: number;
  /** Grid column change handler */
  onGridColumnsChange?: (columns: number) => void;
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
  onExternalUrlDrop,
  onExternalFileDrop,
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
  gridColumns: gridColumnsProp,
  onGridColumnsChange,
}: CardListViewProps) {
  const { t } = useTranslation();
  // Auto-responsive columns by CONTAINER width (reacts to side panel open/close).
  // Manual gridColumns prop ignored unless SHOW_GRID_SLIDER flag is on.
  const containerRef = useRef<HTMLDivElement>(null);
  const responsiveColumns = useContainerColumns(containerRef);
  const gridColumns = SHOW_GRID_SLIDER && gridColumnsProp ? gridColumnsProp : responsiveColumns;
  const [activeCard, setActiveCard] = useState<InsightCard | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>('latest');
  const [isExternalDragOver, setIsExternalDragOver] = useState(false);

  // Native HTML5 external drag handlers (YouTube URL from browser etc.)
  const handleExternalDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!onExternalUrlDrop) return;
      e.preventDefault();
      setIsExternalDragOver(true);
    },
    [onExternalUrlDrop]
  );

  const handleExternalDragLeave = useCallback(() => {
    setIsExternalDragOver(false);
  }, []);

  const handleExternalDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsExternalDragOver(false);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        onExternalFileDrop?.(e.dataTransfer.files);
        return;
      }
      const rawUrl =
        e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
      let url = rawUrl ? extractUrlFromDragData(rawUrl) : null;
      if (!url) {
        const html = e.dataTransfer.getData('text/html');
        if (html) url = extractUrlFromHtml(html);
      }
      if (url) {
        onExternalUrlDrop?.(url);
      }
    },
    [onExternalUrlDrop, onExternalFileDrop]
  );

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

  // Grid column slider element (inline in header).
  // Hidden by default — auto-responsive columns by viewport instead.
  // Slider code preserved for future toggle via SHOW_GRID_SLIDER flag.
  const gridSliderElement =
    SHOW_GRID_SLIDER && onGridColumnsChange && effectiveViewMode === 'grid' ? (
      <div className="hidden md:flex items-center gap-1.5">
        <LayoutGrid className="w-2.5 h-2.5 text-muted-foreground/60" />
        <Slider
          value={[gridColumns]}
          min={MIN_GRID_COLUMNS}
          max={MAX_GRID_COLUMNS}
          step={1}
          onValueChange={([v]) => onGridColumnsChange(v)}
          className="w-20"
        />
        <Grid3X3 className="w-2.5 h-2.5 text-muted-foreground/60" />
      </div>
    ) : null;

  // Context header
  const contextHeaderElement = (
    <ContextHeader
      title={title}
      totalCardCount={cards.length}
      viewMode={effectiveViewMode}
      onViewModeChange={onViewModeChange}
      selectedCardIds={selectedCardIds}
      onDeleteSelected={handleDeleteSelected}
      sortMode={sortMode}
      onSortModeChange={setSortMode}
      sliderElement={gridSliderElement}
    />
  );

  // Sector pills
  const sectorPillsElement = sectorSubjects && sectorSubjects.length > 0 && (
    <LabelFilterPillsV2
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
    // Combine setGridAreaRef (DnD) and containerRef (ResizeObserver)
    const setCombinedRef = (node: HTMLDivElement | null) => {
      setGridAreaRef(node);
      (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
    };
    return (
      <div
        ref={setCombinedRef}
        onDragOver={handleExternalDragOver}
        onDragLeave={handleExternalDragLeave}
        onDrop={handleExternalDrop}
        className={cn(
          'animate-fade-in transition-all duration-200 relative',
          (isExternalCardDragActive || isExternalDragOver) &&
            '-mx-4 px-4 border-2 border-dashed border-primary bg-primary/5 rounded-md'
        )}
      >
        {isExternalDragOver && (
          <div className="absolute inset-0 flex items-center justify-center bg-primary/10 backdrop-blur-[1px] pointer-events-none z-10">
            <div className="flex flex-col items-center gap-2">
              <div
                className="rounded-md border border-dashed border-primary/40 bg-primary/10 flex items-center justify-center"
                style={{
                  width: '52px',
                  aspectRatio: '16/9',
                  animation: 'card-silhouette-pulse 1.5s ease-in-out infinite',
                }}
              >
                <Plus className="w-4 h-4 text-primary/40" />
              </div>
              <span className="text-primary font-medium text-xs">
                {t('index.dropToAdd', 'Drop to add card')}
              </span>
            </div>
          </div>
        )}
        {contextHeaderElement}
        {sectorPillsElement}
        <CardList
          cards={sortedCards}
          isLoading={isLoading}
          title={title}
          gridColumns={gridColumns}
          compact={gridColumns >= COMPACT_THRESHOLD}
          onCardClick={onCardClick ? (card) => onCardClick(card, sortedCards) : undefined}
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
      <div
        className="h-full flex flex-col animate-fade-in"
        onDragOver={handleExternalDragOver}
        onDragLeave={handleExternalDragLeave}
        onDrop={handleExternalDrop}
      >
        {contextHeaderElement}
        {sectorPillsElement}
        <div className="flex-1 min-h-0">
          <ListView
            cards={sortedCards}
            activeCardId={activeCard?.id ?? null}
            onCardSelect={handleCardSelect}
            onCardClick={onCardClick ? (card) => onCardClick(card, sortedCards) : undefined}
          />
        </div>
      </div>
    );
  }

  // List-detail mode
  return (
    <div
      className="h-full flex flex-col animate-fade-in"
      onDragOver={handleExternalDragOver}
      onDragLeave={handleExternalDragLeave}
      onDrop={handleExternalDrop}
    >
      {contextHeaderElement}
      {sectorPillsElement}
      <div className="flex-1 min-h-0 rounded-lg border overflow-hidden">
        <ResizablePanelGroup direction="horizontal" onLayout={handlePanelResize}>
          <ResizablePanel defaultSize={listPanelRatio} minSize={25} maxSize={60}>
            <ListView
              cards={sortedCards}
              activeCardId={activeCard?.id ?? null}
              onCardSelect={handleCardSelect}
              onCardClick={onCardClick ? (card) => onCardClick(card, sortedCards) : undefined}
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
