import { useState, useMemo, useCallback, useRef } from 'react';
import type { InsightCard } from '@/entities/card/model/types';

interface UseVideoModalReturn {
  selectedCard: InsightCard | null;
  isModalOpen: boolean;
  currentModalCard: InsightCard | null;
  openModal: (card: InsightCard) => void;
  closeModal: () => void;
  /** Session-level watch position cache (survives modal close/reopen) */
  watchPositionCache: Map<string, number>;
  /** Session-level panel size cache (survives modal close/reopen) */
  panelSizeCache: Map<string, number>;
}

/**
 * Manages video player modal state.
 * Derives currentModalCard from live RQ-derived arrays to avoid stale data.
 * Maintains a session-level watch position cache so reopening a video
 * resumes from where the user left off (even for local cards without DB persistence).
 */
export function useVideoModal(
  allMandalaCards: InsightCard[],
  scratchPadCards: InsightCard[]
): UseVideoModalReturn {
  const [selectedCard, setSelectedCard] = useState<InsightCard | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Session-level watch position cache — persists across modal open/close within a session
  const watchPositionCacheRef = useRef(new Map<string, number>());
  // Session-level panel size cache — persists across modal open/close within a session
  const panelSizeCacheRef = useRef(new Map<string, number>());

  const openModal = useCallback((card: InsightCard) => {
    setSelectedCard(card);
    setIsModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  // Get the current card data from RQ-derived arrays (not stale selectedCard snapshot)
  const currentModalCard = useMemo(() => {
    if (!selectedCard?.id) return null;
    const foundCard =
      allMandalaCards.find((c) => c.id === selectedCard.id) ||
      scratchPadCards.find((c) => c.id === selectedCard.id);
    return foundCard ?? selectedCard;
  }, [selectedCard?.id, selectedCard?.userNote, allMandalaCards, scratchPadCards]);

  return {
    selectedCard,
    isModalOpen,
    currentModalCard,
    openModal,
    closeModal,
    watchPositionCache: watchPositionCacheRef.current,
    panelSizeCache: panelSizeCacheRef.current,
  };
}
