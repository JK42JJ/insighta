import { useRef, useEffect, useState, useMemo, useCallback, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DragOverlay,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/features/auth/model/useAuth';
import { useShellStore, dndHandlersRef } from '@/stores/shellStore';
import { DropZoneOverlay } from '@/widgets/header/ui/DropZoneOverlay';
import { CardListView } from '@/widgets/card-list-view';
import { VideoPlayerModal } from '@/widgets/video-player/ui/VideoPlayerModal';
import { FloatingScratchPad } from '@/widgets/scratch-pad/ui/FloatingScratchPad';
import { MandalaPanel } from '@/widgets/mandala-panel';
import { MandalaGrid } from '@/widgets/mandala-grid/ui/MandalaGrid';
import { MobileBottomNav } from '@/widgets/mobile-nav';
import { InsightsView } from '@/widgets/insights-view';

import { useMandalaQuery, useMandalaList } from '@/features/mandala';
import { useMandalaStore } from '@/stores/mandalaStore';
import { useSearchCards, SearchBar } from '@/features/search';
import { useMandalaNavigation } from '../model/useMandalaNavigation';
import { useLayoutPreferences } from '../model/useLayoutPreferences';
import { useCardOrchestrator } from '../model/useCardOrchestrator';
import { useCardDragDrop, useGlobalPaste } from '../model/useCardDragDrop';
import { useVideoModal } from '../model/useVideoModal';
import { useToast } from '@/shared/lib/use-toast';
import { useTranslation } from 'react-i18next';
import {
  DragOverlayContent,
  snapToCursor,
  type DragData,
  type DropData,
  cardDragId,
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
      <Suspense
        fallback={
          <div className="h-screen flex items-center justify-center bg-background">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        }
      >
        <LandingPage />
      </Suspense>
    );
  }

  return <AuthenticatedApp />;
};

function AuthenticatedApp() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useTranslation();

  // OAuth callback: consume returnTo from sessionStorage
  useEffect(() => {
    const returnTo = sessionStorage.getItem('auth-return-to');
    if (returnTo && returnTo.startsWith('/')) {
      sessionStorage.removeItem('auth-return-to');
      navigate(returnTo, { replace: true });
    }
  }, [navigate]);

  // 1. Drag & drop state (independent of other hooks)
  const dragDrop = useCardDragDrop();

  // 2. Layout preferences
  const layout = useLayoutPreferences();

  // 2b. Mobile detection for floating panel
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const [isFloatingPanelOpen, setIsFloatingPanelOpen] = useState(false);

  const { data: mandalaListData, isSuccess: isMandalaListLoaded } = useMandalaList();

  // New user: redirect to wizard when 0 mandalas
  useEffect(() => {
    if (isMandalaListLoaded && mandalaListData?.mandalas?.length === 0) {
      navigate('/mandalas/new', { replace: true });
    }
  }, [isMandalaListLoaded, mandalaListData, navigate]);

  // Selected mandala — Zustand store is source of truth, synced from sidebar + default init
  const storeSelectedMandalaId = useMandalaStore((s) => s.selectedMandalaId);
  const [selectedMandalaId, setSelectedMandalaId] = useState<string | null>(null);

  // Sync store → local state (sidebar mandala selection triggers this)
  useEffect(() => {
    if (storeSelectedMandalaId && storeSelectedMandalaId !== selectedMandalaId) {
      setSelectedMandalaId(storeSelectedMandalaId);
    }
  }, [storeSelectedMandalaId]);

  // Initialize default mandala
  useEffect(() => {
    if (!selectedMandalaId && mandalaListData?.mandalas) {
      const defaultMandala = mandalaListData.mandalas.find((m) => m.isDefault);
      if (defaultMandala) setSelectedMandalaId(defaultMandala.id);
    }
  }, [mandalaListData, selectedMandalaId]);

  // Effective mandalaId: resolves immediately from cached data even before useEffect fires
  const effectiveMandalaId = useMemo(() => {
    if (selectedMandalaId) return selectedMandalaId;
    if (mandalaListData?.mandalas) {
      const defaultMandala = mandalaListData.mandalas.find((m) => m.isDefault);
      if (defaultMandala) return defaultMandala.id;
    }
    return null;
  }, [selectedMandalaId, mandalaListData]);

  // 3. Mandala data from DB (by selected mandala ID)
  const { mandalaLevels: queryMandalaLevels } = useMandalaQuery(effectiveMandalaId);

  // 4. Refs to break circular dependency: navigation <-> card orchestrator
  const moveCardsRef = useRef<(...args: unknown[]) => void>(() => {});
  const swapCardsRef = useRef<(...args: unknown[]) => void>(() => {});

  // 5. Mandala navigation (wired to card orchestrator via refs)
  const navigation = useMandalaNavigation({
    initialLevels: queryMandalaLevels,
    mandalaId: effectiveMandalaId,
    onMoveCardsForSubLevel: (from, to, idx) => moveCardsRef.current(from, to, idx),
    onSwapCardsForReorder: (swapped, levelId) => swapCardsRef.current(swapped, levelId),
    toast: (opts) => toast(opts),
    t: (key, opts) => t(key, opts as Record<string, string>),
  });

  // 5a. Bridge: sync UI selection state to Zustand store (additive — existing props untouched)
  // Using store API directly (not hook) since these are write-only syncs — no re-render needed.
  useEffect(() => {
    useMandalaStore.getState().selectMandala(effectiveMandalaId);
  }, [effectiveMandalaId]);
  useEffect(() => {
    useMandalaStore.getState().setCurrentLevel(navigation.currentLevelId);
  }, [navigation.currentLevelId]);
  useEffect(() => {
    useMandalaStore.getState().setSelectedCell(navigation.selectedCellIndex);
  }, [navigation.selectedCellIndex]);

  // 5. Card orchestrator (needs navigation state)
  const cards = useCardOrchestrator(
    {
      currentLevelId: navigation.currentLevelId,
      currentLevel: navigation.currentLevel,
      mandalaId: effectiveMandalaId,
    },
    navigation.selectedCellIndex
  );

  // Patch refs after orchestrator init
  useEffect(() => {
    moveCardsRef.current = cards.moveCardsForSubLevel;
  }, [cards.moveCardsForSubLevel]);
  useEffect(() => {
    swapCardsRef.current = cards.swapCardsForReorder;
  }, [cards.swapCardsForReorder]);

  // 5b. Search
  const search = useSearchCards();

  // 5c. Scroll highlighted search result into view
  const highlightedCard = search.getHighlightedCard();
  useEffect(() => {
    if (!highlightedCard) return;
    const el = document.querySelector(`[data-card-id="${highlightedCard.id}"]`);
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      el.classList.add('ring-2', 'ring-primary', 'ring-offset-1');
      return () => {
        el.classList.remove('ring-2', 'ring-primary', 'ring-offset-1');
      };
    }
  }, [highlightedCard]);

  // 6. Video modal
  const modal = useVideoModal(cards.allMandalaCards, cards.scratchPadCards);

  // Wire card click to open modal
  const handleCardClick = (card: Parameters<typeof modal.openModal>[0]) => {
    modal.openModal(card);
  };

  // 7a. Add card via URL (reuses handleCardDrop)
  const handleAddCard = useCallback(
    (url: string) => {
      if (navigation.selectedCellIndex == null) return;
      cards.handleCardDrop(navigation.selectedCellIndex, url);
    },
    [navigation.selectedCellIndex, cards]
  );

  // 7. Global paste handler
  useGlobalPaste({
    addPendingCard: cards.addPendingCard,
    removePendingCard: cards.removePendingCard,
    persistedLocalCards: cards.persistedLocalCards,
    pendingLocalCards: cards.pendingLocalCards,
  });

  // --- dnd-kit state ---
  const [activeDragData, setActiveDragData] = useState<DragData | null>(null);
  const [activeDragCellIndex, setActiveDragCellIndex] = useState<number | null>(null);
  const [activeDragOverCellIndex, setActiveDragOverCellIndex] = useState<number | null>(null);

  // 드래그 시작 시점의 selectedCardIds 스냅샷 — 드래그 중 selection 변경에 영향받지 않도록
  const dragSelectedIdsRef = useRef<string[] | null>(null);

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
    const gridToSubject: Record<number, number> = {
      0: 0,
      1: 1,
      2: 2,
      3: 3,
      5: 4,
      6: 5,
      7: 6,
      8: 7,
    };
    for (const [gridIdx, subIdx] of Object.entries(gridToSubject)) {
      map.set(Number(gridIdx), navigation.currentLevel.subjects[subIdx] || '');
    }
    return map;
  }, [navigation.currentLevel.subjects]);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const data = event.active.data.current as DragData;
      setActiveDragData(data);

      // 멀티 선택 스냅샷 캡처 — 드래그 중 selection 변경에 영향받지 않도록
      if (data.type === 'card' && data.selectedCardIds && data.selectedCardIds.length > 1) {
        dragSelectedIdsRef.current = [...data.selectedCardIds];
      } else {
        dragSelectedIdsRef.current = null;
      }

      if (data.type === 'cell') {
        setActiveDragCellIndex(data.gridIndex);
        dragDrop.setIsDraggingCell(true);
      } else if (data.type === 'card' || data.type === 'card-reorder') {
        dragDrop.setDraggingCard(data.card);
      }
    },
    [dragDrop]
  );

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

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      // 스냅샷 캡처 후 ref 정리 (state reset 전에 읽어둠)
      const multiCardIds = dragSelectedIdsRef.current;
      dragSelectedIdsRef.current = null;

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
      if (
        (dragData.type === 'card' || dragData.type === 'card-reorder') &&
        dropData.type === 'mandala-cell'
      ) {
        const gridToSubject: Record<number, number> = {
          0: 0,
          1: 1,
          2: 2,
          3: 3,
          5: 4,
          6: 5,
          7: 6,
          8: 7,
        };
        const subjectIndex = gridToSubject[dropData.gridIndex];
        if (subjectIndex === undefined) return;

        if (multiCardIds && multiCardIds.length > 1) {
          cards.handleCardDrop(subjectIndex, undefined, undefined, multiCardIds);
        } else {
          cards.handleCardDrop(subjectIndex, undefined, dragData.card.id);
        }
      }

      // Cell dropped on cell (cell swap)
      if (dragData.type === 'cell' && dropData.type === 'mandala-cell') {
        if (dragData.gridIndex !== dropData.gridIndex && dropData.gridIndex !== 4) {
          const gridToSubject: Record<number, number> = {
            0: 0,
            1: 1,
            2: 2,
            3: 3,
            5: 4,
            6: 5,
            7: 6,
            8: 7,
          };
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
          if (a.sortOrder !== undefined && b.sortOrder !== undefined)
            return a.sortOrder - b.sortOrder;
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

      // ScratchPad internal reorder: both active and over are scratchpad cards
      const activeSource =
        dragData.type === 'card' ? (dragData as { source?: string }).source : undefined;
      const overSource = (over.data.current as Record<string, unknown> | undefined)?.source;
      if (activeSource === 'scratchpad' && overSource === 'scratchpad' && active.id !== over.id) {
        const sortedSP = [...cards.scratchPadCards].sort((a, b) => {
          if (a.sortOrder != null && b.sortOrder != null) return a.sortOrder - b.sortOrder;
          if (a.sortOrder != null) return -1;
          if (b.sortOrder != null) return 1;
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });
        const oldIndex = sortedSP.findIndex((c) => cardDragId(c.id) === String(active.id));
        const newIndex = sortedSP.findIndex((c) => cardDragId(c.id) === String(over.id));
        if (oldIndex !== -1 && newIndex !== -1) {
          const reordered = arrayMove(sortedSP, oldIndex, newIndex).map((card, index) => ({
            ...card,
            sortOrder: index,
          }));
          cards.handleCardsReorder?.(reordered);
        }
        return;
      }

      // Card dropped on scratchpad
      if (
        (dragData.type === 'card' || dragData.type === 'card-reorder') &&
        dropData.type === 'scratchpad'
      ) {
        if (multiCardIds && multiCardIds.length > 1) {
          cards.handleScratchPadMultiCardDrop?.(multiCardIds);
        } else {
          cards.handleScratchPadCardDrop(dragData.card.id);
        }
      }

      // Card dropped on grid area OR on a card-slot from Ideation (sector must be selected)
      const isGridAreaDrop =
        (dragData.type === 'card' || dragData.type === 'card-reorder') &&
        (dropData.type === 'grid-area' ||
          (dragData.type === 'card' && dropData.type === 'card-slot'));

      if (isGridAreaDrop) {
        if (navigation.selectedCellIndex !== null) {
          if (multiCardIds && multiCardIds.length > 1) {
            cards.handleCardDrop(navigation.selectedCellIndex, undefined, undefined, multiCardIds);
          } else {
            cards.handleCardDrop(navigation.selectedCellIndex, undefined, dragData.card.id);
          }
        } else {
          // "All" selected — show toast to select a sector first
          toast({
            title: t('contextHeader.selectSectorFirst', 'Select a sector'),
            description: t(
              'contextHeader.selectSectorDesc',
              'Choose a sector from the pills above to assign cards.'
            ),
          });
        }
      }
    },
    [cards, navigation, dragDrop, toast, t]
  );

  const handleDragCancel = useCallback(() => {
    dragSelectedIdsRef.current = null;

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
      mandalaId={effectiveMandalaId}
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
      isCardDragActive={
        activeDragData !== null &&
        (activeDragData.type === 'card' || activeDragData.type === 'card-reorder')
      }
    />
  );

  // -- Shell store sync --
  const setMinimapData = useShellStore((s) => s.setMinimapData);
  const setSearchBarElement = useShellStore((s) => s.setSearchBarElement);
  const setOnNavigateHome = useShellStore((s) => s.setOnNavigateHome);
  const clearShell = useShellStore((s) => s.clearShell);

  // cleanup on unmount only
  useEffect(() => {
    return () => {
      clearShell();
      dndHandlersRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // navigateHome — ref to avoid deps on navigation object
  const navigateHomeRef = useRef(() => navigation.handleNavigate('root'));
  navigateHomeRef.current = () => navigation.handleNavigate('root');
  useEffect(() => {
    setOnNavigateHome(() => navigateHomeRef.current());
  }, [setOnNavigateHome]);

  // dndHandlers — sync via module-level ref (always latest, no useEffect delay)
  dndHandlersRef.current = {
    onDragStart: handleDragStart,
    onDragOver: handleDragOver,
    onDragEnd: handleDragEnd,
    onDragCancel: handleDragCancel,
  };

  // minimapData — sync to shell store for sidebar minimap
  useEffect(() => {
    setMinimapData({
      cardsByCell: cards.cardsByCell,
      sectorSubjects: navigation.currentLevel.subjects,
      sectorLabels: navigation.currentLevel.subjectLabels,
      centerGoal: navigation.currentLevel.centerGoal,
      selectedCellIndex: navigation.selectedCellIndex,
      onCellClick: navigation.handleCellClick,
      mandalaId: selectedMandalaId,
      onExternalUrlDrop: (cellIndex: number, url: string) => {
        cards.handleCardDrop(cellIndex, url);
      },
    });
  }, [
    cards.cardsByCell,
    navigation.currentLevel.centerGoal,
    navigation.currentLevel.subjects,
    navigation.currentLevel.subjectLabels,
    navigation.selectedCellIndex,
    selectedMandalaId,
    setMinimapData,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  // searchBar — useMemo with primitive deps only
  const searchBarMemo = useMemo(
    () => (
      <SearchBar
        value={search.searchTerm}
        onChange={search.setSearchTerm}
        onClear={search.clearSearch}
        isLoading={search.isLoading}
        resultCount={search.total}
        filteredCount={search.filteredCount}
        isSearchActive={search.isSearchActive}
        sourceFilter={search.sourceFilter}
        onSourceFilterChange={search.setSourceFilter}
        onArrowDown={() => search.moveHighlight('down')}
        onArrowUp={() => search.moveHighlight('up')}
        onEnter={() => {
          const card = search.getHighlightedCard();
          if (card) handleCardClick(card);
        }}
      />
    ),
    [
      search.searchTerm,
      search.isLoading,
      search.total,
      search.filteredCount,
      search.isSearchActive,
      search.sourceFilter,
    ] // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    setSearchBarElement(searchBarMemo);
  }, [searchBarMemo, setSearchBarElement]);

  return (
    <>
      <div className="h-full flex flex-col overflow-hidden">
        {/* External drag overlay removed — each drop zone (CardListView, minimap cells,
            ScratchPad) handles its own visual feedback. Full-page overlay caused confusion
            with duplicate dashed borders and z-index blocking issues. */}
        {/* Internal drag overlay (subtle dimming only) */}
        <DropZoneOverlay
          isVisible={
            activeDragData !== null &&
            (activeDragData.type === 'card' || activeDragData.type === 'card-reorder')
          }
          isInternalDrag
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

          <div
            className={`flex-1 h-full px-4 py-4 ${modal.isModalOpen ? 'overflow-hidden' : 'overflow-y-auto'}`}
          >
            {/* Mobile search bar (hidden on md+, shown in header instead) */}
            <div className="md:hidden mb-3">
              <SearchBar
                value={search.searchTerm}
                onChange={search.setSearchTerm}
                onClear={search.clearSearch}
                isLoading={search.isLoading}
                resultCount={search.total}
                filteredCount={search.filteredCount}
                isSearchActive={search.isSearchActive}
                sourceFilter={search.sourceFilter}
                onSourceFilterChange={search.setSourceFilter}
                onArrowDown={() => search.moveHighlight('down')}
                onArrowUp={() => search.moveHighlight('up')}
                onEnter={() => {
                  const card = search.getHighlightedCard();
                  if (card) handleCardClick(card);
                }}
              />
            </div>
            {layout.viewMode === 'insights' ? (
              <InsightsView
                allCards={cards.allMandalaCards}
                scratchPadCards={cards.scratchPadCards}
                cardsByCell={cards.cardsByCell}
                totalCards={cards.totalCards}
                sectorSubjects={navigation.currentLevel.subjects}
                sectorLabels={navigation.currentLevel.subjectLabels}
                title={navigation.currentLevel.centerGoal}
                viewMode={layout.viewMode}
                onViewModeChange={layout.handleSetViewMode}
                mandalaId={effectiveMandalaId}
              />
            ) : (
              <CardListView
                cards={search.isSearchActive ? search.results : cards.displayCards}
                isLoading={search.isSearchActive ? search.isLoading : cards.isLoading}
                title={
                  search.isSearchActive ? t('search.results', 'Search Results') : cards.displayTitle
                }
                viewMode={layout.viewMode}
                listPanelRatio={layout.listPanelRatio}
                mandalaId={effectiveMandalaId}
                onViewModeChange={layout.handleSetViewMode}
                onListPanelRatioChange={layout.handleSetListPanelRatio}
                gridColumns={layout.gridColumns}
                onGridColumnsChange={layout.handleSetGridColumns}
                onCardClick={handleCardClick}
                onCardDragStart={dragDrop.handleCardDragStart}
                onMultiCardDragStart={dragDrop.handleMultiCardDragStart}
                onSaveNote={cards.handleSaveNote}
                onCardsReorder={cards.handleCardsReorder}
                onDeleteCards={cards.handleDeleteCards}
                onAddCard={navigation.selectedCellIndex != null ? handleAddCard : undefined}
                onExternalUrlDrop={(url) => {
                  if (navigation.selectedCellIndex != null) {
                    cards.handleCardDrop(navigation.selectedCellIndex, url);
                  } else {
                    cards.handleScratchPadDrop(url);
                  }
                }}
                onExternalFileDrop={(files) => {
                  cards.handleScratchPadFileDrop(files);
                }}
                onSaveWatchPosition={cards.handleSaveWatchPosition}
                watchPositionCache={modal.watchPositionCache}
                panelSizeCache={modal.panelSizeCache}
                enrichingCardIds={cards.enrichingCardIds}
                failedEnrichCardIds={cards.failedEnrichCardIds}
                onRetryEnrich={cards.retryEnrich}
                sectorSubjects={navigation.currentLevel.subjects}
                selectedCellIndex={navigation.selectedCellIndex}
                onCellClick={navigation.handleCellClick}
                totalCardCount={cards.totalCards}
                cardsByCell={cards.cardsByCell}
                isExternalCardDragActive={activeDragData?.type === 'card'}
              />
            )}
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
          watchPositionCache={modal.watchPositionCache}
          panelSizeCache={modal.panelSizeCache}
          onEnrichStart={cards.markEnrichStart}
          onEnrichEnd={cards.markEnrichEnd}
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
      <DragOverlay dropAnimation={null} modifiers={[snapToCursor]} style={{ zIndex: 1100 }}>
        <DragOverlayContent
          dragData={activeDragData}
          allCards={allCardsMap}
          cellLabels={cellLabels}
        />
      </DragOverlay>
    </>
  );
}

export default IndexPage;
