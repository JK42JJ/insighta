/**
 * Card Utilities
 *
 * Helper functions for card source detection and unified card movement logic.
 */

import type { InsightCard } from '@/types/mandala';

export type CardSource = 'synced' | 'local' | 'pending';

/**
 * Detect the source of a card by checking its presence in different card arrays.
 *
 * When syncedCards is temporarily empty (during React Query refetch transitions),
 * the optional `card` parameter provides a fallback: if the card has an explicit
 * `isInIdeation` property (true or false), it originated from user_video_states
 * and should be treated as 'synced'.
 *
 * @param cardId - The card ID to detect
 * @param syncedCards - YouTube synced cards (from video_states table)
 * @param persistedLocalCards - Persisted local cards (from local_cards table)
 * @param card - Optional InsightCard for fallback detection via isInIdeation
 * @returns The source type: 'synced', 'local', or 'pending'
 */
export function detectCardSource(
  cardId: string,
  syncedCards: InsightCard[],
  persistedLocalCards: InsightCard[],
  card?: InsightCard | null
): CardSource {
  // Check YouTube synced cards first (highest priority)
  if (syncedCards.some((c) => c.id === cardId)) {
    return 'synced';
  }

  // Check persisted local cards
  if (persistedLocalCards.some((c) => c.id === cardId)) {
    return 'local';
  }

  // Fallback: if the card has an explicit isInIdeation value (true or false),
  // it came from user_video_states (synced). Local/pending cards never set this field.
  // This prevents misclassification when syncedCards is temporarily empty during refetch.
  if (card && typeof card.isInIdeation === 'boolean') {
    if (import.meta.env.DEV) {
      console.warn(
        `[detectCardSource] Card ${cardId.slice(0, 8)} not in syncedCards but has isInIdeation=${card.isInIdeation}; treating as 'synced'`
      );
    }
    return 'synced';
  }

  // If not found in either, it's a pending card
  return 'pending';
}

/**
 * Pre-build ID sets for O(1) card source detection.
 * Call once per render cycle, pass result to detectCardSourceFast.
 */
export function buildCardIdSets(
  syncedCards: InsightCard[],
  persistedLocalCards: InsightCard[]
): { syncedIds: Set<string>; localIds: Set<string> } {
  return {
    syncedIds: new Set(syncedCards.map((c) => c.id)),
    localIds: new Set(persistedLocalCards.map((c) => c.id)),
  };
}

/**
 * O(1) card source detection using pre-built Sets.
 */
export function detectCardSourceFast(
  cardId: string,
  sets: { syncedIds: Set<string>; localIds: Set<string> },
  card?: InsightCard | null
): CardSource {
  if (sets.syncedIds.has(cardId)) return 'synced';
  if (sets.localIds.has(cardId)) return 'local';

  if (card && typeof card.isInIdeation === 'boolean') {
    if (import.meta.env.DEV) {
      console.warn(
        `[detectCardSource] Card ${cardId.slice(0, 8)} not in syncedCards but has isInIdeation=${card.isInIdeation}; treating as 'synced'`
      );
    }
    return 'synced';
  }

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
    syncedCards.find((c) => c.id === cardId) ||
    persistedLocalCards.find((c) => c.id === cardId) ||
    pendingCards.find((c) => c.id === cardId) ||
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
  return card.cellIndex < 0 || !card.levelId || card.levelId === 'scratchpad';
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
