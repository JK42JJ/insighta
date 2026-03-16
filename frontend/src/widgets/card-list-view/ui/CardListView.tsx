import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Move, Trash2, Plus } from 'lucide-react';
import type { InsightCard } from '@/entities/card/model/types';
import type { ViewMode } from '@/entities/user/model/types';
import { ViewSwitcher } from '@/features/view-mode';
import { CardList } from '@/widgets/card-list/ui/CardList';
import { ListView } from '@/widgets/list-view';
import { DetailPanel } from '@/widgets/detail-panel';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/shared/ui/resizable';
import { Popover, PopoverTrigger, PopoverContent } from '@/shared/ui/popover';
import { Input } from '@/shared/ui/input';

interface CardListViewProps {
  cards: InsightCard[];
  isLoading?: boolean;
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
  onAddCard?: (url: string) => void;
  onSaveWatchPosition?: (id: string, positionSeconds: number) => void;
  watchPositionCache?: Map<string, number>;
  panelSizeCache?: Map<string, number>;
}

export function CardListView({
  cards,
  isLoading,
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
  onAddCard,
  onSaveWatchPosition,
  watchPositionCache,
  panelSizeCache,
}: CardListViewProps) {
  const { t } = useTranslation();
  const [activeCard, setActiveCard] = useState<InsightCard | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);

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

  const handleSelectionChange = useCallback((ids: string[]) => {
    setSelectedCardIds(ids);
  }, []);

  const handleDeleteSelected = useCallback(() => {
    if (selectedCardIds.length > 0) {
      onDeleteCards?.(selectedCardIds);
    }
  }, [selectedCardIds, onDeleteCards]);

  // Add card popover state
  const [addCardUrl, setAddCardUrl] = useState('');
  const [isAddCardOpen, setIsAddCardOpen] = useState(false);
  const addCardInputRef = useRef<HTMLInputElement>(null);

  const handleAddCardSubmit = useCallback(() => {
    const trimmed = addCardUrl.trim();
    if (!trimmed || !onAddCard) return;
    onAddCard(trimmed);
    setAddCardUrl('');
    setIsAddCardOpen(false);
  }, [addCardUrl, onAddCard]);

  // Header with title, sort info, and ViewSwitcher
  const headerElement = (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-3">
        <h3 className="text-lg font-semibold">
          {title} {t('cards.insights')}
        </h3>
        {selectedCardIds.length > 0 && (
          <div className="flex items-center gap-1.5 animate-fade-in">
            <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full">
              {t('cards.selected', { count: selectedCardIds.length })}
            </span>
            <button
              onClick={handleDeleteSelected}
              className="p-1 rounded text-destructive hover:bg-destructive/10 transition-colors"
              title={t('cards.deleteSelected')}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
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
        {onAddCard && (
          <Popover open={isAddCardOpen} onOpenChange={setIsAddCardOpen}>
            <PopoverTrigger asChild>
              <button
                className="p-1.5 rounded-md hover:bg-accent transition-colors"
                title={t('cards.addCard')}
              >
                <Plus className="w-4 h-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-3">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleAddCardSubmit();
                }}
                className="flex gap-2"
              >
                <Input
                  ref={addCardInputRef}
                  value={addCardUrl}
                  onChange={(e) => setAddCardUrl(e.target.value)}
                  placeholder={t('cards.addCardPlaceholder')}
                  className="h-8 text-sm"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={!addCardUrl.trim()}
                  className="shrink-0 h-8 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none transition-colors"
                >
                  {t('cards.addCard')}
                </button>
              </form>
            </PopoverContent>
          </Popover>
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
          isLoading={isLoading}
          title={title}
          onCardClick={onCardClick}
          onCardDragStart={onCardDragStart}
          onMultiCardDragStart={onMultiCardDragStart}
          onSaveNote={onSaveNote}
          onCardsReorder={onCardsReorder}
          onDeleteCards={onDeleteCards}
          onSelectionChange={handleSelectionChange}
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
        <ResizablePanelGroup direction="horizontal" onLayout={handlePanelResize}>
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
