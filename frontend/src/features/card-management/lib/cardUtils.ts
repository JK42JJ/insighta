/**
 * Card Utilities
 *
 * Helper functions for card source detection and unified card movement logic.
 */

import type { InsightCard } from '@/entities/card/model/types';

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

/**
 * Issue #389: a card is "new" (surfaced under the "New Cards" tab) when a
 * `source_mandala_mappings` entry caused the sync engine to stamp
 * `mandala_id` on it, but no cell placement has happened yet. These cards
 * live in the target mandala's "New Cards" tab until the user drops them
 * into a cell.
 *
 * CP474 fix — the original three-condition predicate produced false
 * positives because the auto-add recommendation pipeline
 * (`auto-add-recommendations.ts`) and the Heart-click INSERT path
 * (`cards.ts` line ~178) both write the same `is_in_ideation=false +
 * cell_index=-1 + mandala_id=set` triple as the sync engine. We now
 * additionally exclude rows whose `auto_added=true` (recommendation
 * origin) or `pinned_at` is set (user explicitly bookmarked, not an
 * incoming sync). The sync engine alone leaves both signals at their
 * zero values.
 *
 * Predicate:
 *   - `isInIdeation === false` (out of the global Ideation palette)
 *   - `cellIndex < 0` or missing (unplaced)
 *   - `mandalaId` is truthy (has a mapped home mandala)
 *   - `autoAdded !== true` (not a recommendation auto-add)
 *   - `pinnedAt` is null/undefined (not user-bookmarked)
 *   - if `mandalaId` is supplied, filters to that mandala only
 */
export function isNewCardForMandala(card: InsightCard, mandalaId?: string | null): boolean {
  if (card.isInIdeation !== false) return false;
  if (typeof card.cellIndex === 'number' && card.cellIndex >= 0) return false;
  if (!card.mandalaId) return false;
  if (mandalaId && card.mandalaId !== mandalaId) return false;
  if (card.autoAdded) return false;
  if (card.pinnedAt) return false;
  return true;
}

/**
 * Back-compat alias — exported name preserved so existing imports
 * (`isNewlySyncedCard`) keep compiling while call-sites migrate.
 * @deprecated Use {@link isNewCardForMandala}.
 */
export const isNewlySyncedCard = isNewCardForMandala;

/**
 * Count "new" cards per mandala. Cards without a `mandalaId` or that fail
 * {@link isNewCardForMandala} are ignored. Mandalas with count 0 are
 * omitted from the result — consumers can treat a missing key as 0.
 */
export function countNewCardsByMandala(cards: InsightCard[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of cards) {
    if (!isNewCardForMandala(c)) continue;
    const key = c.mandalaId;
    if (!key) continue;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/**
 * Back-compat alias.
 * @deprecated Use {@link countNewCardsByMandala}.
 */
export const countNewlySyncedByMandala = countNewCardsByMandala;

/**
 * Filter the candidate newly-synced list to drop entries whose video URL
 * already lives in a placed-cell card. This is the CP475+8 dedupe fix:
 * when the same YouTube video has both a placed-side row (user dropped
 * it into a cell at some earlier point — older metadata snapshot) AND a
 * mapping-sync row (mapper just re-pulled the same URL — fresher
 * metadata), the user saw the same video listed under both the sector
 * pill AND the "Updated" pill with mismatched view counts and dates.
 *
 * After this dedupe, the placed-side row wins (the chip count drops to
 * 0 and the "Updated" pill disappears for that video), so the user sees
 * exactly one canonical card with one consistent metadata view.
 *
 * @param candidates  newly-synced predicate already applied
 * @param placedUrls  normalised URLs of cards already placed in any cell
 *                    (drawn from mandalaLocalCards + mandalaVideoCards)
 * @param normalize   URL normaliser (caller supplies normalizeUrl from
 *                    @/shared/lib/url-normalize so this helper stays
 *                    pure and dependency-free for tests).
 */
export function dedupeNewlySyncedAgainstPlaced<T extends Pick<InsightCard, 'videoUrl'>>(
  candidates: T[],
  placedUrls: Iterable<string>,
  normalize: (url: string) => string
): T[] {
  const placedSet = new Set<string>();
  for (const u of placedUrls) placedSet.add(u);
  return candidates.filter((c) => !placedSet.has(normalize(c.videoUrl)));
}
