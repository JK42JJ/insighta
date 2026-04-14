import { useState, useMemo, useCallback, useRef } from 'react';
import type { InsightCard } from '@/entities/card/model/types';

/** Default video panel ratio (%) — video:memo = 73:27 ≈ 16:9 fit + memo 5 rows */
export const DEFAULT_VIDEO_PANEL_RATIO = 73;
/** Default detail panel ratio (%) — content:memo = 75:25 */
export const DEFAULT_DETAIL_PANEL_RATIO = 75;

interface UseVideoModalReturn {
  selectedCard: InsightCard | null;
  isModalOpen: boolean;
  currentModalCard: InsightCard | null;
  /** Open modal with optional sibling list for prev/next navigation */
  openModal: (card: InsightCard, siblingCards?: InsightCard[]) => void;
  closeModal: () => void;
  /** Navigate to previous card in sibling list (no-op if at start or no list) */
  goPrev: () => void;
  /** Navigate to next card in sibling list (no-op if at end or no list) */
  goNext: () => void;
  /** True if there is a previous card in the current sibling list */
  hasPrev: boolean;
  /** True if there is a next card in the current sibling list */
  hasNext: boolean;
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
  // Sibling cards list for prev/next navigation (set when openModal is called with a list)
  const [siblingCards, setSiblingCards] = useState<InsightCard[]>([]);

  // Session-level watch position cache — persists across modal open/close within a session
  const watchPositionCacheRef = useRef(new Map<string, number>());
  // Session-level panel size cache — persists across modal open/close within a session
  const panelSizeCacheRef = useRef(new Map<string, number>());

  const openModal = useCallback((card: InsightCard, list?: InsightCard[]) => {
    setSelectedCard(card);
    setSiblingCards(list ?? []);
    setIsModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  // Find current index in sibling list
  const currentIndex = useMemo(() => {
    if (!selectedCard?.id || siblingCards.length === 0) return -1;
    return siblingCards.findIndex((c) => c.id === selectedCard.id);
  }, [selectedCard?.id, siblingCards]);

  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < siblingCards.length - 1;

  const goPrev = useCallback(() => {
    if (currentIndex > 0) {
      const prev = siblingCards[currentIndex - 1];
      if (prev) setSelectedCard(prev);
    }
  }, [currentIndex, siblingCards]);

  const goNext = useCallback(() => {
    if (currentIndex >= 0 && currentIndex < siblingCards.length - 1) {
      const next = siblingCards[currentIndex + 1];
      if (next) setSelectedCard(next);
    }
  }, [currentIndex, siblingCards]);

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
    goPrev,
    goNext,
    hasPrev,
    hasNext,
    watchPositionCache: watchPositionCacheRef.current,
    panelSizeCache: panelSizeCacheRef.current,
  };
}
