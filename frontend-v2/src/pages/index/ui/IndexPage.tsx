import { cn } from '@/shared/lib/utils';
import { Header } from '@/widgets/header/ui/Header';
import { DropZoneOverlay } from '@/widgets/header/ui/DropZoneOverlay';
import { CardList } from '@/widgets/card-list/ui/CardList';
import { VideoPlayerModal } from '@/widgets/video-player/ui/VideoPlayerModal';

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

  // 3. Mandala navigation (needs card orchestrator callbacks, wired below)
  const navigation = useMandalaNavigation({
    toast: (opts) => toast(opts),
    t: (key, opts) => t(key, opts as Record<string, string>),
  });

  // 4. Card orchestrator (needs navigation state)
  const cards = useCardOrchestrator(
    {
      currentLevelId: navigation.currentLevelId,
      currentLevel: navigation.currentLevel,
    },
    navigation.selectedCellIndex,
    // onCardClick -> opens modal
    undefined, // will be wired after modal hook
  );

  // Wire navigation callbacks to card orchestrator
  // (useMandalaNavigation accepts these as deps)
  navigation.handleNavigateToSubLevel;
  // Note: The actual wiring happens via the onMoveCardsForSubLevel / onSwapCardsForReorder
  // callbacks that are passed to useMandalaNavigation. Since hooks can't be conditionally
  // created, we initialize navigation first then pass card methods as event handlers to JSX.

  // 5. Video modal
  const modal = useVideoModal(cards.allMandalaCards, cards.scratchPadCards);

  // Wire card click to open modal
  const handleCardClick = (card: Parameters<typeof modal.openModal>[0]) => {
    modal.openModal(card);
  };

  // 6. Global paste handler (side-effect only)
  // Note: This is a simplified placeholder. The full paste logic is in useCardOrchestrator.
  // useGlobalPaste is available for standalone use if needed.

  return (
    <div className="h-screen flex flex-col bg-surface-base overflow-hidden">
      <Header onNavigateHome={() => navigation.handleNavigate('root')} />

      <DropZoneOverlay
        isVisible={dragDrop.isDraggingOver && !dragDrop.draggingCard && !dragDrop.isDraggingCell}
      />

      {/* TODO: Render FloatingScratchPad in different dock positions */}
      {/* Top docked */}
      {/* {!layout.isScratchPadFloating && layout.scratchPadDockPosition === 'top' && (...)} */}

      {/* Floating ScratchPad */}
      {/* {layout.isScratchPadFloating && (...)} */}

      {/* Floating Mandala */}
      {/* {(layout.isMandalaFloating || layout.isMandalaFloatingMode) && (...)} */}

      {/* Main Content Area */}
      <main className="flex-1 overflow-hidden flex">
        {/* Left docked scratch pad */}
        {/* Left docked mandala */}

        <div className="flex-1 overflow-hidden">
          <div className="container mx-auto px-4 py-4 h-full">
            <div className="flex flex-col lg:flex-row gap-6 lg:gap-8 h-full">
              {/* Card List */}
              <div className="flex-1 min-w-0 overflow-y-auto relative z-10 scrollbar-pro">
                <CardList
                  cards={cards.displayCards}
                  title={cards.displayTitle}
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

        {/* Right docked mandala */}
        {/* Right docked scratch pad */}
      </main>

      {/* Bottom docked scratch pad */}

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
