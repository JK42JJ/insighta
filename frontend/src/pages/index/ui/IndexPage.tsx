import { useRef, useEffect, useState, useMemo, useCallback, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DragOverlay,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { Inbox } from 'lucide-react';
import { useAuth } from '@/features/auth/model/useAuth';
import { BootShell } from '@/shared/ui/BootShell';
import { trackCardViewed } from '@/shared/lib/posthog';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/shared/ui/resizable';
import { useShellStore, dndHandlersRef } from '@/stores/shellStore';
import { DropZoneOverlay } from '@/widgets/header/ui/DropZoneOverlay';
import { CardListView } from '@/widgets/card-list-view';
import { CardDiscoveryProgress } from '@/widgets/card-list/ui/CardDiscoveryProgress';
import { VideoPlayerModal } from '@/widgets/video-player/ui/VideoPlayerModal';
import { getYouTubeVideoId } from '@/widgets/video-player/model/youtube-api';
import { VideoSidePanel, useVideoPanelStore } from '@/features/video-side-panel';
import { FloatingScratchPad } from '@/widgets/scratch-pad/ui/FloatingScratchPad';
import { MandalaPanel } from '@/widgets/mandala-panel';
import { MandalaGrid } from '@/widgets/mandala-grid/ui/MandalaGrid';
import { MobileBottomNav } from '@/widgets/mobile-nav';
import { InsightsView } from '@/widgets/insights-view';
import { AddCardsTriggerChip } from '@/widgets/add-cards-panel/ui/AddCardsTriggerChip';
import { AddCardsPanel } from '@/widgets/add-cards-panel/ui/AddCardsPanel';

import { useMandalaQuery, useMandalaList } from '@/features/mandala';
import { useMandalaStore } from '@/stores/mandalaStore';
import { youtubeSyncKeys } from '@/features/youtube-sync/model/useYouTubeSync';
import { localCardsKeys } from '@/features/card-management/model/useLocalCards';
import { useVideoStream } from '@/features/recommendation-feed/model/useVideoStream';
import { useSearchCards, SearchBar } from '@/features/search';
import { useMandalaNavigation } from '../model/useMandalaNavigation';
import { useLayoutPreferences } from '../model/useLayoutPreferences';
import { useCardOrchestrator } from '../model/useCardOrchestrator';
import { useCardDragDrop, useGlobalPaste } from '../model/useCardDragDrop';
import { useVideoModal } from '../model/useVideoModal';
import { useToast } from '@/shared/lib/use-toast';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
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
    return <BootShell />;
  }

  if (!isLoggedIn) {
    return (
      <Suspense fallback={<BootShell />}>
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
  const queryClient = useQueryClient();

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

  // Initialize default mandala — skip when store already has a selection.
  useEffect(() => {
    if (!selectedMandalaId && !storeSelectedMandalaId && mandalaListData?.mandalas) {
      const defaultMandala = mandalaListData.mandalas.find((m) => m.isDefault);
      if (defaultMandala) setSelectedMandalaId(defaultMandala.id);
    }
  }, [mandalaListData, selectedMandalaId, storeSelectedMandalaId]);

  // Effective mandalaId: resolves immediately from cached data even before useEffect fires.
  // Bug #2 fix: check storeSelectedMandalaId BEFORE is_default fallback. Without this,
  // first render after wizard navigate always shows the old default mandala because
  // selectedMandalaId is still null (useState init) and useMemo runs before useEffect.
  const effectiveMandalaId = useMemo(() => {
    if (selectedMandalaId) return selectedMandalaId;
    if (storeSelectedMandalaId) return storeSelectedMandalaId;
    if (mandalaListData?.mandalas) {
      const defaultMandala = mandalaListData.mandalas.find((m) => m.isDefault);
      if (defaultMandala) return defaultMandala.id;
    }
    return null;
  }, [selectedMandalaId, storeSelectedMandalaId, mandalaListData]);

  // Pending mandala (optimistic UI during background wizard submit — CP389).
  // When the user just clicked "create" in the wizard we navigate here
  // immediately with a client-generated tempId. The server row does not
  // exist yet, so useMandalaQuery would 404. We short-circuit by passing
  // null to the query (so it no-ops to EMPTY_ROOT_LEVELS) and synthesise
  // the depth-0 level from the pendingMandala inputs the wizard captured.
  const pendingMandala = useMandalaStore((s) => s.pendingMandala);
  const isViewingPending = !!pendingMandala && effectiveMandalaId === pendingMandala.tempId;

  // 3. Mandala data from DB (by selected mandala ID)
  const {
    mandalaLevels: queryMandalaLevels,
    mandalaMeta: queryMandalaMeta,
    isLoading: mandalaQueryLoading,
  } = useMandalaQuery(isViewingPending ? null : effectiveMandalaId);
  // Server-truth card count used as the grid's layout commitment.
  // Skeletons fill the gap until each cell's data lands.
  const serverCardCount = queryMandalaMeta?.cardCount ?? 0;

  // Lift CardListView's Newly Synced pill state up so skeletonCount can
  // be disabled in any sub-view (cell-selected / Newly Synced / search).
  const [isNewlySyncedActive, setIsNewlySyncedActive] = useState(false);

  // Suppress "Sector 1..8" + empty-title placeholders while the detail query
  // is still inflight AND we have no useful subjects yet. Treated as
  // structure-loading; sidebar minimap + ContextHeader render shimmer instead.
  const mandalaStructureLoading =
    mandalaQueryLoading &&
    (!queryMandalaLevels?.root?.subjects?.length || !queryMandalaLevels?.root?.centerGoal);

  const mandalaLevels = useMemo(() => {
    if (!isViewingPending || !pendingMandala) return queryMandalaLevels;
    const inputs = pendingMandala.originalInputs;
    return {
      root: {
        id: 'root',
        centerGoal: inputs.centerGoal || inputs.title,
        centerLabel: inputs.centerLabel ?? inputs.title,
        subjects: inputs.subjects,
        subjectLabels: inputs.subLabels,
        parentId: null,
        parentCellIndex: null,
        cards: [],
      },
    } as typeof queryMandalaLevels;
  }, [isViewingPending, pendingMandala, queryMandalaLevels]);

  // 4. Refs to break circular dependency: navigation <-> card orchestrator
  const moveCardsRef = useRef<(...args: unknown[]) => void>(() => {});
  const swapCardsRef = useRef<(...args: unknown[]) => void>(() => {});

  // 5. Mandala navigation (wired to card orchestrator via refs)
  const navigation = useMandalaNavigation({
    initialLevels: mandalaLevels,
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

  // Render-assigned ref mirroring navigation.selectedCellIndex. Native HTML5
  // drop handlers fire outside React's render cycle — reading the value via a
  // render closure can be stale on the first drop after a cell selection
  // (symptom: first external-URL drop lands in Idea Spot instead of the cell).
  // Same precedent as dndHandlersRef: assigned during render, never via useEffect.
  const selectedCellIndexRef = useRef(navigation.selectedCellIndex);
  selectedCellIndexRef.current = navigation.selectedCellIndex;

  // 5a. SSE card stream — subscribe to `recommendation_cache` +
  // `user_video_states` notifications. Stream cards are fed directly
  // into the card orchestrator so the grid renders recommendation_cache
  // backlog immediately, without waiting for maybeAutoAddRecommendations
  // to copy them into user_video_states (~15-30s pipeline delay).
  const cardStream = useVideoStream(effectiveMandalaId);
  const cardStreamCountRef = useRef(0);
  useEffect(() => {
    if (cardStream.cards.length > cardStreamCountRef.current) {
      cardStreamCountRef.current = cardStream.cards.length;
      queryClient.invalidateQueries({ queryKey: localCardsKeys.list() });
      queryClient.invalidateQueries({ queryKey: youtubeSyncKeys.allVideoStates });
    }
    if (cardStream.cards.length === 0 && cardStreamCountRef.current !== 0) {
      cardStreamCountRef.current = 0;
    }
  }, [cardStream.cards.length, queryClient]);

  // 5b. Card orchestrator (needs navigation state + stream cards)
  const cards = useCardOrchestrator(
    {
      currentLevelId: navigation.currentLevelId,
      currentLevel: navigation.currentLevel,
      mandalaId: effectiveMandalaId,
      streamCards: cardStream.cards,
    },
    navigation.selectedCellIndex
  );

  // 5c. Post-creation card polling: when a mandala was just created via wizard,
  // poll for cards every 5s until they appear or 90s timeout.
  const justCreatedMandalaId = useMandalaStore((s) => s.justCreatedMandalaId);
  const clearJustCreated = useMandalaStore((s) => s.setJustCreated);
  const isNewMandalaActive = justCreatedMandalaId === effectiveMandalaId && !!effectiveMandalaId;

  // 5c'. Mandala-switch grace period: prevents the "0 cards" empty-state flash
  // that surfaced on every mandala switch because keepPreviousData + client-side
  // mandala_id filter yields cards.length=0 for a brief moment before the next
  // useAllVideoStates fetch lands. During the grace window we force isLoading
  // downstream (skeleton instead of empty-state).
  const [mandalaSwitchGrace, setMandalaSwitchGrace] = useState(false);
  useEffect(() => {
    if (!effectiveMandalaId) return;
    setMandalaSwitchGrace(true);
    const timer = setTimeout(() => setMandalaSwitchGrace(false), 3000);
    return () => clearTimeout(timer);
  }, [effectiveMandalaId]);

  useEffect(() => {
    if (!isNewMandalaActive) return;

    const POLL_INTERVAL_MS = 2_000;
    const POLL_TIMEOUT_MS = 90_000;

    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: youtubeSyncKeys.allVideoStates });
      queryClient.invalidateQueries({ queryKey: localCardsKeys.all });
    }, POLL_INTERVAL_MS);

    const timeout = setTimeout(() => {
      clearJustCreated(null);
    }, POLL_TIMEOUT_MS);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [isNewMandalaActive, queryClient, clearJustCreated]);

  // Auto-stop polling when cards appear
  useEffect(() => {
    if (isNewMandalaActive && cards.totalCards > 0) {
      clearJustCreated(null);
    }
  }, [isNewMandalaActive, cards.totalCards, clearJustCreated]);

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
  const isSidePanelOpen = useVideoPanelStore((s) => s.isOpen);
  const sidebarSwapCard = useVideoPanelStore((s) => s.swapCard);
  const sidebarCloseSidebar = useVideoPanelStore((s) => s.closeSidebar);
  const sidebarCard = useVideoPanelStore((s) => s.card);

  // Mandala change handling for sidebar:
  //  - If new mandala has cards → swap sidebar to first card (paused)
  //  - If new mandala has no cards → close sidebar
  // IMPORTANT: only react to real mandala→mandala transitions (ID→differentID).
  // Initial load (undefined→ID, null→ID) and unmount (ID→null) are NOT
  // mandala changes — they happen on page refresh or auth transitions.
  // Treating refresh as "mandala change" would close the persisted sidebar.
  const prevMandalaIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const prev = prevMandalaIdRef.current;
    prevMandalaIdRef.current = effectiveMandalaId;

    // Skip non-transitions and initial/unmount transitions
    if (prev === effectiveMandalaId) return;
    if (!prev || !effectiveMandalaId) return; // null/undefined on either side

    if (!isSidePanelOpen) return; // Sidebar closed → nothing to do

    const firstCard = cards.displayCards[0];
    if (!firstCard) {
      // No cards in new mandala → close sidebar
      sidebarCloseSidebar();
    } else if (firstCard.id !== sidebarCard?.id) {
      // Swap to first card of new mandala (stopped state)
      sidebarSwapCard(firstCard, false);
    }
  }, [
    effectiveMandalaId,
    isSidePanelOpen,
    cards.displayCards,
    sidebarCard?.id,
    sidebarSwapCard,
    sidebarCloseSidebar,
  ]);

  // Wire card click — dual mode: popup (default) or sidebar (expanded)
  // sortedList comes from CardListView (matches user-visible sort order)
  const handleCardClick = (
    card: Parameters<typeof modal.openModal>[0],
    sortedList?: Parameters<typeof modal.openModal>[1]
  ) => {
    trackCardViewed({
      mandala_id: ('mandala_id' in card ? (card.mandala_id as string) : undefined) ?? undefined,
      card_id: card.id,
      has_summary: !!('summary' in card && card.summary),
    });

    const ytId = getYouTubeVideoId(card.videoUrl);
    if (card.mandalaId && ytId) {
      navigate(`/learning/${card.mandalaId}/${ytId}`);
      return;
    }

    const panel = useVideoPanelStore.getState();
    if (panel.mode === 'sidebar' && panel.isOpen) {
      panel.openInSidebar(card);
    } else {
      const siblings = sortedList ?? (search.isSearchActive ? search.results : cards.displayCards);
      modal.openModal(card, siblings);
    }
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
  const [scratchPadOpen, setScratchPadOpen] = useState(false);
  const scratchPadWrapperRef = useRef<HTMLDivElement | null>(null);

  // ESC closes IdeaSpot. No outside-click close — would conflict with D&D.
  useEffect(() => {
    if (!scratchPadOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setScratchPadOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [scratchPadOpen]);

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

  // CP442 — IdeaSpot trigger button (rendered left of ViewSwitcher in
  // ContextHeader / graph mode / InsightsView toolbars). onClick wired in
  // Phase 3 (open-state toggle).
  const ideaSpotCount = cards.scratchPadCards.length;
  const ideaSpotTrigger = (
    <button
      type="button"
      data-idea-spot-trigger
      onClick={() => setScratchPadOpen((v) => !v)}
      title={t('ideaSpot.tooltip', '아이디어스팟 {{count}}개', { count: ideaSpotCount })}
      aria-label={t('ideaSpot.tooltip', '아이디어스팟 {{count}}개', { count: ideaSpotCount })}
      className="inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition-colors hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      style={{
        borderColor: 'hsl(var(--border) / 0.4)',
        color: 'hsl(var(--foreground))',
      }}
    >
      <Inbox className="h-3.5 w-3.5" />
      <span>{t('ideaSpot.label', '아이디어스팟')}</span>
      {ideaSpotCount > 0 && (
        <span
          className="ml-0.5 inline-flex min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-tight"
          style={{
            background: 'hsl(var(--primary))',
            color: 'hsl(var(--primary-foreground))',
          }}
        >
          {ideaSpotCount}
        </span>
      )}
    </button>
  );

  // Shared ScratchPad props factory (CP442 — dock mode retired, floating only)
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
    // CP442 — onToggleFloating now closes the popup (existing close button
    // semantics). Preference (`scratchpad_is_floating`) intentionally NOT
    // mutated to honor the "preserve preference" decision.
    onToggleFloating: () => setScratchPadOpen(false),
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
  const setNewlySyncedCountByMandala = useShellStore((s) => s.setNewlySyncedCountByMandala);
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
    const currentMandala = mandalaListData?.mandalas?.find((m) => m.id === selectedMandalaId);
    const currentDomain =
      (currentMandala?.domain as
        | import('@/shared/config/domain-colors').MandalaDomain
        | undefined) ?? null;
    setMinimapData({
      cardsByCell: cards.cardsByCell,
      sectorSubjects: navigation.currentLevel.subjects,
      sectorLabels: navigation.currentLevel.subjectLabels,
      centerGoal: navigation.currentLevel.centerGoal,
      centerLabel: navigation.currentLevel.centerLabel,
      selectedCellIndex: navigation.selectedCellIndex,
      domain: currentDomain,
      onCellClick: navigation.handleCellClick,
      mandalaId: selectedMandalaId,
      isLoading: mandalaStructureLoading,
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
    mandalaListData,
    mandalaStructureLoading,
    setMinimapData,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  // Issue #389: push per-mandala "Newly Synced" counts to the shell store
  // so the sidebar mandala list can render the dot+count indicator.
  useEffect(() => {
    setNewlySyncedCountByMandala(cards.newlySyncedCountByMandala);
  }, [cards.newlySyncedCountByMandala, setNewlySyncedCountByMandala]);

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

        {/* CP442 — Floating ScratchPad: kept mounted, toggled via display so
            internal size/position state survives close/reopen. Wrapper div
            isolates the display switch (FloatingScratchPad has no style/className
            props) and serves as outside-click boundary via ref. */}
        <div ref={scratchPadWrapperRef} style={{ display: scratchPadOpen ? 'block' : 'none' }}>
          <FloatingScratchPad
            {...scratchPadProps(true)}
            initialPosition={
              layout.prefScratchpadPosX !== undefined && layout.prefScratchpadPosY !== undefined
                ? { x: layout.prefScratchpadPosX, y: layout.prefScratchpadPosY }
                : undefined
            }
            onPositionChange={layout.setScratchPadPosition}
          />
        </div>

        {/* Main Content Area — ResizablePanelGroup for resizable side panel */}
        <ResizablePanelGroup
          direction="horizontal"
          className="flex-1 overflow-hidden"
          autoSaveId="video-side-panel"
        >
          <ResizablePanel defaultSize={isSidePanelOpen ? 65 : 100} minSize={30}>
            <div className="flex h-full overflow-hidden">
              <div
                className={`flex-1 h-full px-6 md:px-10 lg:px-[70px] py-6 ${modal.isModalOpen ? 'overflow-hidden' : 'overflow-y-auto scrollbar-pro'} ${
                  isSidePanelOpen
                    ? '[&_[data-card-item]]:opacity-40 [&_[data-card-item]]:grayscale [&_[data-card-item]]:transition-[opacity,filter] [&_[data-card-item]]:duration-300 [&_[data-card-item]:hover]:opacity-100 [&_[data-card-item]:hover]:grayscale-0 [&_[data-card-chrome]]:opacity-40 [&_[data-card-chrome]]:grayscale [&_[data-card-chrome]]:transition-[opacity,filter] [&_[data-card-chrome]]:duration-300'
                    : ''
                }`}
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
                    sectorSubjects={
                      navigation.currentLevel.subjectLabels?.length
                        ? navigation.currentLevel.subjectLabels
                        : navigation.currentLevel.subjects
                    }
                    sectorLabels={navigation.currentLevel.subjectLabels}
                    title={navigation.currentLevel.centerGoal}
                    viewMode={layout.viewMode}
                    onViewModeChange={layout.handleSetViewMode}
                    mandalaId={effectiveMandalaId}
                    trailingAction={ideaSpotTrigger}
                  />
                ) : (
                  <>
                    {isNewMandalaActive && cards.totalCards === 0 && effectiveMandalaId && (
                      <CardDiscoveryProgress mandalaId={effectiveMandalaId} isComplete={false} />
                    )}
                    <CardListView
                      cards={search.isSearchActive ? search.results : cards.displayCards}
                      isLoading={
                        search.isSearchActive
                          ? search.isLoading
                          : cards.isLoading ||
                            (isNewMandalaActive && cards.totalCards === 0) ||
                            (mandalaSwitchGrace && cards.totalCards === 0)
                      }
                      skeletonCount={(() => {
                        // skeletonCount only makes sense in the main grid
                        // (all root cells visible). Any sub-view — cell
                        // selection / Newly Synced / search — renders an
                        // explicit subset so the server total no longer
                        // maps onto cell-by-cell layout.
                        if (search.isSearchActive) return 0;
                        if (navigation.selectedCellIndex !== null) return 0;
                        if (isNewlySyncedActive) return 0;
                        return Math.max(0, serverCardCount - cards.displayCards.length);
                      })()}
                      isNewlySyncedActive={isNewlySyncedActive}
                      onNewlySyncedActiveChange={setIsNewlySyncedActive}
                      title={
                        search.isSearchActive
                          ? t('search.results', 'Search Results')
                          : cards.displayTitle
                      }
                      titleLoading={!search.isSearchActive && mandalaStructureLoading}
                      viewMode={layout.viewMode}
                      listPanelRatio={layout.listPanelRatio}
                      mandalaId={effectiveMandalaId}
                      onViewModeChange={layout.handleSetViewMode}
                      onListPanelRatioChange={layout.handleSetListPanelRatio}
                      gridColumns={layout.gridColumns}
                      onGridColumnsChange={layout.handleSetGridColumns}
                      compactMode={isSidePanelOpen}
                      onCardClick={handleCardClick}
                      onCardDragStart={dragDrop.handleCardDragStart}
                      onMultiCardDragStart={dragDrop.handleMultiCardDragStart}
                      onSaveNote={cards.handleSaveNote}
                      onCardsReorder={cards.handleCardsReorder}
                      onDeleteCards={cards.handleDeleteCards}
                      onAddCard={navigation.selectedCellIndex != null ? handleAddCard : undefined}
                      onExternalUrlDrop={(url) => {
                        // CP463+ Issue #649 follow-up — reject YouTube
                        // channel/playlist URLs that have no video id. The
                        // add path silently stores a placeholder row when
                        // video_id can't be extracted (user reported case:
                        // dropping the channel home `youtube.com/@xxx` →
                        // "YouTube Video" placeholder + /placeholder.svg).
                        const isYouTubeHost = /(?:^|\.)(?:youtube\.com|youtu\.be)$/i.test(
                          (() => {
                            try {
                              return new URL(url).hostname;
                            } catch {
                              return '';
                            }
                          })()
                        );
                        if (isYouTubeHost && !getYouTubeVideoId(url)) {
                          toast({
                            title: t('cards.dropError.notVideoUrlTitle'),
                            description: t('cards.dropError.notVideoUrlDescription'),
                            variant: 'destructive',
                          });
                          return;
                        }
                        // Read via render-assigned ref, not the closure — the
                        // closure can be stale on the first drop after a cell
                        // selection, silently routing to Idea Spot.
                        const cellIndex = selectedCellIndexRef.current;
                        if (cellIndex != null) {
                          cards.handleCardDrop(cellIndex, url);
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
                      sectorSubjects={
                        navigation.currentLevel.subjectLabels?.length
                          ? navigation.currentLevel.subjectLabels
                          : navigation.currentLevel.subjects
                      }
                      selectedCellIndex={navigation.selectedCellIndex}
                      onCellClick={navigation.handleCellClick}
                      totalCardCount={cards.totalCards}
                      cardsByCell={cards.cardsByCell}
                      isExternalCardDragActive={activeDragData?.type === 'card'}
                      isInternalCardDragActive={
                        activeDragData?.type === 'card' || activeDragData?.type === 'card-reorder'
                      }
                      newlySyncedCards={cards.newlySyncedCards}
                      trailingAction={
                        <>
                          <AddCardsTriggerChip mandalaId={effectiveMandalaId} />
                          {ideaSpotTrigger}
                        </>
                      }
                    />
                  </>
                )}
              </div>
            </div>
          </ResizablePanel>

          {/* Resizable Video side panel */}
          {isSidePanelOpen && (
            <>
              <ResizableHandle className="bg-[rgba(255,255,255,0.06)]" data-no-dnd="true" />
              <ResizablePanel defaultSize={35} minSize={30} maxSize={70}>
                <VideoSidePanel
                  onCollapseToPopup={(cardWithResume) => {
                    // Reopen as modal with same card and resume position
                    const siblings = search.isSearchActive ? search.results : cards.displayCards;
                    modal.openModal(cardWithResume, siblings);
                  }}
                />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>

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
          onPrev={modal.goPrev}
          onNext={modal.goNext}
          hasPrev={modal.hasPrev}
          hasNext={modal.hasNext}
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
      {/* CP466 — Add Cards slide-in panel. Mounts here (above main grid)
          so the grid stays visible on the left ("흡수" mental model). */}
      <AddCardsPanel />
    </>
  );
}

export default IndexPage;
