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
}

export function useLikeCard() {
  const queryClient = useQueryClient();

  const like = useMutation({
    mutationFn: async (args: LikeCardArgs) => {
      const { videoId, mandalaId, title, description } = args;
      return apiClient.likeCard(videoId, { mandalaId, title, description });
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: localCardsKeys.list() });
      queryClient.invalidateQueries({ queryKey: ['mandala', 'recommendations'] });
      if (vars.mandalaId) {
        queryClient.invalidateQueries({
          queryKey: ['mandala', 'recommendations', vars.mandalaId],
        });
      }
    },
  });

  const unlike = useMutation({
    mutationFn: async (videoId: string) => {
      await apiClient.unlikeCard(videoId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: localCardsKeys.list() });
      queryClient.invalidateQueries({ queryKey: ['mandala', 'recommendations'] });
    },
  });

  return { like, unlike };
}
