import { useRef, useEffect, useState, useMemo, useCallback, lazy, Suspense } from 'react';
import { DndContext, DragOverlay, type DragStartEvent, type DragOverEvent, type DragEndEvent } from '@dnd-kit/core';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/features/auth/model/useAuth';
import { AppShell } from '@/widgets/app-shell';
import { DropZoneOverlay } from '@/widgets/header/ui/DropZoneOverlay';
import { CardListView } from '@/widgets/card-list-view';
import { VideoPlayerModal } from '@/widgets/video-player/ui/VideoPlayerModal';
import { FloatingScratchPad } from '@/widgets/scratch-pad/ui/FloatingScratchPad';
import { MandalaPanel } from '@/widgets/mandala-panel';
import { MandalaGrid } from '@/widgets/mandala-grid/ui/MandalaGrid';
import { MobileBottomNav } from '@/widgets/mobile-nav';

import { useMandalaQuery, useMandalaList } from '@/features/mandala';
import { useMandalaNavigation } from '../model/useMandalaNavigation';
import { useLayoutPreferences } from '../model/useLayoutPreferences';
import { useCardOrchestrator } from '../model/useCardOrchestrator';
import { useCardDragDrop, useGlobalPaste } from '../model/useCardDragDrop';
import { useVideoModal } from '../model/useVideoModal';
import { useToast } from '@/shared/lib/use-toast';
import { useTranslation } from 'react-i18next';
import {
  useDndSensors,
  DragOverlayContent,
  snapToCursor,
  type DragData,
  type DropData,
} from '@/shared/lib/dnd';

const LandingPage = lazy(() => import('@/pages/landing'));

const IndexPage = () => {
  const { isLoggedIn, isLoading: authLoading } = useAuth();

  if (authLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <Suspense fallback={<div className="h-screen flex items-center justify-center bg-background"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>}>
        <LandingPage />
      </Suspense>
    );
  }

  return <AuthenticatedApp />;
};

function AuthenticatedApp() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const sensors = useDndSensors();

  // 1. Drag & drop state (independent of other hooks)
  const dragDrop = useCardDragDrop();

  // 2. Layout preferences
  const layout = useLayoutPreferences();

  // 2b. Mobile detection for floating panel
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Sidebar mandala accordion state
  const [expandedMandalaId, setExpandedMandalaId] = useState<string | null>(null);
  const [isFloatingPanelOpen, setIsFloatingPanelOpen] = useState(false);

  // Auto-expand default mandala in sidebar
  const { data: mandalaListData } = useMandalaList();
  useEffect(() => {
    if (expandedMandalaId === null && mandalaListData?.mandalas) {
      const defaultMandala = mandalaListData.mandalas.find((m) => m.isDefault);
      if (defaultMandala) {
        setExpandedMandalaId(defaultMandala.id);
      }
    }
  }, [mandalaListData, expandedMandalaId]);

  // 3. Mandala data from DB
  const { mandalaLevels: queryMandalaLevels } = useMandalaQuery();

  // 4. Refs to break circular dependency: navigation <-> card orchestrator
  const moveCardsRef = useRef<(...args: any[]) => void>(() => {});
  const swapCardsRef = useRef<(...args: any[]) => void>(() => {});

  // 5. Mandala navigation (wired to card orchestrator via refs)
  const navigation = useMandalaNavigation({
    initialLevels: queryMandalaLevels,
    onMoveCardsForSubLevel: (from, to, idx) => moveCardsRef.current(from, to, idx),
    onSwapCardsForReorder: (swapped, levelId) => swapCardsRef.current(swapped, levelId),
    toast: (opts) => toast(opts),
    t: (key, opts) => t(key, opts as Record<string, string>),
  });

  // 5. Card orchestrator (needs navigation state)
  const cards = useCardOrchestrator(
    {
      currentLevelId: navigation.currentLevelId,
      currentLevel: navigation.currentLevel,
    },
    navigation.selectedCellIndex,
  );

  // Patch refs after orchestrator init
  useEffect(() => { moveCardsRef.current = cards.moveCardsForSubLevel; }, [cards.moveCardsForSubLevel]);
  useEffect(() => { swapCardsRef.current = cards.swapCardsForReorder; }, [cards.swapCardsForReorder]);

  // 6. Video modal
  const modal = useVideoModal(cards.allMandalaCards, cards.scratchPadCards);

  // Wire card click to open modal
  const handleCardClick = (card: Parameters<typeof modal.openModal>[0]) => {
    modal.openModal(card);
  };

  // 7. Global paste handler
  useGlobalPaste({
    addPendingCard: cards.addPendingCard,
    removePendingCard: cards.removePendingCard,
  });

  // --- dnd-kit state ---
  const [activeDragData, setActiveDragData] = useState<DragData | null>(null);
  const [activeDragCellIndex, setActiveDragCellIndex] = useState<number | null>(null);
  const [activeDragOverCellIndex, setActiveDragOverCellIndex] = useState<number | null>(null);


  // Build a card lookup for DragOverlay
  const allCardsMap = useMemo(() => {
    const map = new Map<string, { thumbnail: string; title: string }>();
    for (const card of [...cards.allMandalaCards, ...cards.scratchPadCards]) {
      map.set(card.id, { thumbnail: card.thumbnail, title: card.title });
    }
    return map;
  }, [cards.allMandalaCards, cards.scratchPadCards]);

  // Build cell label lookup for DragOverlay
  const cellLabels = useMemo(() => {
    const map = new Map<number, string>();
    const gridToSubject: Record<number, number> = { 0:0,1:1,2:2,3:3,5:4,6:5,7:6,8:7 };
    for (const [gridIdx, subIdx] of Object.entries(gridToSubject)) {
      map.set(Number(gridIdx), navigation.currentLevel.subjects[subIdx] || '');
    }
    return map;
  }, [navigation.currentLevel.subjects]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as DragData;
    setActiveDragData(data);


    if (data.type === 'cell') {
      setActiveDragCellIndex(data.gridIndex);
      dragDrop.setIsDraggingCell(true);
    } else if (data.type === 'card' || data.type === 'card-reorder') {
      dragDrop.setDraggingCard(data.card);
    }
  }, [dragDrop]);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const over = event.over;
    if (!over) {
      setActiveDragOverCellIndex(null);
      return;
    }

    const dropData = over.data.current as DropData | undefined;
    if (dropData?.type === 'mandala-cell') {
      setActiveDragOverCellIndex(dropData.gridIndex);
    } else {
      setActiveDragOverCellIndex(null);
    }
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;

    // Reset all drag state
    setActiveDragData(null);
    setActiveDragCellIndex(null);
    setActiveDragOverCellIndex(null);

    dragDrop.setDraggingCard(null);
    dragDrop.setIsDraggingCell(false);

    if (!over) return;

    const dragData = active.data.current as DragData;
    const dropData = over.data.current as DropData;

    if (!dragData || !dropData) return;

    // Card dropped on mandala cell
    if ((dragData.type === 'card' || dragData.type === 'card-reorder') && dropData.type === 'mandala-cell') {
      const gridToSubject: Record<number, number> = { 0:0,1:1,2:2,3:3,5:4,6:5,7:6,8:7 };
      const subjectIndex = gridToSubject[dropData.gridIndex];
      if (subjectIndex === undefined) return;

      if (dragData.type === 'card' && dragData.selectedCardIds && dragData.selectedCardIds.length > 1) {
        cards.handleCardDrop(subjectIndex, undefined, undefined, dragData.selectedCardIds);
      } else {
        cards.handleCardDrop(subjectIndex, undefined, dragData.card.id);
      }
    }

    // Cell dropped on cell (cell swap)
    if (dragData.type === 'cell' && dropData.type === 'mandala-cell') {
      if (dragData.gridIndex !== dropData.gridIndex && dropData.gridIndex !== 4) {
        const gridToSubject: Record<number, number> = { 0:0,1:1,2:2,3:3,5:4,6:5,7:6,8:7 };
        const fromSubjectIndex = gridToSubject[dragData.gridIndex];
        const toSubjectIndex = gridToSubject[dropData.gridIndex];
        if (fromSubjectIndex !== undefined && toSubjectIndex !== undefined) {
          const newSubjects = [...navigation.currentLevel.subjects];
          [newSubjects[fromSubjectIndex], newSubjects[toSubjectIndex]] = [
            newSubjects[toSubjectIndex],
            newSubjects[fromSubjectIndex],
          ];
          navigation.handleSubjectsReorder(newSubjects, {
            from: fromSubjectIndex,
            to: toSubjectIndex,
          });
        }
      }
    }

    // Card dropped on card slot (reorder within CardList)
    if (dragData.type === 'card-reorder' && dropData.type === 'card-slot') {
      const draggedId = dragData.card.id;
      const targetId = dropData.cardId;
      if (draggedId === targetId) return;

      const sortedCards = [...cards.displayCards].sort((a, b) => {
        if (a.sortOrder !== undefined && b.sortOrder !== undefined) return a.sortOrder - b.sortOrder;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

      const draggedIndex = sortedCards.findIndex((c) => c.id === draggedId);
      const targetIndex = sortedCards.findIndex((c) => c.id === targetId);
      if (draggedIndex === -1 || targetIndex === -1) return;

      const newCards = [...sortedCards];
      const [removed] = newCards.splice(draggedIndex, 1);
      newCards.splice(targetIndex, 0, removed);

      const reorderedCards = newCards.map((card, index) => ({
        ...card,
        sortOrder: index,
      }));

      cards.handleCardsReorder?.(reorderedCards);
    }

    // Card dropped on scratchpad
    if ((dragData.type === 'card' || dragData.type === 'card-reorder') && dropData.type === 'scratchpad') {
      if (dragData.type === 'card' && dragData.selectedCardIds && dragData.selectedCardIds.length > 1) {
        cards.handleScratchPadMultiCardDrop?.(dragData.selectedCardIds);
      } else {
        cards.handleScratchPadCardDrop(dragData.card.id);
      }
    }
  }, [cards, navigation, dragDrop]);

  const handleDragCancel = useCallback(() => {
    setActiveDragData(null);
    setActiveDragCellIndex(null);
    setActiveDragOverCellIndex(null);

    dragDrop.setDraggingCard(null);
    dragDrop.setIsDraggingCell(false);
  }, [dragDrop]);

  // Shared ScratchPad props factory
  const scratchPadProps = (isFloating: boolean) => ({
    cards: cards.scratchPadCards,
    isDropTarget: dragDrop.isScratchPadDropTarget,
    onDrop: cards.handleScratchPadDrop,
    onCardDrop: cards.handleScratchPadCardDrop,
    onMultiCardDrop: cards.handleScratchPadMultiCardDrop,
    onCardClick: handleCardClick,
    onDragOver: () => dragDrop.setIsScratchPadDropTarget(true),
    onDragLeave: () => dragDrop.setIsScratchPadDropTarget(false),
    onDeleteCards: cards.handleDeleteCards,
    onFileDrop: cards.handleScratchPadFileDrop,
    isFloating,
    onToggleFloating: () => layout.handleSetScratchPadFloating(!layout.isScratchPadFloating),
    dockPosition: layout.scratchPadDockPosition,
    onDockPositionChange: layout.handleSetScratchPadDockPosition,
  });

  // Shared MandalaGrid element
  const mandalaGridElement = () => (
    <MandalaGrid
      level={navigation.currentLevel}
      cardsByCell={cards.cardsByCell}
      selectedCellIndex={navigation.selectedCellIndex}
      onCellClick={navigation.handleCellClick}
      onCardDrop={cards.handleCardDrop}
      onCardClick={handleCardClick}
      onCardDragStart={dragDrop.handleCardDragStart}
      onSubjectsReorder={navigation.handleSubjectsReorder}
      onCellDragging={dragDrop.setIsDraggingCell}
      isGridDropZone={dragDrop.isDraggingOver && !dragDrop.draggingCard && !dragDrop.isDraggingCell}
      activeDragCellIndex={activeDragCellIndex}
      activeDragOverCellIndex={activeDragOverCellIndex}
      hasSubLevel={navigation.hasSubLevel}
      onNavigateToSubLevel={navigation.handleNavigateToSubLevel}
      onNavigateBack={navigation.handleNavigateBack}
      canGoBack={navigation.path.length > 0}
      entryGridIndex={navigation.entryGridIndex}
      showHint={false}
      hideHeader={true}
    />
  );

  const announcements = useMemo(() => ({
    onDragStart({ active }) {
      const data = active.data.current as DragData | undefined;
      if (data?.type === 'cell') return t('dnd.dragStartCell', 'Picked up cell');
      if (data?.type === 'card' || data?.type === 'card-reorder') return t('dnd.dragStartCard', 'Picked up card');
      return t('dnd.dragStart', 'Dragging');
    },
    onDragOver({ over }) {
      if (over) return t('dnd.dragOver', 'Over drop zone');
      return t('dnd.dragOutside', 'Outside drop zone');
    },
    onDragEnd({ over }) {
      if (over) return t('dnd.dropped', 'Dropped');
      return t('dnd.dragCancel', 'Drag cancelled');
    },
    onDragCancel() {
      return t('dnd.dragCancel', 'Drag cancelled');
    },
  }), [t]);

  return (
    <DndContext
      sensors={sensors}
      accessibility={{ announcements }}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <AppShell
        onNavigateHome={() => navigation.handleNavigate('root')}
        mandalaGridElement={mandalaGridElement()}
        expandedMandalaId={expandedMandalaId}
        onExpandedMandalaChange={setExpandedMandalaId}
      >
        <div className="h-full flex flex-col overflow-hidden">
          <DropZoneOverlay
            isVisible={dragDrop.isDraggingOver && !dragDrop.draggingCard && !dragDrop.isDraggingCell}
          />

          {/* Top docked ScratchPad */}
          {!layout.isScratchPadFloating && layout.scratchPadDockPosition === 'top' && (
            <div className="flex-shrink-0 relative z-30">
              <FloatingScratchPad {...scratchPadProps(false)} />
            </div>
          )}

          {/* Floating ScratchPad */}
          {layout.isScratchPadFloating && (
            <FloatingScratchPad
              {...scratchPadProps(true)}
              initialPosition={
                layout.prefScratchpadPosX !== undefined && layout.prefScratchpadPosY !== undefined
                  ? { x: layout.prefScratchpadPosX, y: layout.prefScratchpadPosY }
                  : undefined
              }
              onPositionChange={layout.setScratchPadPosition}
            />
          )}

          {/* Main Content Area — CardListView always full width */}
          <div className="flex-1 overflow-hidden flex">
            {/* Left docked ScratchPad */}
            {!layout.isScratchPadFloating && layout.scratchPadDockPosition === 'left' && (
              <div className="flex-shrink-0 bg-surface-mid/90 backdrop-blur-sm border-r border-border/30 relative z-30 h-full">
                <FloatingScratchPad {...scratchPadProps(false)} />
              </div>
            )}

            <div className="flex-1 h-full overflow-y-auto px-4 py-4">
              <CardListView
                cards={cards.displayCards}
                title={cards.displayTitle}
                viewMode={layout.viewMode}
                listPanelRatio={layout.listPanelRatio}
                onViewModeChange={layout.handleSetViewMode}
                onListPanelRatioChange={layout.handleSetListPanelRatio}
                onCardClick={handleCardClick}
                onCardDragStart={dragDrop.handleCardDragStart}
                onMultiCardDragStart={dragDrop.handleMultiCardDragStart}
                onSaveNote={cards.handleSaveNote}
                onCardsReorder={cards.handleCardsReorder}
                onDeleteCards={cards.handleDeleteCards}
              />
            </div>

            {/* Right docked ScratchPad */}
            {!layout.isScratchPadFloating && layout.scratchPadDockPosition === 'right' && (
              <div className="flex-shrink-0 bg-surface-mid/90 backdrop-blur-sm border-l border-border/30 relative z-30 h-full">
                <FloatingScratchPad {...scratchPadProps(false)} />
              </div>
            )}
          </div>

          {/* Bottom docked ScratchPad */}
          {!layout.isScratchPadFloating && layout.scratchPadDockPosition === 'bottom' && (
            <div className="flex-shrink-0 bg-surface-mid/90 backdrop-blur-sm border-t border-border/30 relative z-30">
              <FloatingScratchPad {...scratchPadProps(false)} />
            </div>
          )}

          <VideoPlayerModal
            card={modal.currentModalCard}
            isOpen={modal.isModalOpen}
            onClose={modal.closeModal}
            onSave={cards.handleSaveNote}
            onSaveWatchPosition={cards.handleSaveWatchPosition}
          />

          {/* Mobile-only floating MandalaPanel */}
          {isMobile && (
            <MandalaPanel
              mode="floating"
              totalCards={cards.totalCards}
              onToggleMode={() => {}}
              isOpen={isFloatingPanelOpen}
              onOpenChange={setIsFloatingPanelOpen}
            >
              {mandalaGridElement()}
            </MandalaPanel>
          )}

          <MobileBottomNav
            currentView={layout.viewMode}
            onViewChange={layout.handleSetViewMode}
            onNavigateHome={() => navigation.handleNavigate('root')}
            onOpenMandala={() => setIsFloatingPanelOpen(true)}
          />
        </div>
      </AppShell>

      <DragOverlay dropAnimation={null} modifiers={[snapToCursor]}>
        <DragOverlayContent
          dragData={activeDragData}
          allCards={allCardsMap}
          cellLabels={cellLabels}
        />
      </DragOverlay>
    </DndContext>
  );
}

export default IndexPage;
