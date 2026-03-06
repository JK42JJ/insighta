import { useState, useMemo, useCallback } from 'react';
import type { InsightCard } from '@/entities/card/model/types';

interface UseVideoModalReturn {
  selectedCard: InsightCard | null;
  isModalOpen: boolean;
  currentModalCard: InsightCard | null;
  openModal: (card: InsightCard) => void;
  closeModal: () => void;
}

/**
 * Manages video player modal state.
 * Derives currentModalCard from live RQ-derived arrays to avoid stale data.
 */
export function useVideoModal(
  allMandalaCards: InsightCard[],
  scratchPadCards: InsightCard[],
): UseVideoModalReturn {
  const [selectedCard, setSelectedCard] = useState<InsightCard | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

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
  };
}
