/**
 * Card Utilities
 *
 * Helper functions for card source detection and unified card movement logic.
 */

import type { InsightCard } from '@/types/mandala';

export type CardSource = 'synced' | 'local' | 'pending';

/**
 * Detect the source of a card by checking its presence in different card arrays
 *
 * @param cardId - The card ID to detect
 * @param syncedCards - YouTube synced cards (from video_states table)
 * @param persistedLocalCards - Persisted local cards (from local_cards table)
 * @returns The source type: 'synced', 'local', or 'pending'
 */
export function detectCardSource(
  cardId: string,
  syncedCards: InsightCard[],
  persistedLocalCards: InsightCard[]
): CardSource {
  // Check YouTube synced cards first (highest priority)
  if (syncedCards.some(c => c.id === cardId)) {
    return 'synced';
  }

  // Check persisted local cards
  if (persistedLocalCards.some(c => c.id === cardId)) {
    return 'local';
  }

  // If not found in either, it's a pending card
  return 'pending';
}

/**
 * Get a card by ID from multiple sources
 *
 * @param cardId - The card ID to find
 * @param syncedCards - YouTube synced cards
 * @param persistedLocalCards - Persisted local cards
 * @param pendingCards - Pending local cards
 * @returns The card if found, null otherwise
 */
export function getCardById(
  cardId: string,
  syncedCards: InsightCard[],
  persistedLocalCards: InsightCard[],
  pendingCards: InsightCard[]
): InsightCard | null {
  return (
    syncedCards.find(c => c.id === cardId) ||
    persistedLocalCards.find(c => c.id === cardId) ||
    pendingCards.find(c => c.id === cardId) ||
    null
  );
}

/**
 * Check if a card is in ideation (scratchpad)
 *
 * @param card - The card to check
 * @returns True if the card is in ideation
 */
export function isCardInIdeation(card: InsightCard): boolean {
  return (
    card.cellIndex < 0 ||
    !card.levelId ||
    card.levelId === 'scratchpad'
  );
}

/**
 * Check if a card is in mandala grid
 *
 * @param card - The card to check
 * @returns True if the card is in mandala grid
 */
export function isCardInMandala(card: InsightCard): boolean {
  return (
    typeof card.cellIndex === 'number' &&
    card.cellIndex >= 0 &&
    !!card.levelId &&
    card.levelId !== 'scratchpad'
  );
}
