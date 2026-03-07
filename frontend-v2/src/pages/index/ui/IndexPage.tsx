import { useRef, useEffect } from 'react';
import { Header } from '@/widgets/header/ui/Header';
import { DropZoneOverlay } from '@/widgets/header/ui/DropZoneOverlay';
import { CardListView } from '@/widgets/card-list-view';
import { VideoPlayerModal } from '@/widgets/video-player/ui/VideoPlayerModal';
import { FloatingScratchPad } from '@/widgets/scratch-pad/ui/FloatingScratchPad';
import { FloatingMandala } from '@/widgets/floating-mandala/ui/FloatingMandala';
import { MandalaGrid } from '@/widgets/mandala-grid/ui/MandalaGrid';

import { useMandalaNavigation } from '../model/useMandalaNavigation';
import { useLayoutPreferences } from '../model/useLayoutPreferences';
import { useCardOrchestrator } from '../model/useCardOrchestrator';
import { useCardDragDrop, useGlobalPaste } from '../model/useCardDragDrop';
import { useVideoModal } from '../model/useVideoModal';
import { useToast } from '@/shared/lib/use-toast';
import { useTranslation } from 'react-i18next';

const IndexPage = () => {
  const { toast } = useToast();
  const { t } = useTranslation();

  // 1. Drag & drop state (independent of other hooks)
  const dragDrop = useCardDragDrop();

  // 2. Layout preferences
  const layout = useLayoutPreferences();

  // 3. Refs to break circular dependency: navigation <-> card orchestrator
  const moveCardsRef = useRef<(...args: any[]) => void>(() => {});
  const swapCardsRef = useRef<(...args: any[]) => void>(() => {});

  // 4. Mandala navigation (wired to card orchestrator via refs)
  const navigation = useMandalaNavigation({
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
    onCardDragStart: dragDrop.handleCardDragStart,
    onDeleteCards: cards.handleDeleteCards,
    onFileDrop: cards.handleScratchPadFileDrop,
    isFloating,
    onToggleFloating: () => layout.handleSetScratchPadFloating(!layout.isScratchPadFloating),
    dockPosition: layout.scratchPadDockPosition,
    onDockPositionChange: layout.handleSetScratchPadDockPosition,
  });

  // Shared MandalaGrid element
  const mandalaGridElement = (isCompact?: boolean) => (
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
      hasSubLevel={navigation.hasSubLevel}
      onNavigateToSubLevel={navigation.handleNavigateToSubLevel}
      onNavigateBack={navigation.handleNavigateBack}
      canGoBack={navigation.path.length > 0}
      entryGridIndex={navigation.entryGridIndex}
      showHint={false}
      hideHeader={true}
      isCompact={isCompact}
    />
  );

  return (
    <div className="h-screen flex flex-col bg-surface-base overflow-hidden">
      <Header onNavigateHome={() => navigation.handleNavigate('root')} />

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

      {/* Floating Mandala */}
      {(layout.isMandalaFloating || layout.isMandalaFloatingMode) && (
        <FloatingMandala
          centerGoal={navigation.currentLevel.centerGoal}
          totalCards={cards.totalCards}
          isMinimized={layout.isMandalaMinimized}
          onToggleMinimized={() => layout.handleSetMandalaMinimized(!layout.isMandalaMinimized)}
          isFloating={true}
          onToggleFloating={() => layout.handleSetMandalaFloating(false)}
          dockPosition={layout.mandalaDockPosition}
          onDockPositionChange={layout.handleSetMandalaDockPosition}
          initialPosition={
            layout.prefMandalaPosX !== undefined && layout.prefMandalaPosY !== undefined
              ? { x: layout.prefMandalaPosX, y: layout.prefMandalaPosY }
              : undefined
          }
          onPositionChange={layout.setMandalaPosition}
        >
          {mandalaGridElement(true)}
        </FloatingMandala>
      )}

      {/* Main Content Area */}
      <main className="flex-1 overflow-hidden flex">
        {/* Left docked ScratchPad */}
        {!layout.isScratchPadFloating && layout.scratchPadDockPosition === 'left' && (
          <div className="flex-shrink-0 bg-surface-mid/90 backdrop-blur-sm border-r border-border/30 relative z-30 h-full">
            <FloatingScratchPad {...scratchPadProps(false)} />
          </div>
        )}

        {/* Left docked Mandala */}
        {!layout.isMandalaFloating && !layout.isMandalaFloatingMode && layout.mandalaDockPosition === 'left' && (
          <FloatingMandala
            centerGoal={navigation.currentLevel.centerGoal}
            totalCards={cards.totalCards}
            isMinimized={layout.isMandalaMinimized}
            onToggleMinimized={() => layout.handleSetMandalaMinimized(!layout.isMandalaMinimized)}
            isFloating={false}
            onToggleFloating={() => layout.handleSetMandalaFloating(true)}
            dockPosition={layout.mandalaDockPosition}
            onDockPositionChange={layout.handleSetMandalaDockPosition}
          >
            {mandalaGridElement()}
          </FloatingMandala>
        )}

        <div className="flex-1 overflow-hidden">
          <div className="container mx-auto px-4 py-4 h-full">
            <div className="flex flex-col lg:flex-row gap-6 lg:gap-8 h-full">
              {/* Card List View (grid / list / list-detail) */}
              <div className="flex-1 min-w-0 overflow-y-auto relative z-10 scrollbar-pro">
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
            </div>
          </div>
        </div>

        {/* Right docked Mandala */}
        {!layout.isMandalaFloating && !layout.isMandalaFloatingMode && layout.mandalaDockPosition === 'right' && (
          <FloatingMandala
            centerGoal={navigation.currentLevel.centerGoal}
            totalCards={cards.totalCards}
            isMinimized={layout.isMandalaMinimized}
            onToggleMinimized={() => layout.handleSetMandalaMinimized(!layout.isMandalaMinimized)}
            isFloating={false}
            onToggleFloating={() => layout.handleSetMandalaFloating(true)}
            dockPosition={layout.mandalaDockPosition}
            onDockPositionChange={layout.handleSetMandalaDockPosition}
          >
            {mandalaGridElement()}
          </FloatingMandala>
        )}

        {/* Right docked ScratchPad */}
        {!layout.isScratchPadFloating && layout.scratchPadDockPosition === 'right' && (
          <div className="flex-shrink-0 bg-surface-mid/90 backdrop-blur-sm border-l border-border/30 relative z-30 h-full">
            <FloatingScratchPad {...scratchPadProps(false)} />
          </div>
        )}
      </main>

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
    </div>
  );
};

export default IndexPage;
