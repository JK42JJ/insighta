import { useMemo } from 'react';
import { useLocalCards } from '@/features/card-management/model';
import { useAllVideoStates } from '@/features/youtube-sync/model/useYouTubeSync';
import { convertToInsightCards } from '@/features/card-management/lib/youtubeToInsightCard';
import { normalizeUrl } from '@/shared/lib/url-normalize';
import type { InsightCard } from '@/entities/card/model/types';

/**
 * Returns ALL cards (local + sync + wizard + D&D) for a given mandala.
 * Lightweight alternative to useCardOrchestrator for read-only views.
 */
export function useMandalaCards(mandalaId: string) {
  const { cards: localCards, isLoading: isLocalLoading } = useLocalCards();
  const { data: videoStates, isLoading: isSyncLoading } = useAllVideoStates();

  const syncedCards = useMemo(() => {
    if (!videoStates) return [];
    return convertToInsightCards(videoStates);
  }, [videoStates]);

  const cards = useMemo(() => {
    const filteredLocal = (localCards ?? []).filter(
      (c: InsightCard) => c.mandalaId === mandalaId && c.cellIndex >= 0
    );
    const filteredSync = syncedCards.filter(
      (c) => c.mandalaId === mandalaId && c.cellIndex >= 0 && !c.isInIdeation
    );

    const merged = [...filteredLocal, ...filteredSync];
    const seen = new Set<string>();
    return merged.filter((card) => {
      const key = normalizeUrl(card.videoUrl);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [localCards, syncedCards, mandalaId]);

  return { cards, isLoading: isLocalLoading || isSyncLoading };
}
