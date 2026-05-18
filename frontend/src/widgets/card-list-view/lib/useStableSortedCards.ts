import { useEffect, useState } from 'react';
import type { InsightCard } from '@/entities/card/model/types';

/**
 * Mandala-scoped settle window for the card grid (CP471).
 *
 * **Why**: When the user switches mandalas the four card sources
 * (`useLocalCards` refetch, `useAllVideoStates` refetch, SSE
 * `streamCards`, `pendingMandalaCards`) arrive at different times.
 * The `sortedCards` memo re-runs on each arrival and re-orders by
 * `publishedAt`, so the grid visibly reflows: the first card lands at
 * (0,0), the second pushes it to (0,1), the third pushes it to (0,2),
 * and so on. User feedback: "카드가 로드되면서 위치가 바뀌므로 시각적으로
 * 매우 혼란스러움 (어지러움)".
 *
 * **How**: on mandala switch we hide the grid behind the existing
 * skeleton padding for SETTLE_MS while the live `sortedCards` keeps
 * mutating in the background. When the timer fires we take a snapshot
 * and reveal it — the user sees the grid land once, fully sorted.
 * Cards that arrive after settle (SSE backlog, pendingMandalaCards)
 * are appended to the end of the snapshot, preserving the positions
 * of every card already on screen.
 *
 * Reset key is `mandalaId` only — sector pill filtering and search
 * already swap the upstream `cards` prop, so they bypass this hook
 * and stay instant.
 */

const SETTLE_MS = 1200;

export function useStableSortedCards(
  sortedCards: InsightCard[],
  mandalaId: string | null
): { cards: InsightCard[]; hasSettled: boolean } {
  const [snapshot, setSnapshot] = useState<InsightCard[] | null>(null);

  // Reset whenever the user switches mandalas.
  useEffect(() => {
    setSnapshot(null);
  }, [mandalaId]);

  // Take the snapshot SETTLE_MS after the first non-empty arrival.
  // The timer is re-armed whenever `sortedCards` mutates while still
  // unsettled, which is fine — each new ref restarts the wait, so a
  // burst of arrivals coalesces into a single reveal.
  useEffect(() => {
    if (snapshot !== null) return;
    if (sortedCards.length === 0) return;
    const timer = setTimeout(() => {
      setSnapshot(sortedCards);
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [sortedCards, snapshot]);

  // After settle, append cards that weren't in the snapshot (SSE,
  // pendingMandalaCards, anything that arrived late). The order of
  // previously-visible cards is preserved verbatim so the grid never
  // reflows once it has landed.
  useEffect(() => {
    if (snapshot === null) return;
    const knownIds = new Set(snapshot.map((c) => c.id));
    const newOnly = sortedCards.filter((c) => !knownIds.has(c.id));
    if (newOnly.length === 0) return;
    setSnapshot([...snapshot, ...newOnly]);
  }, [sortedCards, snapshot]);

  return {
    cards: snapshot ?? [],
    hasSettled: snapshot !== null,
  };
}
