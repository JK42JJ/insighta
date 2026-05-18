/**
 * useLikeCard — Heart-click a video card.
 *
 * CP462+ Issue #649 Phase 3. Mirrors usePinCard's invalidation
 * strategy: on success the local-cards list AND every cached
 * recommendation feed for the affected mandala refetch so the new
 * pinned_at / signal state surfaces without a manual reload.
 *
 * Two mutation modes:
 *   - like(videoId, {mandalaId, title?, description?}) — records
 *     signal='like', sets pinned_at=now() on source rows, enqueues
 *     v2 enrichment when mandalaId is provided. Returns the BE
 *     payload so callers (Heart UI) can read the new jobId and open
 *     the enrich-stream EventSource.
 *   - unlike(videoId) — DELETE signal + pinned_at=NULL.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/lib/api-client';
import { localCardsKeys } from './useLocalCards';

export interface LikeCardArgs {
  videoId: string;
  mandalaId?: string;
  title?: string;
  description?: string;
  /** CP466 — Add Cards panel pass the candidate's auto-assigned cell
   *  so the BE UPSERT can place it in the right mandala sector. */
  cellIndex?: number;
}

export function useLikeCard() {
  const queryClient = useQueryClient();

  const like = useMutation({
    mutationFn: async (args: LikeCardArgs) => {
      const { videoId, mandalaId, title, description, cellIndex } = args;
      return apiClient.likeCard(videoId, { mandalaId, title, description, cellIndex });
    },
    onSuccess: () => {
      // CP463 flicker-fix — DO NOT invalidate the card-list queries
      // (`localCards.list()` / `['mandala','recommendations']`). like only
      // changes `pinned_at`, which the in-card `likedLocal` optimistic
      // state already reflects; invalidating the list forces a full grid
      // refetch + 60+ card reconcile per click, and triggers a visible
      // flicker storm when multiple cards are enriched concurrently.
      // Only v2-summaries needs an invalidate so the TL badge + footer
      // one_liner appear when the score lands.
      queryClient.invalidateQueries({ queryKey: ['cards', 'v2-summaries'] });
    },
  });

  const unlike = useMutation({
    mutationFn: async (videoId: string) => {
      await apiClient.unlikeCard(videoId);
    },
    onSuccess: () => {
      // Same flicker-fix as `like` — the optimistic flip already covers
      // the UI; the next natural refetch (`useRecommendations`
      // refetchInterval 8s) propagates the server pinned_at=NULL.
      queryClient.invalidateQueries({ queryKey: ['cards', 'v2-summaries'] });
    },
  });

  return { like, unlike };
}
