import { useState, useEffect, useCallback, useMemo, useRef, startTransition } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Header } from '@/components/Header';
import { Breadcrumb } from '@/components/Breadcrumb';
import { MandalaGrid } from '@/components/MandalaGrid';
import { CardList } from '@/components/CardList';
import { VideoPlayerModal } from '@/components/VideoPlayerModal';
import { DropZoneOverlay } from '@/components/DropZoneOverlay';
import { FloatingScratchPad, DockPosition } from '@/components/FloatingScratchPad';
import { FloatingMandala, MandalaDockPosition } from '@/components/FloatingMandala';
import {
  mockMandalaLevels,
  createMockCards,
  createScratchPadCards,
  createCardFromUrl,
  isValidUrl,
  fetchLinkTitle,
  detectLinkType,
  fetchUrlMetadata,
} from '@/data/mockData';
import { uploadFile, detectFileType, isSupportedFileType } from '@/lib/fileUpload';
import { parseValidatedMandalaLevel } from '@/lib/localStorageValidation';
import { MandalaPath, InsightCard, MandalaLevel } from '@/types/mandala';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useUIPreferences } from '@/hooks/useUIPreferences';
import { useAllVideoStates, useUpdateVideoState } from '@/hooks/useYouTubeSync';
import { useLocalCards, isLimitExceededError } from '@/hooks/useLocalCards';
import { useBatchMoveCards } from '@/hooks/useBatchMoveCards';
import { convertToInsightCards } from '@/lib/youtubeToInsightCard';
import { insightCardToAddPayload, localCardToInsightCard } from '@/types/local-cards';
import { detectCardSource, getCardById } from '@/lib/cardUtils';

const Index = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { isLoggedIn } = useAuth();
  const {
    preferences,
    isLoading: isLoadingPreferences,
    setScratchPadFloating,
    setScratchPadDockPosition: updateScratchPadDockPosition,
    setScratchPadPosition,
    setScratchPadSize,
    setMandalaFloating,
    setMandalaMinimized,
    setMandalaDockPosition: updateMandalaDockPosition,
    setMandalaPosition,
  } = useUIPreferences();

  // YouTube sync hooks — fetch ALL video states, split on frontend
  const { data: allVideoStates, isLoading: isLoadingVideos } = useAllVideoStates();
  const updateVideoState = useUpdateVideoState();

  // Local cards hook (for URL paste/D&D cards stored in Supabase)
  const {
    cards: persistedLocalCards,
    subscription,
    isLoading: isLoadingLocalCards,
    addCard: addLocalCard,
    updateCard: updateLocalCard,
    deleteCard: deleteLocalCard,
    canAddCard,
    remainingSlots,
    refetch: refetchLocalCards,
  } = useLocalCards();

  // Batch move hook for fire-and-forget multi-card operations
  const batchMoveCards = useBatchMoveCards();

  // Convert ALL video states to InsightCards (includes both ideation and mandala cards)
  const syncedCards = useMemo(() => {
    if (!allVideoStates) return [];
    return convertToInsightCards(allVideoStates);
  }, [allVideoStates]);

  const [currentLevelId, setCurrentLevelId] = useState('root');
  const [path, setPath] = useState<MandalaPath[]>([]);
  const [selectedCellIndex, setSelectedCellIndex] = useState<number | null>(null);
  const [selectedCard, setSelectedCard] = useState<InsightCard | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isScratchPadDropTarget, setIsScratchPadDropTarget] = useState(false);
  const [draggingCard, setDraggingCard] = useState<InsightCard | null>(null);
  const [isDraggingCell, setIsDraggingCell] = useState(false);
  const [entryGridIndex, setEntryGridIndex] = useState<number | null>(null);
  // UI State - synced with preferences
  // Track if initial preferences have been loaded
  const [hasInitializedPreferences, setHasInitializedPreferences] = useState(false);
  const [isScratchPadFloating, setIsScratchPadFloatingLocal] = useState(false);
  const [scratchPadDockPosition, setScratchPadDockPositionLocal] = useState<DockPosition>('top');
  const [isMandalaMinimized, setIsMandalaMinimizedLocal] = useState(false);
  const [isMandalaFloatingMode, setIsMandalaFloatingMode] = useState(false);
  const [isMandalaFloating, setIsMandalaFloatingLocal] = useState(false);
  const [mandalaDockPosition, setMandalaDockPositionLocal] = useState<MandalaDockPosition>('left');

  // Extract primitive values from preferences to avoid object reference issues in useEffect
  const prefScratchpadFloating = preferences?.scratchpad_is_floating;
  const prefScratchpadDock = preferences?.scratchpad_dock_position;
  const prefScratchpadPosX = preferences?.scratchpad_position_x;
  const prefScratchpadPosY = preferences?.scratchpad_position_y;
  const prefMandalaFloating = preferences?.mandala_is_floating;
  const prefMandalaMinimized = preferences?.mandala_is_minimized;
  const prefMandalaDock = preferences?.mandala_dock_position;
  const prefMandalaPosX = preferences?.mandala_position_x;
  const prefMandalaPosY = preferences?.mandala_position_y;

  // Sync local state with preferences ONLY on initial load
  useEffect(() => {
    // Only sync once when preferences first become available
    if (!hasInitializedPreferences && !isLoadingPreferences && prefMandalaFloating !== undefined) {
      setIsScratchPadFloatingLocal(prefScratchpadFloating ?? false);
      setScratchPadDockPositionLocal((prefScratchpadDock as DockPosition) ?? 'top');
      setIsMandalaMinimizedLocal(prefMandalaMinimized ?? false);
      setIsMandalaFloatingLocal(prefMandalaFloating ?? false);
      setMandalaDockPositionLocal((prefMandalaDock as MandalaDockPosition) ?? 'left');
      setHasInitializedPreferences(true);
    }
  }, [
    isLoadingPreferences,
    prefScratchpadFloating,
    prefScratchpadDock,
    prefMandalaFloating,
    prefMandalaMinimized,
    prefMandalaDock,
    hasInitializedPreferences,
  ]);

  // Handlers that update both local state and persist to preferences
  const handleSetScratchPadFloating = useCallback(
    (floating: boolean) => {
      setIsScratchPadFloatingLocal(floating);
      if (isLoggedIn) {
        setScratchPadFloating(floating);
      }
    },
    [isLoggedIn, setScratchPadFloating]
  );

  const handleSetScratchPadDockPosition = useCallback(
    (position: DockPosition) => {
      setScratchPadDockPositionLocal(position);
      if (isLoggedIn) {
        updateScratchPadDockPosition(position);
      }
    },
    [isLoggedIn, updateScratchPadDockPosition]
  );

  const handleSetMandalaMinimized = useCallback(
    (minimized: boolean) => {
      setIsMandalaMinimizedLocal(minimized);
      if (isLoggedIn) {
        setMandalaMinimized(minimized);
      }
    },
    [isLoggedIn, setMandalaMinimized]
  );

  const handleSetMandalaFloating = useCallback(
    (floating: boolean) => {
      setIsMandalaFloatingLocal(floating);
      if (isLoggedIn) {
        setMandalaFloating(floating);
      }
    },
    [isLoggedIn, setMandalaFloating]
  );

  const handleSetMandalaDockPosition = useCallback(
    (position: MandalaDockPosition) => {
      setMandalaDockPositionLocal(position);
      if (isLoggedIn) {
        updateMandalaDockPosition(position);
      }
    },
    [isLoggedIn, updateMandalaDockPosition]
  );

  // Cards state
  const [cards, setCards] = useState<InsightCard[]>(createMockCards());
  // Local state for optimistic UI updates (before Supabase sync completes)
  const [pendingLocalCards, setPendingLocalCards] = useState<InsightCard[]>([]);

  // Split persisted local cards by position:
  // Cards in mandala grid (cell_index >= 0 and level_id is set)
  const mandalaLocalCards = useMemo(() => {
    return persistedLocalCards.filter(
      (c) =>
        typeof c.cellIndex === 'number' &&
        c.cellIndex >= 0 &&
        c.levelId &&
        c.levelId !== 'scratchpad'
    );
  }, [persistedLocalCards]);

  // Cards in scratchpad (cell_index < 0 or level_id is 'scratchpad' or unset)
  const scratchpadLocalCards = useMemo(() => {
    return persistedLocalCards.filter(
      (c) =>
        typeof c.cellIndex !== 'number' ||
        c.cellIndex < 0 ||
        !c.levelId ||
        c.levelId === 'scratchpad'
    );
  }, [persistedLocalCards]);

  // ✅ Bug 2 Fix: YouTube 카드도 위치에 따라 분리
  // YouTube 카드 중 만다라에 있어야 할 것들 (is_in_ideation === false && cellIndex >= 0)
  const mandalaVideoCards = useMemo(() => {
    return syncedCards.filter(
      (c) =>
        c.isInIdeation === false &&
        typeof c.cellIndex === 'number' &&
        c.cellIndex >= 0 &&
        c.levelId &&
        c.levelId !== 'scratchpad'
    );
  }, [syncedCards]);

  // YouTube 카드 중 아이디에이션에 있어야 할 것들 (is_in_ideation !== false)
  const ideationVideoCards = useMemo(() => {
    return syncedCards.filter((c) => c.isInIdeation !== false);
  }, [syncedCards]);

  // Merged scratchpad cards: ideation YouTube videos + scratchpad local cards + pending cards
  // ✅ Bug 2 Fix: syncedCards 대신 ideationVideoCards 사용
  const scratchPadCards = useMemo(() => {
    // Filter out pending cards that are now in persisted (by URL match)
    const persistedUrls = new Set(persistedLocalCards.map((c) => c.videoUrl));
    const filteredPending = pendingLocalCards.filter((c) => !persistedUrls.has(c.videoUrl));
    // Ideation video cards first (not all synced), then scratchpad local cards only, then pending
    return [...ideationVideoCards, ...scratchpadLocalCards, ...filteredPending];
  }, [ideationVideoCards, scratchpadLocalCards, pendingLocalCards, persistedLocalCards]);

  // Helper to update pending scratchpad cards (for optimistic UI)
  const setScratchPadCards = useCallback(
    (updater: InsightCard[] | ((prev: InsightCard[]) => InsightCard[])) => {
      if (typeof updater === 'function') {
        // For function updaters, only update pending cards
        setPendingLocalCards((prev) => {
          const allCards = [...syncedCards, ...persistedLocalCards, ...prev];
          const updatedCards = updater(allCards);
          // Filter out synced and persisted cards to only keep pending changes
          const syncedIds = new Set(syncedCards.map((c) => c.id));
          const persistedIds = new Set(persistedLocalCards.map((c) => c.id));
          return updatedCards.filter((c) => !syncedIds.has(c.id) && !persistedIds.has(c.id));
        });
      } else {
        // For direct value, only set pending cards (filter out synced and persisted)
        const syncedIds = new Set(syncedCards.map((c) => c.id));
        const persistedIds = new Set(persistedLocalCards.map((c) => c.id));
        setPendingLocalCards(
          updater.filter((c) => !syncedIds.has(c.id) && !persistedIds.has(c.id))
        );
      }
    },
    [syncedCards, persistedLocalCards]
  );

  // Guard ref: skip query-data sync when we already applied optimistic setState
  const skipNextSyncRef = useRef(false);

  // Sync mandala cards (both local and YouTube video cards) to cards state on load
  // ✅ Bug 2 Fix: mandalaVideoCards도 함께 동기화
  // This ensures persisted cards appear in the correct mandala cells after refresh
  useEffect(() => {
    if (skipNextSyncRef.current) {
      skipNextSyncRef.current = false;
      return;
    }
    // Combine both local and YouTube video mandala cards
    const allMandalaCards = [...mandalaLocalCards, ...mandalaVideoCards];

    if (allMandalaCards.length > 0) {
      setCards((prev) => {
        const existingIds = new Set(prev.map((c) => c.id));

        // 1. Update positions of existing cards that are in mandala
        // ✅ Fix: Track actual changes to avoid infinite re-render
        let hasChanges = false;
        const updatedPrev = prev.map((card) => {
          const mandalaCard = allMandalaCards.find((m) => m.id === card.id);
          if (mandalaCard) {
            // Only update if position actually changed (value comparison, not reference)
            const cellIndexChanged = card.cellIndex !== mandalaCard.cellIndex;
            const levelIdChanged = card.levelId !== mandalaCard.levelId;

            if (cellIndexChanged || levelIdChanged) {
              hasChanges = true;
              return { ...card, cellIndex: mandalaCard.cellIndex, levelId: mandalaCard.levelId };
            }
          }
          return card;
        });

        // 2. Add new cards that don't exist in prev
        const newCards = allMandalaCards.filter((c) => !existingIds.has(c.id));

        if (newCards.length > 0) {
          hasChanges = true;
        }

        // ✅ Fix: Return prev if no actual changes (prevents infinite re-render)
        if (!hasChanges) {
          return prev;
        }

        return [...updatedPrev, ...newCards];
      });
    }
  }, [mandalaLocalCards, mandalaVideoCards]);

  // Mandala levels state - load from localStorage if available (with validation)
  const [mandalaLevels, setMandalaLevels] = useState<Record<string, MandalaLevel>>(() => {
    const validatedRoot = parseValidatedMandalaLevel('mandala-root');
    if (validatedRoot) {
      return {
        ...mockMandalaLevels,
        root: validatedRoot,
      };
    }
    return mockMandalaLevels;
  });

  // Floating Mandala mode detection (must match FloatingMandala internal breakpoint)
  useEffect(() => {
    const check = () => {
      setIsMandalaFloatingMode(window.innerHeight < 800 || window.innerWidth < 1024);
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Listen for storage changes from settings page (with validation)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'mandala-root' && e.newValue) {
        const validated = parseValidatedMandalaLevel('mandala-root');
        if (validated) {
          setMandalaLevels((prev) => ({
            ...prev,
            root: validated,
          }));
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // Also check localStorage on focus (for same-tab navigation) with validation
  useEffect(() => {
    const handleFocus = () => {
      const validated = parseValidatedMandalaLevel('mandala-root');
      if (validated) {
        setMandalaLevels((prev) => ({
          ...prev,
          root: validated,
        }));
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  const currentLevel: MandalaLevel = mandalaLevels[currentLevelId] || mandalaLevels['root'];

  // Group cards by cell index - filter by current level AND include cards from sub-levels
  const cardsByCell = useMemo(() => {
    return cards.reduce(
      (acc, card) => {
        // Direct cards for current level
        if (card.levelId === currentLevelId && card.cellIndex >= 0) {
          if (!acc[card.cellIndex]) acc[card.cellIndex] = [];
          acc[card.cellIndex].push(card);
        }
        // Cards from sub-levels should appear in their parent cell
        else {
          // Find if card's levelId matches any sub-level of current level
          currentLevel.subjects.forEach((subject, idx) => {
            const subLevelId = subject.toLowerCase().replace(/\s/g, '');
            if (card.levelId === subLevelId) {
              if (!acc[idx]) acc[idx] = [];
              acc[idx].push(card);
            }
          });
        }
        return acc;
      },
      {} as Record<number, InsightCard[]>
    );
  }, [cards, currentLevelId, currentLevel.subjects]);

  const totalCards = useMemo(() => {
    return Object.values(cardsByCell).reduce((sum, cellCards) => sum + cellCards.length, 0);
  }, [cardsByCell]);

  // Global drag detection for overlay
  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      // Only show overlay for external drags (not internal card moves)
      if (!draggingCard) {
        setIsDraggingOver(true);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) {
        setIsDraggingOver(false);
        setIsScratchPadDropTarget(false);
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      setIsDraggingOver(false);
      setIsScratchPadDropTarget(false);
      setDraggingCard(null);
    };

    const handleDragEnd = () => {
      setDraggingCard(null);
      setIsDraggingOver(false);
      setIsScratchPadDropTarget(false);
    };

    document.addEventListener('dragenter', handleDragEnter);
    document.addEventListener('dragleave', handleDragLeave);
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('drop', handleDrop);
    document.addEventListener('dragend', handleDragEnd);

    return () => {
      document.removeEventListener('dragenter', handleDragEnter);
      document.removeEventListener('dragleave', handleDragLeave);
      document.removeEventListener('dragover', handleDragOver);
      document.removeEventListener('drop', handleDrop);
      document.removeEventListener('dragend', handleDragEnd);
    };
  }, [draggingCard]);

  // Global paste handler for adding URLs to scratchpad (Ideation)
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      // Don't intercept paste in input/textarea elements
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      const text = e.clipboardData?.getData('text');
      if (!text) return;

      // Check if it's a valid URL
      try {
        new URL(text);
      } catch {
        return; // Not a valid URL, ignore
      }

      e.preventDefault();

      // Require login for paste operations
      if (!isLoggedIn) {
        toast({
          title: '로그인이 필요합니다',
          description: '아이디에이션에 추가하려면 먼저 로그인해주세요.',
          variant: 'destructive',
        });
        navigate('/login');
        return;
      }

      const linkType = detectLinkType(text);
      if (linkType === 'other') {
        toast({
          title: '지원하지 않는 링크',
          description: 'YouTube, LinkedIn, Facebook, Notion 링크만 추가할 수 있습니다.',
          variant: 'destructive',
        });
        return;
      }

      // Check subscription limit
      if (!canAddCard) {
        toast({
          title: '저장 한도 초과',
          description: `${subscription.tier === 'free' ? '무료' : subscription.tier} 플랜의 저장 한도(${subscription.limit}개)에 도달했습니다.`,
          variant: 'destructive',
        });
        return;
      }

      const newCard = createCardFromUrl(text, -1, 'scratchpad');
      // Add to pending for optimistic UI
      setPendingLocalCards((prev) => [...prev, newCard]);

      toast({
        title: '아이디에이션에 추가됨',
        description: `${linkType === 'facebook' ? 'Facebook' : linkType === 'youtube' || linkType === 'youtube-shorts' ? 'YouTube' : linkType === 'linkedin' ? 'LinkedIn' : 'Notion'} 링크가 추가되었습니다.`,
      });

      // Fetch metadata and persist to Supabase
      const persistCard = async () => {
        let title = newCard.title;
        let metadata = newCard.metadata;

        // Fetch title
        try {
          title = await fetchLinkTitle(text, linkType);
        } catch {}

        // For non-YouTube links, also fetch full metadata
        if (linkType !== 'youtube' && linkType !== 'youtube-shorts') {
          try {
            const fetchedMetadata = await fetchUrlMetadata(text);
            if (fetchedMetadata) {
              title = fetchedMetadata.title || title;
              metadata = fetchedMetadata;
            }
          } catch {}
        }

        // Persist to Supabase
        try {
          await addLocalCard({
            url: text,
            title,
            thumbnail: metadata?.image || newCard.thumbnail,
            link_type: linkType,
            user_note: '',
            metadata_title: metadata?.title,
            metadata_description: metadata?.description,
            metadata_image: metadata?.image,
            cell_index: -1,
            level_id: 'scratchpad',
          });
          // Remove from pending (will be in persisted now)
          setPendingLocalCards((prev) => prev.filter((c) => c.id !== newCard.id));
        } catch (error) {
          if (isLimitExceededError(error)) {
            toast({
              title: '저장 한도 초과',
              description: error.message,
              variant: 'destructive',
            });
          } else {
            toast({
              title: '저장 실패',
              description: error instanceof Error ? error.message : '카드를 저장하지 못했습니다.',
              variant: 'destructive',
            });
          }
          // Remove from pending on error
          setPendingLocalCards((prev) => prev.filter((c) => c.id !== newCard.id));
        }
      };

      persistCard();
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [toast, isLoggedIn, navigate, canAddCard, subscription, addLocalCard]);

  const handleCellClick = useCallback((cellIndex: number, subject: string) => {
    // If center cell clicked (cellIndex === -1), show all cards
    if (cellIndex === -1) {
      setSelectedCellIndex(null);
      return;
    }

    setSelectedCellIndex(cellIndex);
  }, []);

  // Check if subject has a sub-level
  const hasSubLevel = useCallback((subject: string): boolean => {
    return true; // All subjects can have sub-levels
  }, []);

  // Navigate to sub-level (L2) - create new level if doesn't exist
  const handleNavigateToSubLevel = useCallback(
    (subject: string, gridIndex: number) => {
      const nextLevelId = subject.toLowerCase().replace(/\s/g, '');
      const parentCellIndex = currentLevel.subjects.indexOf(subject);

      // Create sub-level if it doesn't exist
      if (!mandalaLevels[nextLevelId]) {
        // Try to load from localStorage first
        const savedL2 = localStorage.getItem(`mandala-l2-${nextLevelId}`);
        let subjects = Array.from({ length: 8 }, (_, i) => `${subject} ${i + 1}`);

        if (savedL2) {
          try {
            const parsed = JSON.parse(savedL2);
            if (parsed.subjects && Array.isArray(parsed.subjects)) {
              subjects = parsed.subjects;
            }
          } catch {}
        }

        setMandalaLevels((prev) => ({
          ...prev,
          [nextLevelId]: {
            id: nextLevelId,
            centerGoal: subject,
            subjects,
            parentId: currentLevelId,
            parentCellIndex,
            cards: [],
          },
        }));
      }

      // Migrate cards from current level's cell to the new sub-level's first cell (index 0)
      setCards((prev) =>
        prev.map((card) => {
          if (card.levelId === currentLevelId && card.cellIndex === parentCellIndex) {
            return { ...card, levelId: nextLevelId, cellIndex: 0 };
          }
          return card;
        })
      );

      setPath([...path, { id: currentLevelId, label: currentLevel.centerGoal }]);
      setCurrentLevelId(nextLevelId);
      setSelectedCellIndex(null);
      setEntryGridIndex(gridIndex); // Remember entry direction for back navigation

      toast({
        title: `${subject} 레벨로 이동`,
        description: '하위 만다라트로 이동했습니다.',
      });
    },
    [mandalaLevels, path, currentLevelId, currentLevel, toast]
  );

  const handleSubjectsReorder = useCallback(
    async (newSubjects: string[], swappedIndices?: { from: number; to: number }) => {
      setMandalaLevels((prev) => ({
        ...prev,
        [currentLevelId]: {
          ...prev[currentLevelId],
          subjects: newSubjects,
        },
      }));

      // Swap cards between the two cells
      if (swappedIndices) {
        // 영향받는 카드 찾기
        const affectedCards = cards.filter(
          (c) => c.cellIndex === swappedIndices.from || c.cellIndex === swappedIndices.to
        );

        // DB에 카드 위치 업데이트
        for (const card of affectedCards) {
          const newCellIndex =
            card.cellIndex === swappedIndices.from ? swappedIndices.to : swappedIndices.from;
          const source = detectCardSource(card.id, syncedCards, persistedLocalCards);

          try {
            if (source === 'synced') {
              await updateVideoState.mutateAsync({
                videoStateId: card.id,
                updates: { cell_index: newCellIndex },
              });
            } else if (source === 'local') {
              await updateLocalCard({ id: card.id, cell_index: newCellIndex });
            }
          } catch (error) {
            console.error('[handleSubjectsReorder] Failed to update card:', card.id, error);
          }
        }

        // 로컬 상태 업데이트
        setCards((prev) =>
          prev.map((card) => {
            if (card.cellIndex === swappedIndices.from) {
              return { ...card, cellIndex: swappedIndices.to };
            } else if (card.cellIndex === swappedIndices.to) {
              return { ...card, cellIndex: swappedIndices.from };
            }
            return card;
          })
        );

        // If the selected cell was swapped, follow it to the new position
        if (selectedCellIndex !== null) {
          if (selectedCellIndex === swappedIndices.from) {
            setSelectedCellIndex(swappedIndices.to);
          } else if (selectedCellIndex === swappedIndices.to) {
            setSelectedCellIndex(swappedIndices.from);
          }
        }
      }

      toast({
        title: '우선순위 변경됨',
        description: '만다라트 셀 위치가 업데이트되었습니다.',
      });
    },
    [
      currentLevelId,
      toast,
      selectedCellIndex,
      cards,
      syncedCards,
      persistedLocalCards,
      updateVideoState,
      updateLocalCard,
    ]
  );

  const handleNavigate = (levelId: string) => {
    if (levelId === 'root') {
      setPath([]);
      setCurrentLevelId('root');
    } else {
      const index = path.findIndex((p) => p.id === levelId);
      if (index >= 0) {
        setPath(path.slice(0, index));
        setCurrentLevelId(levelId);
      }
    }
    setSelectedCellIndex(null);
  };

  // Navigate back to parent level
  const handleNavigateBack = useCallback(() => {
    if (path.length > 0) {
      const parentPath = path[path.length - 1];
      setPath(path.slice(0, -1));
      setCurrentLevelId(parentPath.id);
      setSelectedCellIndex(null);
      setEntryGridIndex(null); // Clear entry direction when going back to L1
      toast({
        title: '상위 레벨로 이동',
        description: `${parentPath.label}로 돌아왔습니다.`,
      });
    }
  }, [path, toast]);

  // Handle file upload and create card
  const handleFileUpload = useCallback(
    async (file: File, cellIndex: number, levelId: string): Promise<InsightCard | null> => {
      if (!isSupportedFileType(file.name)) {
        toast({
          title: '지원하지 않는 파일 형식',
          description: 'txt, md, pdf 파일만 업로드할 수 있습니다.',
          variant: 'destructive',
        });
        return null;
      }

      toast({
        title: '파일 업로드 중...',
        description: file.name,
      });

      const result = await uploadFile(file);
      if (!result) {
        toast({
          title: '업로드 실패',
          description: '파일 업로드에 실패했습니다.',
          variant: 'destructive',
        });
        return null;
      }

      const linkType = detectFileType(file.name);
      const newCard: InsightCard = {
        id: `card-${Date.now()}`,
        videoUrl: result.url,
        title: result.fileName,
        thumbnail: '/placeholder.svg',
        userNote: '',
        createdAt: new Date(),
        cellIndex,
        levelId,
        linkType,
      };

      return newCard;
    },
    [toast]
  );

  // Handle file drop for cells
  const handleFileDrop = useCallback(
    async (cellIndex: number, files: FileList) => {
      for (const file of Array.from(files)) {
        const newCard = await handleFileUpload(file, cellIndex, currentLevelId);
        if (newCard) {
          setCards((prev) => [...prev, newCard]);
          toast({
            title: '파일 추가됨',
            description: `"${currentLevel.subjects[cellIndex]}"에 저장되었습니다.`,
          });
        }
      }
    },
    [handleFileUpload, currentLevelId, currentLevel.subjects, toast]
  );

  // Handle file drop for scratchpad
  const handleScratchPadFileDrop = useCallback(
    async (files: FileList) => {
      for (const file of Array.from(files)) {
        const newCard = await handleFileUpload(file, -1, 'scratchpad');
        if (newCard) {
          setScratchPadCards((prev) => [...prev, newCard]);
          toast({
            title: '파일이 아이디에이션에 추가됨',
            description: file.name,
          });
        }
      }
    },
    [handleFileUpload, toast]
  );

  const handleCardDrop = useCallback(
    async (
      cellIndex: number,
      url?: string,
      cardId?: string,
      multiCardIds?: string[],
      files?: FileList
    ) => {
      setIsDraggingOver(false);

      // Handle file drops first
      if (files && files.length > 0) {
        handleFileDrop(cellIndex, files);
        return;
      }

      // Handle multi-card drop (process multiple cards at once)
      if (multiCardIds && multiCardIds.length > 0) {
        // Check pending cards for quota limit
        const pendingIds = multiCardIds.filter(
          (id) => detectCardSource(id, syncedCards, persistedLocalCards) === 'pending'
        );
        if (pendingIds.length > 0 && !canAddCard) {
          toast({
            title: '저장 한도 초과',
            description: `최대 ${subscription.limit}개까지 저장할 수 있습니다.`,
            variant: 'destructive',
          });
          return;
        }

        // 1. Snapshot for rollback
        const previousCards = cards;
        const previousScratchPad = scratchPadCards;
        const previousPending = pendingLocalCards;

        // Phase A: URGENT — 만다라 시각 즉시 업데이트
        skipNextSyncRef.current = true;
        setCards((prev) => {
          const movedCards = multiCardIds
            .map((id) => getCardById(id, syncedCards, persistedLocalCards, pendingLocalCards))
            .filter((c): c is InsightCard => c !== null)
            .map((c) => ({ ...c, cellIndex, levelId: currentLevelId }));
          return [...prev.filter((c) => !multiCardIds.includes(c.id)), ...movedCards];
        });

        toast({
          title: `${multiCardIds.length}개 카드 이동됨`,
          description: `"${currentLevel.subjects[cellIndex]}"로 이동했습니다.`,
        });

        // Phase B: DEFERRED — 스크래치패드 정리 (non-urgent)
        requestAnimationFrame(() => {
          startTransition(() => {
            setScratchPadCards((prev) => prev.filter((c) => !multiCardIds.includes(c.id)));
            setPendingLocalCards((prev) => prev.filter((c) => !multiCardIds.includes(c.id)));
          });
        });

        // Phase C: BACKGROUND — 네트워크 (fire-and-forget)
        const batchItems = multiCardIds
          .map((id) => {
            const source = detectCardSource(id, syncedCards, persistedLocalCards);
            const card = getCardById(id, syncedCards, persistedLocalCards, pendingLocalCards);
            if (!card) return null;
            return { card, source, cellIndex, levelId: currentLevelId };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null);

        batchMoveCards.mutateAsync({ items: batchItems }).catch((error) => {
          console.error('[handleCardDrop] Failed to move cards:', error);
          setCards(previousCards);
          setScratchPadCards(previousScratchPad);
          setPendingLocalCards(previousPending);
          toast({
            title: '이동 실패',
            description: `카드 이동에 실패했습니다: ${error instanceof Error ? error.message : 'Unknown error'}`,
            variant: 'destructive',
          });
        });
        return;
      }

      // Handle single card drop
      if (cardId) {
        const source = detectCardSource(cardId, syncedCards, persistedLocalCards);
        const card = getCardById(cardId, syncedCards, persistedLocalCards, pendingLocalCards);

        if (!card) return;

        // Pending card quota check (must happen before optimistic update)
        if (source === 'pending' && !canAddCard) {
          toast({
            title: '저장 한도 초과',
            description: `최대 ${subscription.limit}개까지 저장할 수 있습니다.`,
            variant: 'destructive',
          });
          return;
        }

        // 1. Snapshot for rollback
        const previousCards = cards;
        const previousScratchPad = scratchPadCards;
        const previousPending = pendingLocalCards;

        // Phase A: URGENT — 만다라 시각 즉시 업데이트
        skipNextSyncRef.current = true;
        setCards((prev) => {
          const existing = prev.find((c) => c.id === cardId);
          if (existing) {
            return prev.map((c) =>
              c.id === cardId ? { ...c, cellIndex, levelId: currentLevelId } : c
            );
          } else {
            return [...prev, { ...card, cellIndex, levelId: currentLevelId }];
          }
        });

        toast({
          title: '카드 이동됨',
          description: `"${currentLevel.subjects[cellIndex]}"로 이동했습니다.`,
        });

        // Phase B: DEFERRED — 스크래치패드 정리 (non-urgent)
        requestAnimationFrame(() => {
          startTransition(() => {
            setScratchPadCards((prev) => prev.filter((c) => c.id !== cardId));
            if (source === 'pending') {
              setPendingLocalCards((prev) => prev.filter((c) => c.id !== cardId));
            }
          });
        });

        // Phase C: BACKGROUND — fire-and-forget (await 제거)
        const networkCall =
          source === 'synced'
            ? updateVideoState.mutateAsync({
                videoStateId: cardId,
                updates: {
                  is_in_ideation: false,
                  cell_index: cellIndex,
                  level_id: currentLevelId,
                },
              })
            : source === 'local'
              ? updateLocalCard({
                  id: cardId,
                  cell_index: cellIndex,
                  level_id: currentLevelId,
                })
              : addLocalCard({
                  url: card.videoUrl,
                  title: card.title,
                  thumbnail: card.thumbnail,
                  link_type: card.linkType || 'other',
                  user_note: card.userNote,
                  cell_index: cellIndex,
                  level_id: currentLevelId,
                });

        networkCall.catch((error) => {
          console.error('[handleCardDrop] Failed to move card:', error);
          setCards(previousCards);
          setScratchPadCards(previousScratchPad);
          setPendingLocalCards(previousPending);
          toast({
            title: '이동 실패',
            description: `카드 이동에 실패했습니다: ${error instanceof Error ? error.message : 'Unknown error'}`,
            variant: 'destructive',
          });
        });
        return;
      }

      // Handle URL drop (new card)
      if (url) {
        // Require login for adding new content via URL drop
        if (!isLoggedIn) {
          toast({
            title: '로그인이 필요합니다',
            description: '만다라트에 추가하려면 먼저 로그인해주세요.',
            variant: 'destructive',
          });
          navigate('/login');
          return;
        }

        if (isValidUrl(url)) {
          const linkType = detectLinkType(url);
          const newCard = createCardFromUrl(url, cellIndex, currentLevelId);
          setCards((prev) => [...prev, newCard]);

          toast({
            title: '인사이트 추가됨',
            description: `"${currentLevel.subjects[cellIndex]}"에 저장되었습니다.`,
          });

          // Fetch title asynchronously and update card
          fetchLinkTitle(url, linkType).then((title) => {
            setCards((prev) =>
              prev.map((card) => (card.id === newCard.id ? { ...card, title } : card))
            );
          });

          // For non-YouTube links, also fetch full metadata
          if (linkType !== 'youtube' && linkType !== 'youtube-shorts') {
            fetchUrlMetadata(url).then((metadata) => {
              if (metadata) {
                setCards((prev) =>
                  prev.map((card) =>
                    card.id === newCard.id
                      ? {
                          ...card,
                          title: metadata.title || card.title,
                          thumbnail: metadata.image || card.thumbnail,
                          metadata,
                        }
                      : card
                  )
                );
              }
            });
          }
        } else {
          toast({
            title: '유효하지 않은 URL',
            description: 'YouTube, LinkedIn, Notion, txt, md, pdf 파일을 추가할 수 있습니다.',
            variant: 'destructive',
          });
        }
      }
    },
    [
      currentLevel.subjects,
      scratchPadCards,
      syncedCards,
      persistedLocalCards,
      pendingLocalCards,
      toast,
      currentLevelId,
      handleFileDrop,
      isLoggedIn,
      navigate,
      updateLocalCard,
      updateVideoState,
      canAddCard,
      subscription,
      addLocalCard,
      setPendingLocalCards,
      setCards,
      setScratchPadCards,
      batchMoveCards,
    ]
  );

  const handleScratchPadDrop = useCallback(
    (url: string) => {
      // Require login for D&D operations
      if (!isLoggedIn) {
        toast({
          title: '로그인이 필요합니다',
          description: '아이디에이션에 추가하려면 먼저 로그인해주세요.',
          variant: 'destructive',
        });
        navigate('/login');
        return;
      }

      if (isValidUrl(url)) {
        const linkType = detectLinkType(url);

        if (linkType === 'other') {
          toast({
            title: '지원하지 않는 링크',
            description: 'YouTube, LinkedIn, Facebook, Notion 링크만 추가할 수 있습니다.',
            variant: 'destructive',
          });
          return;
        }

        // Check subscription limit
        if (!canAddCard) {
          toast({
            title: '저장 한도 초과',
            description: `${subscription.tier === 'free' ? '무료' : subscription.tier} 플랜의 저장 한도(${subscription.limit}개)에 도달했습니다.`,
            variant: 'destructive',
          });
          return;
        }

        const newCard = createCardFromUrl(url, -1, 'scratchpad');
        // Add to pending for optimistic UI
        setPendingLocalCards((prev) => [...prev, newCard]);
        toast({
          title: '아이디에이션에 추가됨',
          description: '나중에 원하는 카테고리로 이동하세요.',
        });

        // Fetch metadata and persist to Supabase
        const persistCard = async () => {
          let title = newCard.title;
          let metadata = newCard.metadata;

          // Fetch title
          try {
            title = await fetchLinkTitle(url, linkType);
          } catch {}

          // For non-YouTube links, also fetch full metadata
          if (linkType !== 'youtube' && linkType !== 'youtube-shorts') {
            try {
              const fetchedMetadata = await fetchUrlMetadata(url);
              if (fetchedMetadata) {
                title = fetchedMetadata.title || title;
                metadata = fetchedMetadata;
              }
            } catch {}
          }

          // Persist to Supabase
          try {
            await addLocalCard({
              url,
              title,
              thumbnail: metadata?.image || newCard.thumbnail,
              link_type: linkType,
              user_note: '',
              metadata_title: metadata?.title,
              metadata_description: metadata?.description,
              metadata_image: metadata?.image,
              cell_index: -1,
              level_id: 'scratchpad',
            });
            // Remove from pending (will be in persisted now)
            setPendingLocalCards((prev) => prev.filter((c) => c.id !== newCard.id));
          } catch (error) {
            if (isLimitExceededError(error)) {
              toast({
                title: '저장 한도 초과',
                description: error.message,
                variant: 'destructive',
              });
            } else {
              toast({
                title: '저장 실패',
                description: error instanceof Error ? error.message : '카드를 저장하지 못했습니다.',
                variant: 'destructive',
              });
            }
            // Remove from pending on error
            setPendingLocalCards((prev) => prev.filter((c) => c.id !== newCard.id));
          }
        };

        persistCard();
      } else {
        toast({
          title: '유효하지 않은 URL',
          description: 'YouTube, LinkedIn, Facebook, Notion 링크만 추가할 수 있습니다.',
          variant: 'destructive',
        });
      }
    },
    [isLoggedIn, navigate, toast, canAddCard, subscription, addLocalCard]
  );

  const handleScratchPadCardDrop = useCallback(
    (cardId: string) => {
      // Moving card from mandala back to ideation
      const source = detectCardSource(cardId, syncedCards, persistedLocalCards);
      const card = cards.find((c) => c.id === cardId);

      if (!card) return;

      // Phase A: URGENT — 만다라에서 즉시 제거
      const previousCards = cards;
      skipNextSyncRef.current = true;
      setCards((prev) => prev.filter((c) => c.id !== cardId));
      toast({
        title: '아이디에이션으로 이동됨',
        description: '나중에 다시 분류할 수 있습니다.',
      });

      // Phase C: BACKGROUND — fire-and-forget (Phase B 불필요)
      const networkCall =
        source === 'synced'
          ? updateVideoState.mutateAsync({
              videoStateId: cardId,
              updates: {
                is_in_ideation: true,
                cell_index: -1,
                level_id: 'scratchpad',
              },
            })
          : updateLocalCard({
              id: cardId,
              cell_index: -1,
              level_id: 'scratchpad',
            });

      networkCall.catch((error) => {
        setCards(previousCards);
        toast({
          title: '이동 실패',
          description: `카드를 이동하지 못했습니다: ${error instanceof Error ? error.message : 'Unknown error'}`,
          variant: 'destructive',
        });
      });
    },
    [cards, syncedCards, persistedLocalCards, updateVideoState, updateLocalCard, toast, setCards]
  );

  const handleScratchPadMultiCardDrop = useCallback(
    (cardIds: string[]) => {
      // 1. Snapshot for rollback
      const previousCards = cards;
      const movedCount = cards.filter((c) => cardIds.includes(c.id)).length;

      // Phase A: URGENT — 만다라에서 즉시 제거
      skipNextSyncRef.current = true;
      setCards((prev) => prev.filter((c) => !cardIds.includes(c.id)));
      toast({
        title: `${movedCount}개 카드 이동됨`,
        description: '아이디에이션으로 이동했습니다.',
      });

      // Phase C: BACKGROUND — fire-and-forget
      const batchItems = cardIds
        .map((cardId) => {
          const source = detectCardSource(cardId, syncedCards, persistedLocalCards);
          const card = previousCards.find((c) => c.id === cardId);
          if (!card) return null;
          return { card, source, cellIndex: -1, levelId: 'scratchpad' };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);

      batchMoveCards.mutateAsync({ items: batchItems }).catch(() => {
        setCards(previousCards);
        toast({
          title: '이동 실패',
          description: `일부 카드 이동에 실패했습니다.`,
          variant: 'destructive',
        });
      });
    },
    [cards, syncedCards, persistedLocalCards, batchMoveCards, toast, setCards]
  );

  const handleCardClick = useCallback((card: InsightCard) => {
    // Open VideoPlayerModal on card click (shift+click handled in components)
    setSelectedCard(card);
    setIsModalOpen(true);
  }, []);

  const handleCardDragStart = useCallback((card: InsightCard) => {
    setDraggingCard(card);
  }, []);

  const handleSaveNote = useCallback(
    async (id: string, note: string) => {
      // Use detectCardSource for consistent card type detection
      const source = detectCardSource(id, syncedCards, persistedLocalCards);

      console.log('[handleSaveNote] Card source detected:', { id: id.slice(0, 8), source });

      try {
        switch (source) {
          case 'synced':
            // Update in Supabase via YouTube sync
            await updateVideoState.mutateAsync({ videoStateId: id, updates: { user_note: note } });
            toast({
              title: '메모 저장됨',
              description: 'YouTube 동영상 메모가 동기화되었습니다.',
            });
            break;

          case 'local':
            // Update persisted local card in Supabase
            await updateLocalCard({ id, user_note: note });
            toast({
              title: '메모 저장됨',
              description: '로컬 카드 메모가 동기화되었습니다.',
            });
            break;

          case 'pending':
            // Pending cards are not yet in DB - find the card and save it first
            const pendingCard = [...scratchPadCards, ...cards].find((c) => c.id === id);
            if (pendingCard) {
              // First, persist the card with the note
              await addLocalCard({
                url: pendingCard.videoUrl,
                title: pendingCard.title,
                thumbnail: pendingCard.thumbnail,
                link_type: pendingCard.linkType || 'other',
                user_note: note,
                metadata_title: pendingCard.metadata?.title,
                metadata_description: pendingCard.metadata?.description,
                metadata_image: pendingCard.metadata?.image,
                cell_index: pendingCard.cellIndex ?? -1,
                level_id: pendingCard.levelId ?? 'scratchpad',
              });
              toast({
                title: '카드 저장됨',
                description: '카드와 메모가 저장되었습니다.',
              });
            } else {
              console.error('[handleSaveNote] Pending card not found:', id);
              toast({
                title: '저장 실패',
                description: '카드를 찾을 수 없습니다.',
                variant: 'destructive',
              });
            }
            break;
        }

        // Also update local state for immediate UI feedback
        setCards((prev) =>
          prev.map((card) => (card.id === id ? { ...card, userNote: note } : card))
        );
      } catch (error) {
        console.error('[handleSaveNote] Failed to save note:', error);
        toast({
          title: '저장 실패',
          description: error instanceof Error ? error.message : '메모를 저장하지 못했습니다.',
          variant: 'destructive',
        });
      }
    },
    [
      syncedCards,
      persistedLocalCards,
      scratchPadCards,
      cards,
      updateVideoState,
      updateLocalCard,
      addLocalCard,
      toast,
    ]
  );

  // Save watch position for YouTube videos (only for logged-in users with synced videos)
  const handleSaveWatchPosition = useCallback(
    (id: string, positionSeconds: number) => {
      // Only save for synced videos
      const isSyncedVideo = syncedCards.some((c) => c.id === id);

      if (isSyncedVideo) {
        // Update in Supabase (silent, no toast)
        updateVideoState.mutate(
          { videoStateId: id, updates: { watch_position_seconds: positionSeconds } },
          {
            onError: (error) => {
              console.error('Failed to save watch position:', error);
            },
          }
        );
      }
    },
    [syncedCards, updateVideoState]
  );

  const handleCardsReorder = useCallback(
    (reorderedCards: InsightCard[]) => {
      setCards((prev) => {
        // Update only the reordered cards (those with matching IDs)
        const reorderedIds = new Set(reorderedCards.map((c) => c.id));
        const unchangedCards = prev.filter((c) => !reorderedIds.has(c.id));
        return [...unchangedCards, ...reorderedCards];
      });
      toast({
        title: '순서 변경됨',
        description: '카드 순서가 업데이트되었습니다.',
      });
    },
    [toast]
  );

  const handleDeleteCards = useCallback(
    (cardIds: string[]) => {
      const syncedIds = new Set(syncedCards.map((c) => c.id));
      const persistedIds = new Set(persistedLocalCards.map((c) => c.id));

      // Separate by type: synced YouTube videos, persisted local cards, mandala cards
      const syncedToDelete = cardIds.filter((id) => syncedIds.has(id));
      const persistedToDelete = cardIds.filter((id) => persistedIds.has(id));
      const mandalaToDelete = cardIds.filter((id) => !syncedIds.has(id) && !persistedIds.has(id));

      // Delete synced cards from Supabase (remove from ideation)
      if (syncedToDelete.length > 0) {
        Promise.all(
          syncedToDelete.map((id) =>
            updateVideoState.mutateAsync({ videoStateId: id, updates: { is_in_ideation: false } })
          )
        )
          .then(() => {
            toast({
              title: '삭제됨',
              description: `${syncedToDelete.length}개의 동영상이 아이디에이션에서 제거되었습니다.`,
            });
          })
          .catch((error) => {
            toast({
              title: '삭제 실패',
              description:
                error instanceof Error ? error.message : '일부 동영상을 삭제하지 못했습니다.',
              variant: 'destructive',
            });
          });
      }

      // Delete persisted local cards from Supabase
      if (persistedToDelete.length > 0) {
        Promise.all(persistedToDelete.map((id) => deleteLocalCard(id)))
          .then(() => {
            toast({
              title: '삭제됨',
              description: `${persistedToDelete.length}개의 로컬 카드가 삭제되었습니다.`,
            });
          })
          .catch((error) => {
            toast({
              title: '삭제 실패',
              description:
                error instanceof Error ? error.message : '일부 카드를 삭제하지 못했습니다.',
              variant: 'destructive',
            });
          });
      }

      // Delete mandala cards (local state only)
      if (mandalaToDelete.length > 0) {
        const mandalaIdSet = new Set(mandalaToDelete);
        setCards((prev) => prev.filter((c) => !mandalaIdSet.has(c.id)));
        toast({
          title: '삭제됨',
          description: `${mandalaToDelete.length}개의 카드가 삭제되었습니다.`,
        });
      }
    },
    [syncedCards, persistedLocalCards, updateVideoState, deleteLocalCard, toast]
  );

  // Get cards for selected cell or all cards in current level (including sub-levels)
  const currentLevelCards = cards.filter((card) => {
    if (card.levelId === currentLevelId) return true;
    // Include cards from sub-levels
    return currentLevel.subjects.some((subject) => {
      const subLevelId = subject.toLowerCase().replace(/\s/g, '');
      return card.levelId === subLevelId;
    });
  });
  const displayCards =
    selectedCellIndex !== null ? cardsByCell[selectedCellIndex] || [] : currentLevelCards;

  const displayTitle =
    selectedCellIndex !== null
      ? currentLevel.subjects[selectedCellIndex] || ''
      : currentLevel.centerGoal;

  // Get the current card data from cards array (not stale selectedCard snapshot)
  // ✅ Bug 1 Fix: useMemo로 감싸서 무한 리렌더링 방지
  const currentModalCard = useMemo(() => {
    if (!selectedCard?.id) return null;
    const foundCard =
      cards.find((c) => c.id === selectedCard.id) ||
      scratchPadCards.find((c) => c.id === selectedCard.id);
    return foundCard ?? selectedCard;
  }, [selectedCard?.id, selectedCard?.userNote, cards, scratchPadCards]);

  return (
    <div className="h-screen flex flex-col bg-surface-base overflow-hidden">
      <Header onNavigateHome={() => handleNavigate('root')} />

      <DropZoneOverlay isVisible={isDraggingOver && !draggingCard && !isDraggingCell} />

      {/* Fixed Ideation Timeline - Top position */}
      {!isScratchPadFloating && scratchPadDockPosition === 'top' && (
        <div className="flex-shrink-0 relative z-30">
          <FloatingScratchPad
            cards={scratchPadCards}
            isDropTarget={isScratchPadDropTarget}
            onDrop={handleScratchPadDrop}
            onCardDrop={handleScratchPadCardDrop}
            onMultiCardDrop={handleScratchPadMultiCardDrop}
            onCardClick={handleCardClick}
            onDragOver={() => setIsScratchPadDropTarget(true)}
            onDragLeave={() => setIsScratchPadDropTarget(false)}
            onCardDragStart={handleCardDragStart}
            onDeleteCards={handleDeleteCards}
            onFileDrop={handleScratchPadFileDrop}
            isFloating={false}
            onToggleFloating={() => handleSetScratchPadFloating(true)}
            dockPosition={scratchPadDockPosition}
            onDockPositionChange={handleSetScratchPadDockPosition}
          />
        </div>
      )}

      {/* Floating ScratchPad */}
      {isScratchPadFloating && (
        <FloatingScratchPad
          cards={scratchPadCards}
          isDropTarget={isScratchPadDropTarget}
          onDrop={handleScratchPadDrop}
          onCardDrop={handleScratchPadCardDrop}
          onMultiCardDrop={handleScratchPadMultiCardDrop}
          onCardClick={handleCardClick}
          onDragOver={() => setIsScratchPadDropTarget(true)}
          onDragLeave={() => setIsScratchPadDropTarget(false)}
          onCardDragStart={handleCardDragStart}
          onDeleteCards={handleDeleteCards}
          onFileDrop={handleScratchPadFileDrop}
          isFloating={true}
          onToggleFloating={() => handleSetScratchPadFloating(false)}
          dockPosition={scratchPadDockPosition}
          onDockPositionChange={handleSetScratchPadDockPosition}
          initialPosition={
            prefScratchpadPosX !== undefined && prefScratchpadPosY !== undefined
              ? { x: prefScratchpadPosX, y: prefScratchpadPosY }
              : undefined
          }
          onPositionChange={setScratchPadPosition}
        />
      )}

      {/* Floating Mandala - Rendered at root level for proper fixed positioning */}
      {(isMandalaFloating || isMandalaFloatingMode) && (
        <FloatingMandala
          centerGoal={currentLevel.centerGoal}
          totalCards={totalCards}
          isMinimized={isMandalaMinimized}
          onToggleMinimized={() => handleSetMandalaMinimized(!isMandalaMinimized)}
          isFloating={true}
          onToggleFloating={() => handleSetMandalaFloating(false)}
          dockPosition={mandalaDockPosition}
          onDockPositionChange={handleSetMandalaDockPosition}
          initialPosition={
            prefMandalaPosX !== undefined && prefMandalaPosY !== undefined
              ? { x: prefMandalaPosX, y: prefMandalaPosY }
              : undefined
          }
          onPositionChange={setMandalaPosition}
        >
          <MandalaGrid
            level={currentLevel}
            cardsByCell={cardsByCell}
            selectedCellIndex={selectedCellIndex}
            onCellClick={handleCellClick}
            onCardDrop={handleCardDrop}
            onCardClick={handleCardClick}
            onCardDragStart={handleCardDragStart}
            onSubjectsReorder={handleSubjectsReorder}
            onCellDragging={setIsDraggingCell}
            isGridDropZone={isDraggingOver && !draggingCard && !isDraggingCell}
            hasSubLevel={hasSubLevel}
            onNavigateToSubLevel={handleNavigateToSubLevel}
            onNavigateBack={handleNavigateBack}
            canGoBack={path.length > 0}
            entryGridIndex={entryGridIndex}
            showHint={false}
            hideHeader={true}
            isCompact={true}
          />
        </FloatingMandala>
      )}

      {/* Main Content Area with optional side docking */}
      <main className="flex-1 overflow-hidden flex">
        {/* Left Side Docked ScratchPad (Ideation first) */}
        {!isScratchPadFloating && scratchPadDockPosition === 'left' && (
          <div className="flex-shrink-0 bg-surface-mid/90 backdrop-blur-sm border-r border-border/30 relative z-30 h-full">
            <FloatingScratchPad
              cards={scratchPadCards}
              isDropTarget={isScratchPadDropTarget}
              onDrop={handleScratchPadDrop}
              onCardDrop={handleScratchPadCardDrop}
              onMultiCardDrop={handleScratchPadMultiCardDrop}
              onCardClick={handleCardClick}
              onDragOver={() => setIsScratchPadDropTarget(true)}
              onDragLeave={() => setIsScratchPadDropTarget(false)}
              onCardDragStart={handleCardDragStart}
              onDeleteCards={handleDeleteCards}
              onFileDrop={handleScratchPadFileDrop}
              isFloating={false}
              onToggleFloating={() => handleSetScratchPadFloating(true)}
              dockPosition={scratchPadDockPosition}
              onDockPositionChange={handleSetScratchPadDockPosition}
            />
          </div>
        )}

        {/* Left Side Docked Mandala (second) */}
        {!isMandalaFloating && !isMandalaFloatingMode && mandalaDockPosition === 'left' && (
          <FloatingMandala
            centerGoal={currentLevel.centerGoal}
            totalCards={totalCards}
            isMinimized={isMandalaMinimized}
            onToggleMinimized={() => handleSetMandalaMinimized(!isMandalaMinimized)}
            isFloating={false}
            onToggleFloating={() => handleSetMandalaFloating(true)}
            dockPosition={mandalaDockPosition}
            onDockPositionChange={handleSetMandalaDockPosition}
          >
            <MandalaGrid
              level={currentLevel}
              cardsByCell={cardsByCell}
              selectedCellIndex={selectedCellIndex}
              onCellClick={handleCellClick}
              onCardDrop={handleCardDrop}
              onCardClick={handleCardClick}
              onCardDragStart={handleCardDragStart}
              onSubjectsReorder={handleSubjectsReorder}
              onCellDragging={setIsDraggingCell}
              isGridDropZone={isDraggingOver && !draggingCard && !isDraggingCell}
              hasSubLevel={hasSubLevel}
              onNavigateToSubLevel={handleNavigateToSubLevel}
              onNavigateBack={handleNavigateBack}
              canGoBack={path.length > 0}
              entryGridIndex={entryGridIndex}
              showHint={false}
              hideHeader={true}
            />
          </FloatingMandala>
        )}

        <div className="flex-1 overflow-hidden">
          <div className="container mx-auto px-4 py-4 h-full">
            <div className="flex flex-col lg:flex-row gap-6 lg:gap-8 h-full">
              {/* Card List - Scrollable */}
              <div className="flex-1 min-w-0 overflow-y-auto relative z-10 scrollbar-pro">
                <CardList
                  cards={displayCards}
                  title={displayTitle}
                  onCardClick={handleCardClick}
                  onCardDragStart={handleCardDragStart}
                  onMultiCardDragStart={(cards) => setDraggingCard(cards[0])}
                  onSaveNote={handleSaveNote}
                  onCardsReorder={handleCardsReorder}
                  onDeleteCards={handleDeleteCards}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right Side Docked Mandala (first from inside) */}
        {!isMandalaFloating && !isMandalaFloatingMode && mandalaDockPosition === 'right' && (
          <FloatingMandala
            centerGoal={currentLevel.centerGoal}
            totalCards={totalCards}
            isMinimized={isMandalaMinimized}
            onToggleMinimized={() => handleSetMandalaMinimized(!isMandalaMinimized)}
            isFloating={false}
            onToggleFloating={() => handleSetMandalaFloating(true)}
            dockPosition={mandalaDockPosition}
            onDockPositionChange={handleSetMandalaDockPosition}
          >
            <MandalaGrid
              level={currentLevel}
              cardsByCell={cardsByCell}
              selectedCellIndex={selectedCellIndex}
              onCellClick={handleCellClick}
              onCardDrop={handleCardDrop}
              onCardClick={handleCardClick}
              onCardDragStart={handleCardDragStart}
              onSubjectsReorder={handleSubjectsReorder}
              onCellDragging={setIsDraggingCell}
              isGridDropZone={isDraggingOver && !draggingCard && !isDraggingCell}
              hasSubLevel={hasSubLevel}
              onNavigateToSubLevel={handleNavigateToSubLevel}
              onNavigateBack={handleNavigateBack}
              canGoBack={path.length > 0}
              entryGridIndex={entryGridIndex}
              showHint={false}
              hideHeader={true}
            />
          </FloatingMandala>
        )}

        {/* Right Side Docked ScratchPad (Ideation on edge) */}
        {!isScratchPadFloating && scratchPadDockPosition === 'right' && (
          <div className="flex-shrink-0 bg-surface-mid/90 backdrop-blur-sm border-l border-border/30 relative z-30 h-full">
            <FloatingScratchPad
              cards={scratchPadCards}
              isDropTarget={isScratchPadDropTarget}
              onDrop={handleScratchPadDrop}
              onCardDrop={handleScratchPadCardDrop}
              onMultiCardDrop={handleScratchPadMultiCardDrop}
              onCardClick={handleCardClick}
              onDragOver={() => setIsScratchPadDropTarget(true)}
              onDragLeave={() => setIsScratchPadDropTarget(false)}
              onCardDragStart={handleCardDragStart}
              onDeleteCards={handleDeleteCards}
              onFileDrop={handleScratchPadFileDrop}
              isFloating={false}
              onToggleFloating={() => handleSetScratchPadFloating(true)}
              dockPosition={scratchPadDockPosition}
              onDockPositionChange={handleSetScratchPadDockPosition}
            />
          </div>
        )}
      </main>

      {/* Fixed Ideation Timeline - Bottom position */}
      {!isScratchPadFloating && scratchPadDockPosition === 'bottom' && (
        <div className="flex-shrink-0 bg-surface-mid/90 backdrop-blur-sm border-t border-border/30 relative z-30">
          <FloatingScratchPad
            cards={scratchPadCards}
            isDropTarget={isScratchPadDropTarget}
            onDrop={handleScratchPadDrop}
            onCardDrop={handleScratchPadCardDrop}
            onMultiCardDrop={handleScratchPadMultiCardDrop}
            onCardClick={handleCardClick}
            onDragOver={() => setIsScratchPadDropTarget(true)}
            onDragLeave={() => setIsScratchPadDropTarget(false)}
            onCardDragStart={handleCardDragStart}
            onDeleteCards={handleDeleteCards}
            onFileDrop={handleScratchPadFileDrop}
            isFloating={false}
            onToggleFloating={() => handleSetScratchPadFloating(true)}
            dockPosition={scratchPadDockPosition}
            onDockPositionChange={handleSetScratchPadDockPosition}
          />
        </div>
      )}

      {/* Video Player Modal */}
      <VideoPlayerModal
        card={currentModalCard}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveNote}
        onSaveWatchPosition={handleSaveWatchPosition}
      />
    </div>
  );
};

export default Index;
