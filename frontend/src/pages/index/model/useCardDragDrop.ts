import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { InsightCard } from '@/entities/card/model/types';
import { useAuth } from '@/features/auth/model/useAuth';
import {
  useLocalCards,
  isLimitExceededError,
} from '@/features/card-management/model/useLocalCards';
import {
  createCardFromUrl,
  fetchLinkTitle,
  detectLinkType,
  fetchUrlMetadata,
} from '@/shared/data/mockData';
import { normalizeUrl } from '@/shared/lib/url-normalize';
import { useToast } from '@/shared/lib/use-toast';

interface UseCardDragDropDeps {
  draggingCard: InsightCard | null;
}

export interface UseCardDragDropReturn {
  isDraggingOver: boolean;
  draggingCard: InsightCard | null;
  isDraggingCell: boolean;
  isScratchPadDropTarget: boolean;
  // Setters exposed for child components
  setIsDraggingOver: (v: boolean) => void;
  setDraggingCard: (card: InsightCard | null) => void;
  setIsDraggingCell: (v: boolean) => void;
  setIsScratchPadDropTarget: (v: boolean) => void;
  // Handlers
  handleCardDragStart: (card: InsightCard) => void;
  handleMultiCardDragStart: (cards: InsightCard[]) => void;
}

/**
 * Manages global drag & drop state, including:
 * - Global drag enter/leave/over/drop events (for overlay)
 * - Global paste handler for adding URLs to scratchpad
 * - Drag state for cards being dragged between mandala cells and scratchpad
 */
export function useCardDragDrop(): UseCardDragDropReturn {
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isScratchPadDropTarget, setIsScratchPadDropTarget] = useState(false);
  const [draggingCard, setDraggingCard] = useState<InsightCard | null>(null);
  const [isDraggingCell, setIsDraggingCell] = useState(false);

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

  const handleCardDragStart = useCallback((card: InsightCard) => {
    setDraggingCard(card);
  }, []);

  const handleMultiCardDragStart = useCallback((cards: InsightCard[]) => {
    if (cards.length > 0) {
      setDraggingCard(cards[0]);
    }
  }, []);

  return {
    isDraggingOver,
    draggingCard,
    isDraggingCell,
    isScratchPadDropTarget,
    setIsDraggingOver,
    setDraggingCard,
    setIsDraggingCell,
    setIsScratchPadDropTarget,
    handleCardDragStart,
    handleMultiCardDragStart,
  };
}

/**
 * Global paste handler for adding URLs to scratchpad (Ideation).
 * Separated from drag/drop to avoid bloating the drag hook.
 */
export function useGlobalPaste(deps: {
  addPendingCard: (card: InsightCard) => void;
  removePendingCard: (id: string) => void;
  persistedLocalCards: InsightCard[];
  pendingLocalCards: InsightCard[];
}) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { isLoggedIn } = useAuth();
  const { subscription, addCard: addLocalCard, canAddCard } = useLocalCards();

  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      const text = e.clipboardData?.getData('text');
      if (!text) return;

      try {
        new URL(text);
      } catch {
        return;
      }

      e.preventDefault();

      if (!isLoggedIn) {
        toast({
          title: t('index.loginRequired'),
          description: t('index.loginRequiredAddIdeation'),
          variant: 'destructive',
        });
        navigate('/login');
        return;
      }

      const linkType = detectLinkType(text);
      if (linkType === 'other') {
        toast({
          title: t('index.unsupportedLink'),
          description: t('index.unsupportedLinkDesc'),
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

      // Duplicate check
      const normalized = normalizeUrl(text);
      const isDuplicate =
        deps.persistedLocalCards.some((c) => normalizeUrl(c.videoUrl) === normalized) ||
        deps.pendingLocalCards.some((c) => normalizeUrl(c.videoUrl) === normalized);
      if (isDuplicate) {
        toast({
          title: t('index.duplicateCard'),
          description: t('index.duplicateCardDesc'),
        });
        return;
      }

      const newCard = createCardFromUrl(text, -1, 'scratchpad');
      deps.addPendingCard(newCard);

      toast({
        title: t('index.addedToIdeation'),
        description: t('index.addedToIdeationLinkDesc', {
          linkType:
            linkType === 'facebook'
              ? 'Facebook'
              : linkType === 'youtube' || linkType === 'youtube-shorts'
                ? 'YouTube'
                : linkType === 'linkedin'
                  ? 'LinkedIn'
                  : 'Notion',
        }),
      });

      // Fetch metadata and persist
      let title = newCard.title;
      let metadata = newCard.metadata;
      try {
        title = await fetchLinkTitle(text, linkType);
      } catch {
        /* non-critical */
      }
      if (linkType !== 'youtube' && linkType !== 'youtube-shorts') {
        try {
          const fetched = await fetchUrlMetadata(text);
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
          url: normalized,
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
        deps.removePendingCard(newCard.id);
      } catch (error) {
        deps.removePendingCard(newCard.id);
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
            title: t('index.saveFailed'),
            description: error instanceof Error ? error.message : t('index.saveFailedDesc'),
            variant: 'destructive',
          });
        }
      }
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [toast, isLoggedIn, navigate, canAddCard, subscription, addLocalCard, t, deps.addPendingCard, deps.removePendingCard, deps.persistedLocalCards, deps.pendingLocalCards]);

  // No return value -- side-effect only
}
