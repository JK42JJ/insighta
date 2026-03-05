import { useState, useEffect, useCallback, useMemo } from 'react';
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

  // Demo cards for non-logged-in users
  const [demoCards] = useState<InsightCard[]>(() => (isLoggedIn ? [] : createMockCards()));
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
    return syncedCards.filter((c) => c.isInIdeation === true);
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

  // Pending cards that are in mandala grid (not scratchpad)
  const pendingMandalaCards = useMemo(() => {
    return pendingLocalCards.filter(
      (c) =>
        typeof c.cellIndex === 'number' &&
        c.cellIndex >= 0 &&
        c.levelId &&
        c.levelId !== 'scratchpad'
    );
  }, [pendingLocalCards]);

  // All mandala cards = RQ-derived (single source of truth, no manual sync needed)
  const allMandalaCards = useMemo(() => {
    if (!isLoggedIn) return demoCards;
    return [...mandalaLocalCards, ...mandalaVideoCards, ...pendingMandalaCards];
  }, [isLoggedIn, demoCards, mandalaLocalCards, mandalaVideoCards, pendingMandalaCards]);

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
    return allMandalaCards.reduce(
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
  }, [allMandalaCards, currentLevelId, currentLevel.subjects]);

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
        } catch {
          /* metadata fetch failures are non-critical */
        }

        // For non-YouTube links, also fetch full metadata
        if (linkType !== 'youtube' && linkType !== 'youtube-shorts') {
          try {
            const fetchedMetadata = await fetchUrlMetadata(text);
            if (fetchedMetadata) {
              title = fetchedMetadata.title || title;
              metadata = fetchedMetadata;
            }
          } catch {
            /* metadata fetch failures are non-critical */
          }
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
          } catch {
            /* metadata fetch failures are non-critical */
          }
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
      const cardsToMigrate = allMandalaCards.filter(
        (c) => c.levelId === currentLevelId && c.cellIndex === parentCellIndex
      );
      if (cardsToMigrate.length > 0) {
        const batchItems = cardsToMigrate.map((card) => ({
          card,
          source: detectCardSource(card.id, syncedCards, persistedLocalCards, card),
          cellIndex: 0,
          levelId: nextLevelId,
        }));
        batchMoveCards.mutate({ items: batchItems });
      }

      setPath([...path, { id: currentLevelId, label: currentLevel.centerGoal }]);
      setCurrentLevelId(nextLevelId);
      setSelectedCellIndex(null);
      setEntryGridIndex(gridIndex); // Remember entry direction for back navigation

      toast({
        title: `${subject} 레벨로 이동`,
        description: '하위 만다라트로 이동했습니다.',
      });
    },
    [
      mandalaLevels,
      path,
      currentLevelId,
      currentLevel,
      toast,
      allMandalaCards,
      syncedCards,
      persistedLocalCards,
      batchMoveCards,
    ]
  );

  const handleSubjectsReorder = useCallback(
    (newSubjects: string[], swappedIndices?: { from: number; to: number }) => {
      setMandalaLevels((prev) => ({
        ...prev,
        [currentLevelId]: {
          ...prev[currentLevelId],
          subjects: newSubjects,
        },
      }));

      // Swap cards between the two cells via batch mutation (onMutate handles optimistic UI)
      if (swappedIndices) {
        const affectedCards = allMandalaCards.filter(
          (c) =>
            c.levelId === currentLevelId &&
            (c.cellIndex === swappedIndices.from || c.cellIndex === swappedIndices.to)
        );

        if (affectedCards.length > 0) {
          const batchItems = affectedCards.map((card) => ({
            card,
            source: detectCardSource(card.id, syncedCards, persistedLocalCards, card),
            cellIndex:
              card.cellIndex === swappedIndices.from ? swappedIndices.to : swappedIndices.from,
            levelId: currentLevelId,
          }));
          batchMoveCards.mutate({ items: batchItems });
        }

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
      allMandalaCards,
      syncedCards,
      persistedLocalCards,
      batchMoveCards,
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

  // Handle file drop for cells — add as pending then persist
  const handleFileDrop = useCallback(
    async (cellIndex: number, files: FileList) => {
      for (const file of Array.from(files)) {
        const newCard = await handleFileUpload(file, cellIndex, currentLevelId);
        if (newCard) {
          // Add to pending, then persist to Supabase
          setPendingLocalCards((prev) => [...prev, newCard]);
          addLocalCard({
            url: newCard.videoUrl,
            title: newCard.title,
            thumbnail: newCard.thumbnail,
            link_type: newCard.linkType || 'other',
            user_note: '',
            cell_index: cellIndex,
            level_id: currentLevelId,
          })
            .then(() => setPendingLocalCards((prev) => prev.filter((c) => c.id !== newCard.id)))
            .catch(() => setPendingLocalCards((prev) => prev.filter((c) => c.id !== newCard.id)));
          toast({
            title: '파일 추가됨',
            description: `"${currentLevel.subjects[cellIndex]}"에 저장되었습니다.`,
          });
        }
      }
    },
    [handleFileUpload, currentLevelId, currentLevel.subjects, toast, addLocalCard]
  );

  // Handle file drop for scratchpad
  const handleScratchPadFileDrop = useCallback(
    async (files: FileList) => {
      for (const file of Array.from(files)) {
        const newCard = await handleFileUpload(file, -1, 'scratchpad');
        if (newCard) {
          setPendingLocalCards((prev) => [...prev, newCard]);
          addLocalCard({
            url: newCard.videoUrl,
            title: newCard.title,
            thumbnail: newCard.thumbnail,
            link_type: newCard.linkType || 'other',
            user_note: '',
            cell_index: -1,
            level_id: 'scratchpad',
          })
            .then(() => setPendingLocalCards((prev) => prev.filter((c) => c.id !== newCard.id)))
            .catch(() => setPendingLocalCards((prev) => prev.filter((c) => c.id !== newCard.id)));
          toast({
            title: '파일이 아이디에이션에 추가됨',
            description: file.name,
          });
        }
      }
    },
    [handleFileUpload, toast, addLocalCard]
  );

  const handleCardDrop = useCallback(
    (
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

      // Handle multi-card drop — batchMoveCards.onMutate handles optimistic UI
      if (multiCardIds && multiCardIds.length > 0) {
        const pendingIds = multiCardIds.filter((id) => {
          const c = getCardById(id, syncedCards, persistedLocalCards, pendingLocalCards);
          return detectCardSource(id, syncedCards, persistedLocalCards, c) === 'pending';
        });
        if (pendingIds.length > 0 && !canAddCard) {
          toast({
            title: '저장 한도 초과',
            description: `최대 ${subscription.limit}개까지 저장할 수 있습니다.`,
            variant: 'destructive',
          });
          return;
        }

        const batchItems = multiCardIds
          .map((id) => {
            const card = getCardById(id, syncedCards, persistedLocalCards, pendingLocalCards);
            if (!card) return null;
            const source = detectCardSource(id, syncedCards, persistedLocalCards, card);
            return { card, source, cellIndex, levelId: currentLevelId };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null);

        // Clean up pending cards from scratchpad
        setPendingLocalCards((prev) => prev.filter((c) => !multiCardIds.includes(c.id)));

        batchMoveCards.mutate(
          { items: batchItems },
          {
            onSuccess: () => {
              toast({
                title: `${multiCardIds.length}개 카드 이동됨`,
                description: `"${currentLevel.subjects[cellIndex]}"로 이동했습니다.`,
              });
            },
            onError: (error) => {
              console.error('[handleCardDrop] batch move failed:', error);
              toast({
                title: '이동 실패',
                description: error instanceof Error ? error.message : '잠시 후 다시 시도해 주세요.',
                variant: 'destructive',
              });
            },
          }
        );
        return;
      }

      // Handle single card drop — mutation.onMutate handles optimistic UI
      if (cardId) {
        const card = getCardById(cardId, syncedCards, persistedLocalCards, pendingLocalCards);
        if (!card) return;
        const source = detectCardSource(cardId, syncedCards, persistedLocalCards, card);

        if (source === 'pending' && !canAddCard) {
          toast({
            title: '저장 한도 초과',
            description: `최대 ${subscription.limit}개까지 저장할 수 있습니다.`,
            variant: 'destructive',
          });
          return;
        }

        // Clean up pending from scratchpad
        if (source === 'pending') {
          setPendingLocalCards((prev) => prev.filter((c) => c.id !== cardId));
        }

        const successHandler = () => {
          toast({
            title: '카드 이동됨',
            description: `"${currentLevel.subjects[cellIndex]}"로 이동했습니다.`,
          });
        };

        const errorHandler = (error: unknown) => {
          console.error('[handleCardDrop] single card move failed:', error);
          toast({
            title: '이동 실패',
            description: error instanceof Error ? error.message : '잠시 후 다시 시도해 주세요.',
            variant: 'destructive',
          });
        };

        if (source === 'synced') {
          updateVideoState.mutate(
            {
              videoStateId: cardId,
              updates: { is_in_ideation: false, cell_index: cellIndex, level_id: currentLevelId },
            },
            { onSuccess: successHandler, onError: errorHandler }
          );
        } else if (source === 'local') {
          updateLocalCard({ id: cardId, cell_index: cellIndex, level_id: currentLevelId })
            .then(successHandler)
            .catch(errorHandler);
        } else {
          // Pending card → persist via addLocalCard
          addLocalCard({
            url: card.videoUrl,
            title: card.title,
            thumbnail: card.thumbnail,
            link_type: card.linkType || 'other',
            user_note: card.userNote,
            cell_index: cellIndex,
            level_id: currentLevelId,
          })
            .then(successHandler)
            .catch(errorHandler);
        }
        return;
      }

      // Handle URL drop (new card) — add as pending then persist
      if (url) {
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

          // Add to pending for immediate UI feedback
          setPendingLocalCards((prev) => [...prev, newCard]);

          toast({
            title: '인사이트 추가됨',
            description: `"${currentLevel.subjects[cellIndex]}"에 저장되었습니다.`,
          });

          // Persist to Supabase (fetch metadata first for non-YouTube links)
          const persistCard = async () => {
            let title = newCard.title;
            let metadata = newCard.metadata;

            try {
              title = await fetchLinkTitle(url, linkType);
            } catch {
              /* metadata fetch failures are non-critical */
            }

            if (linkType !== 'youtube' && linkType !== 'youtube-shorts') {
              try {
                const fetched = await fetchUrlMetadata(url);
                if (fetched) {
                  title = fetched.title || title;
                  metadata = fetched;
                }
              } catch {
                /* metadata fetch failures are non-critical */
              }
            }

            await addLocalCard({
              url,
              title,
              thumbnail: metadata?.image || newCard.thumbnail,
              link_type: linkType,
              user_note: '',
              metadata_title: metadata?.title,
              metadata_description: metadata?.description,
              metadata_image: metadata?.image,
              cell_index: cellIndex,
              level_id: currentLevelId,
            });
            setPendingLocalCards((prev) => prev.filter((c) => c.id !== newCard.id));
          };

          persistCard().catch(() => {
            setPendingLocalCards((prev) => prev.filter((c) => c.id !== newCard.id));
            toast({
              title: '저장 실패',
              description: '카드를 저장하지 못했습니다.',
              variant: 'destructive',
            });
          });
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
          } catch {
            /* metadata fetch failures are non-critical */
          }

          // For non-YouTube links, also fetch full metadata
          if (linkType !== 'youtube' && linkType !== 'youtube-shorts') {
            try {
              const fetchedMetadata = await fetchUrlMetadata(url);
              if (fetchedMetadata) {
                title = fetchedMetadata.title || title;
                metadata = fetchedMetadata;
              }
            } catch {
              /* metadata fetch failures are non-critical */
            }
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
      // Moving card from mandala back to ideation — mutation.onMutate handles optimistic UI
      const card = allMandalaCards.find((c) => c.id === cardId);
      if (!card) return;
      const source = detectCardSource(cardId, syncedCards, persistedLocalCards, card);

      const successHandler = () => {
        toast({
          title: '아이디에이션으로 이동됨',
          description: '나중에 다시 분류할 수 있습니다.',
        });
      };

      const errorHandler = (error: unknown) => {
        console.error('[handleScratchPadCardDrop] move failed:', error);
        toast({
          title: '이동 실패',
          description: error instanceof Error ? error.message : '잠시 후 다시 시도해 주세요.',
          variant: 'destructive',
        });
      };

      if (source === 'synced') {
        updateVideoState.mutate(
          {
            videoStateId: cardId,
            updates: { is_in_ideation: true, cell_index: -1, level_id: 'scratchpad' },
          },
          { onSuccess: successHandler, onError: errorHandler }
        );
      } else {
        updateLocalCard({ id: cardId, cell_index: -1, level_id: 'scratchpad' })
          .then(successHandler)
          .catch(errorHandler);
      }
    },
    [allMandalaCards, syncedCards, persistedLocalCards, updateVideoState, updateLocalCard, toast]
  );

  const handleScratchPadMultiCardDrop = useCallback(
    (cardIds: string[]) => {
      const batchItems = cardIds
        .map((cardId) => {
          const card = allMandalaCards.find((c) => c.id === cardId);
          if (!card) return null;
          const source = detectCardSource(cardId, syncedCards, persistedLocalCards, card);
          return { card, source, cellIndex: -1, levelId: 'scratchpad' };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);

      batchMoveCards.mutate(
        { items: batchItems },
        {
          onSuccess: () => {
            toast({
              title: `${batchItems.length}개 카드 이동됨`,
              description: '아이디에이션으로 이동했습니다.',
            });
          },
          onError: (error) => {
            console.error('[handleScratchPadMultiCardDrop] batch move failed:', error);
            toast({
              title: '이동 실패',
              description: error instanceof Error ? error.message : '잠시 후 다시 시도해 주세요.',
              variant: 'destructive',
            });
          },
        }
      );
    },
    [allMandalaCards, syncedCards, persistedLocalCards, batchMoveCards, toast]
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
      const source = detectCardSource(id, syncedCards, persistedLocalCards);

      try {
        switch (source) {
          case 'synced':
            await updateVideoState.mutateAsync({ videoStateId: id, updates: { user_note: note } });
            toast({ title: '메모 저장됨', description: 'YouTube 동영상 메모가 동기화되었습니다.' });
            break;

          case 'local':
            await updateLocalCard({ id, user_note: note });
            toast({ title: '메모 저장됨', description: '로컬 카드 메모가 동기화되었습니다.' });
            break;

          case 'pending': {
            const pendingCard = [...scratchPadCards, ...allMandalaCards].find((c) => c.id === id);
            if (pendingCard) {
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
              setPendingLocalCards((prev) => prev.filter((c) => c.id !== id));
              toast({ title: '카드 저장됨', description: '카드와 메모가 저장되었습니다.' });
            } else {
              toast({
                title: '저장 실패',
                description: '카드를 찾을 수 없습니다.',
                variant: 'destructive',
              });
            }
            break;
          }
        }
      } catch (error) {
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
      allMandalaCards,
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
      // Persist reordered positions via batch mutation
      const batchItems = reorderedCards.map((card) => ({
        card,
        source: detectCardSource(card.id, syncedCards, persistedLocalCards, card),
        cellIndex: card.cellIndex,
        levelId: card.levelId,
      }));
      if (batchItems.length > 0) {
        batchMoveCards.mutate({ items: batchItems });
      }
      toast({
        title: '순서 변경됨',
        description: '카드 순서가 업데이트되었습니다.',
      });
    },
    [toast, syncedCards, persistedLocalCards, batchMoveCards]
  );

  const handleDeleteCards = useCallback(
    (cardIds: string[]) => {
      const syncedIds = new Set(syncedCards.map((c) => c.id));
      const persistedIds = new Set(persistedLocalCards.map((c) => c.id));

      const syncedToDelete = cardIds.filter((id) => syncedIds.has(id));
      const persistedToDelete = cardIds.filter((id) => persistedIds.has(id));
      const pendingToDelete = cardIds.filter((id) => !syncedIds.has(id) && !persistedIds.has(id));

      if (syncedToDelete.length > 0) {
        Promise.all(
          syncedToDelete.map((id) =>
            updateVideoState.mutateAsync({ videoStateId: id, updates: { is_in_ideation: false } })
          )
        )
          .then(() =>
            toast({
              title: '삭제됨',
              description: `${syncedToDelete.length}개의 동영상이 아이디에이션에서 제거되었습니다.`,
            })
          )
          .catch((error) =>
            toast({
              title: '삭제 실패',
              description:
                error instanceof Error ? error.message : '일부 동영상을 삭제하지 못했습니다.',
              variant: 'destructive',
            })
          );
      }

      if (persistedToDelete.length > 0) {
        Promise.all(persistedToDelete.map((id) => deleteLocalCard(id)))
          .then(() =>
            toast({
              title: '삭제됨',
              description: `${persistedToDelete.length}개의 로컬 카드가 삭제되었습니다.`,
            })
          )
          .catch((error) =>
            toast({
              title: '삭제 실패',
              description:
                error instanceof Error ? error.message : '일부 카드를 삭제하지 못했습니다.',
              variant: 'destructive',
            })
          );
      }

      // Remove pending cards from local state
      if (pendingToDelete.length > 0) {
        setPendingLocalCards((prev) => prev.filter((c) => !pendingToDelete.includes(c.id)));
        toast({
          title: '삭제됨',
          description: `${pendingToDelete.length}개의 카드가 삭제되었습니다.`,
        });
      }
    },
    [syncedCards, persistedLocalCards, updateVideoState, deleteLocalCard, toast]
  );

  // Get cards for selected cell or all cards in current level (including sub-levels)
  const currentLevelCards = allMandalaCards.filter((card) => {
    if (card.levelId === currentLevelId) return true;
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

  // Get the current card data from RQ-derived arrays (not stale selectedCard snapshot)
  const currentModalCard = useMemo(() => {
    if (!selectedCard?.id) return null;
    const foundCard =
      allMandalaCards.find((c) => c.id === selectedCard.id) ||
      scratchPadCards.find((c) => c.id === selectedCard.id);
    return foundCard ?? selectedCard;
  }, [selectedCard?.id, selectedCard?.userNote, allMandalaCards, scratchPadCards]);

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
