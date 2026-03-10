import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { InsightCard, LinkType } from '@/entities/card/model/types';
import { useAuth } from '@/features/auth/model/useAuth';
import { useLocalCards, isLimitExceededError, localCardsKeys } from '@/features/card-management/model/useLocalCards';
import { useBatchMoveCards } from '@/features/card-management/model/useBatchMoveCards';
import { useAllVideoStates, useUpdateVideoState } from '@/features/youtube-sync/model/useYouTubeSync';
import { convertToInsightCards } from '@/features/card-management/lib/youtubeToInsightCard';
import { detectCardSource, getCardById } from '@/features/card-management/lib/cardUtils';
import {
  createMockCards,
  createCardFromUrl,
  isValidUrl,
  fetchLinkTitle,
  detectLinkType,
  extractYouTubePlaylistId,
  fetchUrlMetadata,
} from '@/shared/data/mockData';
import { uploadFile, detectFileType, isSupportedFileType } from '@/shared/lib/fileUpload';
import { getAuthHeaders, getEdgeFunctionUrl } from '@/shared/lib/supabase-auth';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/shared/lib/use-toast';

interface UseCardOrchestratorDeps {
  currentLevelId: string;
  currentLevel: { subjects: string[]; centerGoal: string };
}

export interface UseCardOrchestratorReturn {
  // Data
  demoCards: InsightCard[];
  scratchPadCards: InsightCard[];
  allMandalaCards: InsightCard[];
  cardsByCell: Record<number, InsightCard[]>;
  totalCards: number;
  displayCards: InsightCard[];
  displayTitle: string;
  // Derived arrays (needed by external hooks)
  syncedCards: InsightCard[];
  persistedLocalCards: InsightCard[];
  pendingLocalCards: InsightCard[];
  // Card actions
  handleCardClick: (card: InsightCard) => void;
  handleCardDrop: (
    cellIndex: number,
    url?: string,
    cardId?: string,
    multiCardIds?: string[],
    files?: FileList,
  ) => void;
  handleScratchPadDrop: (url: string) => void;
  handleScratchPadCardDrop: (cardId: string) => void;
  handleScratchPadMultiCardDrop: (cardIds: string[]) => void;
  handleScratchPadFileDrop: (files: FileList) => void;
  handleSaveNote: (id: string, note: string) => Promise<void>;
  handleSaveWatchPosition: (id: string, positionSeconds: number) => void;
  handleCardsReorder: (reorderedCards: InsightCard[]) => void;
  handleDeleteCards: (cardIds: string[]) => void;
  // Pending card management (exposed for useGlobalPaste)
  addPendingCard: (card: InsightCard) => void;
  removePendingCard: (id: string) => void;
  // Card move helpers (exposed for navigation hooks)
  moveCardsForSubLevel: (
    fromLevelId: string,
    toLevelId: string,
    parentCellIndex: number,
  ) => void;
  swapCardsForReorder: (
    swappedIndices: { from: number; to: number },
    levelId: string,
  ) => void;
  // Internal callback ref for modal
  onCardClick: (card: InsightCard) => void;
}

/**
 * Orchestrates all card data: YouTube synced cards, local Supabase cards,
 * and optimistic pending cards. Provides merged views and all card
 * manipulation handlers.
 */
export function useCardOrchestrator(
  { currentLevelId, currentLevel }: UseCardOrchestratorDeps,
  selectedCellIndex: number | null,
  onCardClickExternal?: (card: InsightCard) => void,
): UseCardOrchestratorReturn {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { isLoggedIn } = useAuth();
  const queryClient = useQueryClient();

  // YouTube sync
  const { data: allVideoStates } = useAllVideoStates();
  const updateVideoState = useUpdateVideoState();

  // Local cards
  const {
    cards: persistedLocalCards,
    subscription,
    addCard: addLocalCard,
    updateCard: updateLocalCard,
    deleteCard: deleteLocalCard,
    canAddCard,
  } = useLocalCards();

  // Batch move
  const batchMoveCards = useBatchMoveCards();

  // Convert video states to InsightCards
  const syncedCards = useMemo(() => {
    if (!allVideoStates) return [];
    return convertToInsightCards(allVideoStates);
  }, [allVideoStates]);

  // Demo cards for non-logged-in users
  const [demoCards] = useState<InsightCard[]>(() => (isLoggedIn ? [] : createMockCards()));
  // Pending cards for optimistic UI
  const [pendingLocalCards, setPendingLocalCards] = useState<InsightCard[]>([]);

  // ---- Card classification ----

  const mandalaLocalCards = useMemo(
    () =>
      persistedLocalCards.filter(
        (c) =>
          typeof c.cellIndex === 'number' &&
          c.cellIndex >= 0 &&
          c.levelId &&
          c.levelId !== 'scratchpad',
      ),
    [persistedLocalCards],
  );

  const scratchpadLocalCards = useMemo(
    () =>
      persistedLocalCards.filter(
        (c) =>
          typeof c.cellIndex !== 'number' ||
          c.cellIndex < 0 ||
          !c.levelId ||
          c.levelId === 'scratchpad',
      ),
    [persistedLocalCards],
  );

  const mandalaVideoCards = useMemo(
    () =>
      syncedCards.filter(
        (c) =>
          c.isInIdeation === false &&
          typeof c.cellIndex === 'number' &&
          c.cellIndex >= 0 &&
          c.levelId &&
          c.levelId !== 'scratchpad',
      ),
    [syncedCards],
  );

  const ideationVideoCards = useMemo(
    () => syncedCards.filter((c) => c.isInIdeation === true),
    [syncedCards],
  );

  // Merged scratchpad
  const scratchPadCards = useMemo(() => {
    const persistedUrls = new Set(persistedLocalCards.map((c) => c.videoUrl));
    const filteredPending = pendingLocalCards.filter((c) => !persistedUrls.has(c.videoUrl));
    return [...ideationVideoCards, ...scratchpadLocalCards, ...filteredPending];
  }, [ideationVideoCards, scratchpadLocalCards, pendingLocalCards, persistedLocalCards]);

  const pendingMandalaCards = useMemo(
    () =>
      pendingLocalCards.filter(
        (c) =>
          typeof c.cellIndex === 'number' &&
          c.cellIndex >= 0 &&
          c.levelId &&
          c.levelId !== 'scratchpad',
      ),
    [pendingLocalCards],
  );

  // All mandala cards
  const allMandalaCards = useMemo(() => {
    if (!isLoggedIn) return demoCards;
    return [...mandalaLocalCards, ...mandalaVideoCards, ...pendingMandalaCards];
  }, [isLoggedIn, demoCards, mandalaLocalCards, mandalaVideoCards, pendingMandalaCards]);

  // Cards grouped by cell index
  const cardsByCell = useMemo(() => {
    return allMandalaCards.reduce(
      (acc, card) => {
        if (card.levelId === currentLevelId && card.cellIndex >= 0) {
          if (!acc[card.cellIndex]) acc[card.cellIndex] = [];
          acc[card.cellIndex].push(card);
        } else {
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
      {} as Record<number, InsightCard[]>,
    );
  }, [allMandalaCards, currentLevelId, currentLevel.subjects]);

  const totalCards = useMemo(
    () => Object.values(cardsByCell).reduce((sum, cellCards) => sum + cellCards.length, 0),
    [cardsByCell],
  );

  // Display cards for selected cell or all
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

  // ---- Handlers ----

  const handleCardClick = useCallback(
    (card: InsightCard) => {
      onCardClickExternal?.(card);
    },
    [onCardClickExternal],
  );

  // File upload helper
  const handleFileUpload = useCallback(
    async (file: File, cellIndex: number, levelId: string): Promise<InsightCard | null> => {
      if (!isSupportedFileType(file.name)) {
        toast({
          title: t('index.unsupportedFileType'),
          description: t('index.unsupportedFileTypeDesc'),
          variant: 'destructive',
        });
        return null;
      }
      toast({ title: t('index.uploadingFile'), description: file.name });

      const result = await uploadFile(file);
      if (!result) {
        toast({
          title: t('index.uploadFailed'),
          description: t('index.uploadFailedDesc'),
          variant: 'destructive',
        });
        return null;
      }

      const linkType = detectFileType(file.name);
      return {
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
    },
    [toast, t],
  );

  // File drop for cells
  const handleFileDrop = useCallback(
    async (cellIndex: number, files: FileList) => {
      for (const file of Array.from(files)) {
        const newCard = await handleFileUpload(file, cellIndex, currentLevelId);
        if (newCard) {
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
            title: t('index.fileAdded'),
            description: t('index.fileAddedToCell', { subject: currentLevel.subjects[cellIndex] }),
          });
        }
      }
    },
    [handleFileUpload, currentLevelId, currentLevel.subjects, toast, addLocalCard, t],
  );

  // File drop for scratchpad
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
          toast({ title: t('index.fileAddedToIdeation'), description: file.name });
        }
      }
    },
    [handleFileUpload, toast, addLocalCard, t],
  );

  // URL card creation helper (shared logic)
  const persistUrlCard = useCallback(
    async (
      url: string,
      linkType: LinkType,
      tempCard: InsightCard,
      cellIndex: number,
      levelId: string,
    ) => {
      let title = tempCard.title;
      let metadata = tempCard.metadata;

      try {
        title = await fetchLinkTitle(url, linkType);
      } catch {
        /* non-critical */
      }
      if (linkType !== 'youtube' && linkType !== 'youtube-shorts') {
        try {
          const fetched = await fetchUrlMetadata(url);
          if (fetched) {
            title = fetched.title || title;
            metadata = fetched;
          }
        } catch {
          /* non-critical */
        }
      }

      try {
        await addLocalCard({
          url,
          title,
          thumbnail: metadata?.image || tempCard.thumbnail,
          link_type: linkType,
          user_note: '',
          metadata_title: metadata?.title,
          metadata_description: metadata?.description,
          metadata_image: metadata?.image,
          cell_index: cellIndex,
          level_id: levelId,
        });
        setPendingLocalCards((prev) => prev.filter((c) => c.id !== tempCard.id));
      } catch (error) {
        setPendingLocalCards((prev) => prev.filter((c) => c.id !== tempCard.id));
        if (isLimitExceededError(error)) {
          toast({
            title: t('index.storageLimitExceeded'),
            description: t('index.storageLimitDesc', {
              tier: error.tier ?? 'free',
              limit: error.limit,
            }),
            variant: 'destructive',
          });
        } else {
          toast({
            title: t('common.saveFailed'),
            description: error instanceof Error ? error.message : t('index.saveFailedDesc'),
            variant: 'destructive',
          });
        }
      }
    },
    [addLocalCard, toast, t],
  );

  // Playlist drop handler
  const handlePlaylistDrop = useCallback(
    async (url: string, cellIndex: number, levelId: string) => {
      const playlistId = extractYouTubePlaylistId(url);
      if (!playlistId) {
        toast({
          title: t('index.invalidUrl'),
          description: t('index.invalidUrlDesc'),
          variant: 'destructive',
        });
        return;
      }

      toast({ title: t('playlist.importing') });

      try {
        const headers = await getAuthHeaders();
        const edgeUrl = getEdgeFunctionUrl('local-cards', 'import-playlist');
        const response = await fetch(edgeUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({ playlistUrl: url, cellIndex, levelId }),
        });

        const data = await response.json();

        if (!response.ok) {
          if (data.error === 'PRIVATE_PLAYLIST_NO_AUTH') {
            toast({
              title: t('playlist.privateNoAuth'),
              variant: 'destructive',
            });
          } else if (data.error === 'PRIVATE_PLAYLIST_NOT_OWNER') {
            toast({
              title: t('playlist.privateNotOwner'),
              variant: 'destructive',
            });
          } else if (data.error === 'LIMIT_EXCEEDED') {
            toast({
              title: t('index.storageLimitExceeded'),
              description: t('playlist.limitExceeded', {
                used: data.used,
                limit: data.limit,
                available: Math.max(0, data.limit - data.used),
              }),
              variant: 'destructive',
            });
          } else if (data.error === 'ALREADY_REGISTERED') {
            toast({
              title: t('playlist.alreadyRegistered'),
              variant: 'destructive',
            });
          } else {
            toast({
              title: t('common.error'),
              description: data.error || data.message,
              variant: 'destructive',
            });
          }
          return;
        }

        // Success
        const count = data.cardsCreated || 0;
        toast({
          title: t('playlist.imported', { count }),
        });

        // Invalidate local cards query to refresh UI
        queryClient.invalidateQueries({ queryKey: localCardsKeys.all });
      } catch (error) {
        toast({
          title: t('common.error'),
          description: error instanceof Error ? error.message : t('index.saveFailedDesc'),
          variant: 'destructive',
        });
      }
    },
    [toast, t, queryClient],
  );

  // Card drop on mandala cell
  const handleCardDrop = useCallback(
    (
      cellIndex: number,
      url?: string,
      cardId?: string,
      multiCardIds?: string[],
      files?: FileList,
    ) => {
      // File drops
      if (files && files.length > 0) {
        handleFileDrop(cellIndex, files);
        return;
      }

      // Multi-card drop
      if (multiCardIds && multiCardIds.length > 0) {
        const pendingIds = multiCardIds.filter((id) => {
          const c = getCardById(id, syncedCards, persistedLocalCards, pendingLocalCards);
          return detectCardSource(id, syncedCards, persistedLocalCards, c) === 'pending';
        });
        if (pendingIds.length > 0 && !canAddCard) {
          toast({
            title: t('index.storageLimitExceeded'),
            description: t('index.storageLimitMaxDesc', { limit: subscription.limit }),
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

        setPendingLocalCards((prev) => prev.filter((c) => !multiCardIds.includes(c.id)));

        batchMoveCards.mutate(
          { items: batchItems },
          {
            onSuccess: () => {
              toast({
                title: t('index.multiCardMoved', { count: multiCardIds.length }),
                description: t('index.movedToCell', {
                  subject: currentLevel.subjects[cellIndex],
                }),
              });
            },
            onError: (error) => {
              toast({
                title: t('index.moveFailed'),
                description: error instanceof Error ? error.message : t('index.moveFailedDesc'),
                variant: 'destructive',
              });
            },
          },
        );
        return;
      }

      // Single card drop
      if (cardId) {
        const card = getCardById(cardId, syncedCards, persistedLocalCards, pendingLocalCards);
        if (!card) return;
        const source = detectCardSource(cardId, syncedCards, persistedLocalCards, card);

        if (source === 'pending' && !canAddCard) {
          toast({
            title: t('index.storageLimitExceeded'),
            description: t('index.storageLimitMaxDesc', { limit: subscription.limit }),
            variant: 'destructive',
          });
          return;
        }

        if (source === 'pending') {
          setPendingLocalCards((prev) => prev.filter((c) => c.id !== cardId));
        }

        const onSuccess = () => {
          toast({
            title: t('index.cardMoved'),
            description: t('index.movedToCell', { subject: currentLevel.subjects[cellIndex] }),
          });
        };
        const onError = (error: unknown) => {
          toast({
            title: t('index.moveFailed'),
            description: error instanceof Error ? error.message : t('index.moveFailedDesc'),
            variant: 'destructive',
          });
        };

        if (source === 'synced') {
          updateVideoState.mutate(
            {
              videoStateId: cardId,
              updates: { is_in_ideation: false, cell_index: cellIndex, level_id: currentLevelId },
            },
            { onSuccess, onError },
          );
        } else if (source === 'local') {
          updateLocalCard({ id: cardId, cell_index: cellIndex, level_id: currentLevelId })
            .then(onSuccess)
            .catch(onError);
        } else {
          addLocalCard({
            url: card.videoUrl,
            title: card.title,
            thumbnail: card.thumbnail,
            link_type: card.linkType || 'other',
            user_note: card.userNote,
            cell_index: cellIndex,
            level_id: currentLevelId,
          })
            .then(onSuccess)
            .catch(onError);
        }
        return;
      }

      // URL drop (new card)
      if (url) {
        if (!isLoggedIn) {
          toast({
            title: t('index.loginRequired'),
            description: t('index.loginRequiredAddMandala'),
            variant: 'destructive',
          });
          navigate('/login');
          return;
        }

        if (isValidUrl(url)) {
          const linkType = detectLinkType(url);

          // Playlist → delegate to handlePlaylistDrop
          if (linkType === 'youtube-playlist') {
            handlePlaylistDrop(url, cellIndex, currentLevelId);
            return;
          }

          const newCard = createCardFromUrl(url, cellIndex, currentLevelId);
          setPendingLocalCards((prev) => [...prev, newCard]);
          toast({
            title: t('index.insightAdded'),
            description: t('index.insightAddedToCell', {
              subject: currentLevel.subjects[cellIndex],
            }),
          });
          persistUrlCard(url, linkType, newCard, cellIndex, currentLevelId);
        } else {
          toast({
            title: t('index.invalidUrl'),
            description: t('index.invalidUrlDesc'),
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
      t,
      persistUrlCard,
      handlePlaylistDrop,
    ],
  );

  // ScratchPad URL drop
  const handleScratchPadDrop = useCallback(
    (url: string) => {
      if (!isLoggedIn) {
        toast({
          title: t('index.loginRequired'),
          description: t('index.loginRequiredAddIdeation'),
          variant: 'destructive',
        });
        navigate('/login');
        return;
      }

      if (isValidUrl(url)) {
        const linkType = detectLinkType(url);

        // Playlist → delegate to handlePlaylistDrop (scratchpad = cellIndex -1)
        if (linkType === 'youtube-playlist') {
          handlePlaylistDrop(url, -1, 'scratchpad');
          return;
        }
        if (linkType === 'other') {
          toast({
            title: t('index.unsupportedLink'),
            description: t('index.invalidUrlLinkDesc'),
            variant: 'destructive',
          });
          return;
        }
        if (!canAddCard) {
          toast({
            title: t('index.storageLimitExceeded'),
            description: t('index.storageLimitDesc', {
              tier: subscription.tier === 'free' ? t('index.tierFree') : subscription.tier,
              limit: subscription.limit,
            }),
            variant: 'destructive',
          });
          return;
        }

        const newCard = createCardFromUrl(url, -1, 'scratchpad');
        setPendingLocalCards((prev) => [...prev, newCard]);
        toast({ title: t('index.addedToIdeation'), description: t('index.addedToIdeationMoveDesc') });
        persistUrlCard(url, linkType, newCard, -1, 'scratchpad');
      } else {
        toast({
          title: t('index.invalidUrl'),
          description: t('index.invalidUrlLinkDesc'),
          variant: 'destructive',
        });
      }
    },
    [isLoggedIn, navigate, toast, canAddCard, subscription, t, persistUrlCard, handlePlaylistDrop],
  );

  // Move card from mandala back to scratchpad
  const handleScratchPadCardDrop = useCallback(
    (cardId: string) => {
      const card = allMandalaCards.find((c) => c.id === cardId);
      if (!card) return;
      const source = detectCardSource(cardId, syncedCards, persistedLocalCards, card);

      const onSuccess = () => {
        toast({ title: t('index.movedToIdeation'), description: t('index.movedToIdeationDesc') });
      };
      const onError = (error: unknown) => {
        toast({
          title: t('index.moveFailed'),
          description: error instanceof Error ? error.message : t('index.moveFailedDesc'),
          variant: 'destructive',
        });
      };

      if (source === 'synced') {
        updateVideoState.mutate(
          {
            videoStateId: cardId,
            updates: { is_in_ideation: true, cell_index: -1, level_id: 'scratchpad' },
          },
          { onSuccess, onError },
        );
      } else {
        updateLocalCard({ id: cardId, cell_index: -1, level_id: 'scratchpad' })
          .then(onSuccess)
          .catch(onError);
      }
    },
    [allMandalaCards, syncedCards, persistedLocalCards, updateVideoState, updateLocalCard, toast, t],
  );

  // Multi-card drop to scratchpad
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
              title: t('index.multiCardMoved', { count: batchItems.length }),
              description: t('index.multiCardMovedToIdeation'),
            });
          },
          onError: (error) => {
            toast({
              title: t('index.moveFailed'),
              description: error instanceof Error ? error.message : t('index.moveFailedDesc'),
              variant: 'destructive',
            });
          },
        },
      );
    },
    [allMandalaCards, syncedCards, persistedLocalCards, batchMoveCards, toast, t],
  );

  // Save note
  const handleSaveNote = useCallback(
    async (id: string, note: string) => {
      const source = detectCardSource(id, syncedCards, persistedLocalCards);
      try {
        switch (source) {
          case 'synced':
            await updateVideoState.mutateAsync({
              videoStateId: id,
              updates: { user_note: note },
            });
            toast({ title: t('index.memoSaved'), description: t('index.memoSavedYouTube') });
            break;
          case 'local':
            await updateLocalCard({ id, user_note: note });
            toast({ title: t('index.memoSaved'), description: t('index.memoSavedLocal') });
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
              toast({ title: t('index.cardSaved'), description: t('index.cardSavedDesc') });
            } else {
              toast({
                title: t('common.saveFailed'),
                description: t('index.saveFailedCardNotFound'),
                variant: 'destructive',
              });
            }
            break;
          }
        }
      } catch (error) {
        toast({
          title: t('common.saveFailed'),
          description: error instanceof Error ? error.message : t('index.memoSaveFailed'),
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
      t,
    ],
  );

  // Save watch position
  const handleSaveWatchPosition = useCallback(
    (id: string, positionSeconds: number) => {
      const isSyncedVideo = syncedCards.some((c) => c.id === id);
      if (isSyncedVideo) {
        updateVideoState.mutate(
          { videoStateId: id, updates: { watch_position_seconds: positionSeconds } },
          { onError: (error) => console.error('Failed to save watch position:', error) },
        );
      }
    },
    [syncedCards, updateVideoState],
  );

  // Reorder cards
  const handleCardsReorder = useCallback(
    (reorderedCards: InsightCard[]) => {
      const batchItems = reorderedCards.map((card) => ({
        card,
        source: detectCardSource(card.id, syncedCards, persistedLocalCards, card),
        cellIndex: card.cellIndex,
        levelId: card.levelId,
      }));
      if (batchItems.length > 0) {
        batchMoveCards.mutate({ items: batchItems });
      }
      toast({ title: t('index.orderChanged'), description: t('index.orderChangedDesc') });
    },
    [toast, syncedCards, persistedLocalCards, batchMoveCards, t],
  );

  // Delete cards
  const handleDeleteCards = useCallback(
    (cardIds: string[]) => {
      const syncedIds = new Set(syncedCards.map((c) => c.id));
      const persistedIds = new Set(persistedLocalCards.map((c) => c.id));

      const syncedToDelete = cardIds.filter((id) => syncedIds.has(id));
      const persistedToDelete = cardIds.filter((id) => persistedIds.has(id));
      const pendingToDelete = cardIds.filter(
        (id) => !syncedIds.has(id) && !persistedIds.has(id),
      );

      if (syncedToDelete.length > 0) {
        Promise.all(
          syncedToDelete.map((id) => {
            const card = syncedCards.find((c) => c.id === id);
            const isInMandala =
              card &&
              !card.isInIdeation &&
              typeof card.cellIndex === 'number' &&
              card.cellIndex >= 0;
            return updateVideoState.mutateAsync({
              videoStateId: id,
              updates: isInMandala
                ? { cell_index: -1, level_id: '', is_in_ideation: false }
                : { is_in_ideation: false },
            });
          }),
        )
          .then(() =>
            toast({
              title: t('index.deleted'),
              description: t('index.deletedVideoDesc', { count: syncedToDelete.length }),
            }),
          )
          .catch((error) =>
            toast({
              title: t('index.deleteFailed'),
              description:
                error instanceof Error ? error.message : t('index.deleteFailedVideoDesc'),
              variant: 'destructive',
            }),
          );
      }

      if (persistedToDelete.length > 0) {
        Promise.all(persistedToDelete.map((id) => deleteLocalCard(id)))
          .then(() =>
            toast({
              title: t('index.deleted'),
              description: t('index.deletedLocalDesc', { count: persistedToDelete.length }),
            }),
          )
          .catch((error) =>
            toast({
              title: t('index.deleteFailed'),
              description:
                error instanceof Error ? error.message : t('index.deleteFailedLocalDesc'),
              variant: 'destructive',
            }),
          );
      }

      if (pendingToDelete.length > 0) {
        setPendingLocalCards((prev) => prev.filter((c) => !pendingToDelete.includes(c.id)));
        toast({
          title: t('index.deleted'),
          description: t('index.deletedCardDesc', { count: pendingToDelete.length }),
        });
      }
    },
    [syncedCards, persistedLocalCards, updateVideoState, deleteLocalCard, toast, t],
  );

  // Exposed for navigation sub-level card migration
  const moveCardsForSubLevel = useCallback(
    (fromLevelId: string, toLevelId: string, parentCellIndex: number) => {
      const cardsToMigrate = allMandalaCards.filter(
        (c) => c.levelId === fromLevelId && c.cellIndex === parentCellIndex,
      );
      if (cardsToMigrate.length > 0) {
        const batchItems = cardsToMigrate.map((card) => ({
          card,
          source: detectCardSource(card.id, syncedCards, persistedLocalCards, card),
          cellIndex: 0,
          levelId: toLevelId,
        }));
        batchMoveCards.mutate({ items: batchItems });
      }
    },
    [allMandalaCards, syncedCards, persistedLocalCards, batchMoveCards],
  );

  // Exposed for reorder card swapping
  const swapCardsForReorder = useCallback(
    (swappedIndices: { from: number; to: number }, levelId: string) => {
      const affectedCards = allMandalaCards.filter(
        (c) =>
          c.levelId === levelId &&
          (c.cellIndex === swappedIndices.from || c.cellIndex === swappedIndices.to),
      );
      if (affectedCards.length > 0) {
        const batchItems = affectedCards.map((card) => ({
          card,
          source: detectCardSource(card.id, syncedCards, persistedLocalCards, card),
          cellIndex:
            card.cellIndex === swappedIndices.from ? swappedIndices.to : swappedIndices.from,
          levelId,
        }));
        batchMoveCards.mutate({ items: batchItems });
      }
    },
    [allMandalaCards, syncedCards, persistedLocalCards, batchMoveCards],
  );

  return {
    demoCards,
    scratchPadCards,
    allMandalaCards,
    cardsByCell,
    totalCards,
    displayCards,
    displayTitle,
    syncedCards,
    persistedLocalCards,
    pendingLocalCards,
    addPendingCard: (card: InsightCard) => setPendingLocalCards(prev => [...prev, card]),
    removePendingCard: (id: string) => setPendingLocalCards(prev => prev.filter(c => c.id !== id)),
    handleCardClick,
    handleCardDrop,
    handleScratchPadDrop,
    handleScratchPadCardDrop,
    handleScratchPadMultiCardDrop,
    handleScratchPadFileDrop,
    handleSaveNote,
    handleSaveWatchPosition,
    handleCardsReorder,
    handleDeleteCards,
    moveCardsForSubLevel,
    swapCardsForReorder,
    onCardClick: handleCardClick,
  };
}
